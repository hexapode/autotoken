import http from 'node:http';
import https from 'node:https';
import { mkdir, open, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { inspectResponse } from './trace.js';

const HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
export function forwardHeaders(headers, request = false) {
  const blocked = new Set([...HOP, ...String(headers.connection || '').toLowerCase().split(',').map(s => s.trim())]);
  if (request) for (const name of ['host', 'authorization', 'cookie', 'x-api-key', 'api-key', 'content-length', 'expect']) blocked.add(name);
  return Object.fromEntries(Object.entries(headers).filter(([name, value]) => value !== undefined && !blocked.has(name.toLowerCase()) && !name.toLowerCase().startsWith('x-m2c-')));
}
function authorized(header, token) {
  const actual = Buffer.from(header || ''), expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function label(value) { return typeof value === 'string' ? value.slice(0, 200) : null; }
export function dispatch({ url, headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const upstream = transport.request(url, { method: 'POST', headers, signal }, resolve);
    upstream.on('error', reject);
    upstream.end(body);
  });
}
async function saveMetadata(directory, metadata) {
  const file = join(directory, 'metadata.json');
  await writeFile(`${file}.tmp`, JSON.stringify(metadata, null, 2), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}

export function createRecordingHandler({
  upstreamBase, upstreamKey, proxyToken, directory = './data/trajectories',
  runId = null, instanceId = null, sessionId = null, timeoutMs = 300000,
  maxRequestBytes = 16 * 1024 * 1024, maxRecordBytes = 64 * 1024 * 1024,
  transport = dispatch, onTrace, warn = console.error
}) {
  if (!upstreamKey || !proxyToken) throw new Error('Set LLM_API_KEY and PROXY_TOKEN');
  const base = new URL(upstreamBase);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Invalid upstream base URL');
  if (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Use HTTPS for non-local upstreams');
  if (![timeoutMs, maxRequestBytes, maxRecordBytes].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Limits must be positive integers');
  const endpoints = { '/v1/chat/completions': 'chat/completions', '/v1/responses': 'responses' };
  return async (req, res) => {
    const send = (status, message) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(message));
    };
    if (req.headers.origin) return send(403, { error: 'Browser-origin requests are not supported' });
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, mode: 'record-only', protocols: ['chat-completions', 'responses'] });
    if (req.method !== 'POST' || !Object.hasOwn(endpoints, req.url)) return send(404, { error: 'Supported endpoints: POST /v1/chat/completions and POST /v1/responses' });
    const url = new URL(`${base.href.replace(/\/$/, '')}/${endpoints[req.url]}`);
    if (!authorized(req.headers.authorization, proxyToken)) return send(401, { error: 'Invalid proxy token' });
    if (!String(req.headers['content-type']).toLowerCase().startsWith('application/json')) return send(415, { error: 'Use application/json' });
    if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') return send(415, { error: 'Compressed request bodies are not supported' });

    const start = performance.now(), controller = new AbortController();
    let timedOut = false, disconnected = false, responseStarted = false, upstreamFailed = false;
    let traceDir, metadata, file, responseBytes = 0, recordedBytes = 0;
    const recording = [];
    const abort = () => { disconnected = true; controller.abort(); };
    const closed = () => { if (!res.writableFinished && !upstreamFailed) abort(); };
    req.once('aborted', abort); res.once('close', closed);
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const chunks = []; let size = 0;
      // The same deadline also covers a client that stalls while uploading.
      const abortUpload = () => req.destroy(new Error('Request cancelled'));
      controller.signal.addEventListener('abort', abortUpload, { once: true });
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > maxRequestBytes) { send(413, { error: 'Request too large' }); return; }
          chunks.push(Buffer.from(chunk));
        }
      } finally { controller.signal.removeEventListener('abort', abortUpload); }
      const body = Buffer.concat(chunks);
      let request;
      try { request = JSON.parse(body.toString('utf8')); }
      catch { return send(400, { error: 'Invalid JSON' }); }
      if (!request || typeof request !== 'object' || Array.isArray(request)) return send(400, { error: 'Expected JSON object' });
      // Do not normalize or reserialize: all tools, tool results, parameters and whitespace survive.
      const id = randomUUID(); traceDir = join(resolve(directory), id);
      await mkdir(traceDir, { recursive: true, mode: 0o700 });
      metadata = {
        version: 1, id, mode: 'record-only', endpoint: req.url, startedAt: new Date().toISOString(),
        runId: label(req.headers['x-m2c-run-id']) ?? runId,
        instanceId: label(req.headers['x-m2c-instance-id']) ?? instanceId,
        sessionId: label(req.headers['x-m2c-session-id']) ?? sessionId,
        model: typeof request.model === 'string' ? request.model : null,
        stream: request.stream === true, requestBytes: body.length,
        state: 'in-progress', upstreamStatus: null, firstByteMs: null,
        recordingTruncated: false, recordingError: null
      };
      await writeFile(join(traceDir, 'request.json'), body, { mode: 0o600 });
      await saveMetadata(traceDir, metadata);
      file = await open(join(traceDir, 'response.bin'), 'wx', 0o600);
      const headers = forwardHeaders(req.headers, true);
      headers.authorization = `Bearer ${upstreamKey}`;
      headers['content-length'] = String(body.length);
      const upstream = await transport({ url, headers, body, signal: controller.signal, traceId: id });
      upstream.once('error', () => { upstreamFailed = true; });
      const cancelUpstream = () => upstream.destroy(new Error('Request cancelled'));
      controller.signal.addEventListener('abort', cancelUpstream, { once: true });
      try {
        controller.signal.throwIfAborted();
        metadata.upstreamStatus = upstream.statusCode;
        // Only non-secret diagnostic headers are persisted. Other headers still pass through.
        metadata.responseHeaders = Object.fromEntries(['content-type', 'content-encoding', 'x-request-id', 'retry-after'].filter(k => upstream.headers[k] !== undefined).map(k => [k, upstream.headers[k]]));
        res.writeHead(upstream.statusCode, forwardHeaders(upstream.headers));
        res.flushHeaders?.(); responseStarted = true;
        const tap = new Transform({
          transform(chunk, encoding, callback) {
            responseBytes += chunk.length;
            if (metadata.firstByteMs === null) metadata.firstByteMs = performance.now() - start;
            const retained = chunk.subarray(0, Math.max(0, maxRecordBytes - recordedBytes));
            if (retained.length < chunk.length) metadata.recordingTruncated = true;
            const capture = async () => {
              if (retained.length && !metadata.recordingError) {
                try {
                  await file.writeFile(retained);
                  recording.push(Buffer.from(retained)); recordedBytes += retained.length;
                } catch {
                  metadata.recordingError = 'Response recording failed';
                  warn(`Trace ${id}: response recording failed; forwarding continues`);
                }
              }
              callback(null, chunk);
            };
            capture().catch(callback);
          }
        });
        await pipeline(upstream, tap, res, { signal: controller.signal });
        metadata.state = 'complete';
      } finally { controller.signal.removeEventListener('abort', cancelUpstream); }
    } catch (error) {
      if (metadata) {
        metadata.state = timedOut ? 'timeout' : disconnected ? 'client-aborted' : 'failed';
        // Error messages may contain credentials or URLs; retain only a code.
        metadata.errorCode = typeof error.code === 'string' ? error.code : 'PROXY_ERROR';
      }
      if (!responseStarted && !res.headersSent) send(timedOut ? 504 : traceDir && !file ? 507 : 502, { error: timedOut ? 'Upstream timeout' : 'Proxy request failed' });
      else if (!res.destroyed) res.destroy();
    } finally {
      clearTimeout(timeout); req.removeListener('aborted', abort); res.removeListener('close', closed);
      if (file) await file.close().catch(() => {});
      if (metadata) {
        metadata.finishedAt = new Date().toISOString();
        metadata.durationMs = performance.now() - start;
        metadata.responseBytes = responseBytes; metadata.recordedBytes = recordedBytes;
        const completeRecording = !metadata.recordingTruncated && !metadata.recordingError;
        metadata.response = completeRecording ? inspectResponse(Buffer.concat(recording), metadata.responseHeaders || {}, metadata.endpoint) : { usage: null, parseError: 'Incomplete recording' };
        try { await saveMetadata(traceDir, metadata); }
        catch { warn(`Trace ${metadata.id}: final metadata write failed`); }
        try { await onTrace?.(metadata); } catch { warn(`Trace ${metadata.id}: completion callback failed`); }
      }
    }
  };
}

export function createRecordingServer(options) {
  const server = http.createServer(createRecordingHandler(options));
  server.requestTimeout = options.timeoutMs || 300000;
  server.headersTimeout = Math.min(60000, server.requestTimeout);
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const port = Number(process.env.PROXY_PORT || 3001);
    const server = createRecordingServer({
      upstreamBase: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
      upstreamKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY, proxyToken: process.env.PROXY_TOKEN,
      directory: process.env.TRACE_DIR || './data/trajectories',
      runId: process.env.M2C_RUN_ID || null, instanceId: process.env.M2C_INSTANCE_ID || null,
      sessionId: process.env.M2C_SESSION_ID || null,
      timeoutMs: Number(process.env.PROXY_TIMEOUT_MS || 300000)
    });
    server.on('error', error => { console.error(`Recording proxy failed: ${error.code || 'SERVER_ERROR'}`); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Record-only proxy: http://127.0.0.1:${port}/v1 (no substitution)`));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
