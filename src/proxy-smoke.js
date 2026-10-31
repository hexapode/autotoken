import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecordingServer } from './recording-proxy.js';
import { summarizeTraces } from './trace.js';

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address().port); });
});
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
const event = value => `data: ${JSON.stringify(value)}\n\n`;
const first = event({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'read-1', type: 'function', function: { name: 'read', arguments: '{"path":"README.md"}' } }] }, finish_reason: 'tool_calls' }] }) + event({ choices: [], usage: { total_tokens: 20 } }) + 'data: [DONE]\n\n';
const second = event({ choices: [{ index: 0, delta: { role: 'assistant', content: 'Read it 🙂' }, finish_reason: 'stop' }] }) + event({ choices: [], usage: { total_tokens: 30 } }) + 'data: [DONE]\n\n';
let proxy, mock;
try {
  const directory = await mkdtemp(join(tmpdir(), 'm2c-proxy-smoke-'));
  const received = [];
  mock = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received.push({ body: Buffer.concat(chunks), authorization: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const bytes = Buffer.from(received.length === 1 ? first : second);
    for (let i = 0; i < bytes.length; i += 7) res.write(bytes.subarray(i, i + 7));
    res.end();
  });
  const upstreamPort = await listen(mock);
  proxy = createRecordingServer({ upstreamBase: `http://127.0.0.1:${upstreamPort}/v1`, upstreamKey: 'smoke-upstream', proxyToken: 'smoke-local', directory });
  const proxyPort = await listen(proxy);
  const messages = [{ role: 'user', content: 'Read README.md' }];
  const tools = [{ type: 'function', function: { name: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }];
  for (const expected of [first, second]) {
    const body = JSON.stringify({ model: 'smoke', messages, tools, stream: true, stream_options: { include_usage: true } });
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer smoke-local', 'x-m2c-run-id': 'socket-smoke', 'x-m2c-session-id': 'session-1' }, body });
    assert.equal(response.status, 200); assert.equal(await response.text(), expected);
    assert.equal(received.at(-1).body.toString(), body);
    assert.equal(received.at(-1).authorization, 'Bearer smoke-upstream');
    messages.push({ role: 'assistant', content: null, tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'read', arguments: '{"path":"README.md"}' } }] }, { role: 'tool', tool_call_id: 'read-1', content: 'Mock README contents' });
  }
  // Client completion can precede the final metadata write by a filesystem turn.
  for (let attempt = 0; attempt < 100; attempt++) {
    const ids = await readdir(directory);
    const states = await Promise.all(ids.map(async id => JSON.parse(await readFile(join(directory, id, 'metadata.json'), 'utf8')).state));
    if (states.length === 2 && states.every(s => s === 'complete')) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const summary = await summarizeTraces(directory);
  assert.equal(summary.completeTransports, 2); assert.equal(summary.knownTotalTokens, 50);
  console.log(`Socket smoke passed: two streamed turns, tool round-trip, exact bodies, 50 tokens.\nTraces: ${directory}`);
} catch (error) {
  console.error(error.code === 'EPERM' ? 'Socket smoke blocked: this environment prohibits listening on localhost. Run npm run proxy:smoke outside the sandbox. No live Pi/provider verification performed.' : error);
  process.exitCode = 1;
} finally {
  if (proxy) await close(proxy);
  if (mock) await close(mock);
}
