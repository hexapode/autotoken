import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable, PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { createRecordingHandler, forwardHeaders } from '../src/recording-proxy.js';
import { inspectResponse, summarizeTraces } from '../src/trace.js';

class ResponseSink extends Writable {
  constructor() { super(); this.chunks = []; this.headersSent = false; }
  writeHead(status, headers) { this.statusCode = status; this.headers = headers; this.headersSent = true; }
  _write(chunk, encoding, callback) { this.chunks.push(Buffer.from(chunk)); callback(); }
  bytes() { return Buffer.concat(this.chunks); }
}
function request(body, headers = {}) {
  return Object.assign(Readable.from([Buffer.from(body)]), { method: 'POST', url: '/v1/chat/completions', headers: { 'content-type': 'application/json', authorization: 'Bearer local-secret', ...headers } });
}
function upstream(body, headers = { 'content-type': 'application/json' }, statusCode = 200) {
  return Object.assign(Readable.from(Array.isArray(body) ? body : [Buffer.from(body)]), { headers, statusCode });
}
async function setup(t, transport, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'm2c-record-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const handler = createRecordingHandler({ upstreamBase: 'https://provider.invalid/v1', upstreamKey: 'upstream-secret', proxyToken: 'local-secret', directory, transport, ...extra });
  const trace = async () => {
    const [id] = await readdir(directory);
    return { directory: join(directory, id), metadata: JSON.parse(await readFile(join(directory, id, 'metadata.json'), 'utf8')) };
  };
  return { directory, handler, trace };
}
test('preserves full conversation, tool schema, arbitrary options and exact body bytes', async t => {
  const body = '{ "model":"test", "stream":false,"messages":[{"role":"system","content":"rules"},{"role":"assistant","tool_calls":[{"id":"call1","type":"function","function":{"name":"read","arguments":"{}"}}]},{"role":"tool","tool_call_id":"call1","content":"source"}],"tools":[{"type":"function","function":{"name":"read","parameters":{}}}],"reasoning_effort":"low","unknown_future_field":1 }';
  const reply = '{"choices":[{"message":{"role":"assistant","content":"done"}}],"usage":{"total_tokens":12}}';
  const { handler, trace } = await setup(t, async options => {
    assert.equal(options.body.toString(), body);
    assert.equal(options.url.href, 'https://provider.invalid/v1/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer upstream-secret');
    assert.equal(options.headers['x-m2c-run-id'], undefined);
    assert.equal(options.headers.cookie, undefined);
    return upstream(reply, { 'content-type': 'application/json', 'x-request-id': 'req-1' });
  });
  const res = new ResponseSink();
  await handler(request(body, { 'x-m2c-run-id': 'run-1', 'x-m2c-instance-id': 'repo__issue', cookie: 'secret-cookie' }), res);
  assert.equal(res.bytes().toString(), reply);
  const saved = await trace();
  assert.equal((await readFile(join(saved.directory, 'request.json'))).toString(), body);
  assert.equal((await readFile(join(saved.directory, 'response.bin'))).toString(), reply);
  assert.equal(saved.metadata.response.usage.total_tokens, 12);
  assert.equal(saved.metadata.runId, 'run-1');
  assert.equal(saved.metadata.instanceId, 'repo__issue');
  assert.equal(saved.metadata.state, 'complete');
  assert.doesNotMatch(JSON.stringify(saved.metadata), /upstream-secret|local-secret|secret-cookie/);
});
test('streams immediately and preserves fragmented SSE, Unicode and tool-call arguments', async t => {
  const stream = Object.assign(new PassThrough(), { statusCode: 200, headers: { 'content-type': 'text/event-stream' } });
  const { handler, trace } = await setup(t, async () => stream);
  const res = new ResponseSink();
  const event = value => `data: ${JSON.stringify(value)}\r\n\r\n`;
  const content = event({ choices: [{ index: 0, delta: { content: 'Hello 🙂', tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read', arguments: '{"path":' } }] } }] }) +
    event({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"a.py"}' } }] }, finish_reason: 'tool_calls' }] }) +
    event({ choices: [], usage: { total_tokens: 99 } }) + 'data: [DONE]\r\n\r\n';
  const bytes = Buffer.from(content);
  const running = handler(request('{"stream":true}'), res);
  const firstWrite = new Promise(resolve => { const original = res._write.bind(res); res._write = (chunk, encoding, callback) => { original(chunk, encoding, callback); resolve(); }; });
  stream.write(bytes.subarray(0, 5));
  await firstWrite;
  assert.equal(res.bytes().toString(), 'data:'); // Upstream has not ended.
  for (let i = 5; i < bytes.length; i += 3) stream.write(bytes.subarray(i, i + 3));
  stream.end(); await running;
  assert.deepEqual(res.bytes(), bytes);
  const { metadata } = await trace();
  assert.equal(metadata.response.done, true);
  assert.equal(metadata.response.choices[0].message.content, 'Hello 🙂');
  assert.equal(metadata.response.choices[0].message.tool_calls[0].function.arguments, '{"path":"a.py"}');
  assert.equal(metadata.response.usage.total_tokens, 99);
});
test('upstream status and retry headers pass through without retrying', async t => {
  let attempts = 0;
  const { handler, trace } = await setup(t, async () => { attempts++; return upstream('{"error":{"message":"rate limited"}}', { 'content-type': 'application/json', 'retry-after': '12' }, 429); });
  const res = new ResponseSink(); await handler(request('{}'), res);
  assert.equal(res.statusCode, 429); assert.equal(res.headers['retry-after'], '12'); assert.equal(attempts, 1);
  assert.equal((await trace()).metadata.upstreamStatus, 429);
});
test('authentication and unsupported endpoints never call the upstream', async t => {
  const { handler, directory } = await setup(t, () => { throw new Error('Must not run'); });
  for (const [headers, path, expected] of [[{ authorization: 'Bearer wrong' }, '/v1/chat/completions', 401], [{ origin: 'https://other.invalid' }, '/v1/chat/completions', 403], [{}, '/v1/messages', 404]]) {
    const req = request('{}', headers); req.url = path;
    const res = new ResponseSink(); await handler(req, res); assert.equal(res.statusCode, expected);
  }
  assert.deepEqual(await readdir(directory), []);
});
test('recording cap never truncates the response delivered to the client', async t => {
  const { handler, trace } = await setup(t, async () => upstream('a'.repeat(200)), { maxRecordBytes: 20 });
  const res = new ResponseSink(); await handler(request('{}'), res);
  assert.equal(res.bytes().length, 200);
  const { metadata } = await trace();
  assert.equal(metadata.recordedBytes, 20); assert.equal(metadata.recordingTruncated, true);
  assert.equal(metadata.response.usage, null);
});
test('upstream network failures produce a trace and a 502 without exposing error text', async t => {
  const { handler, trace } = await setup(t, async () => { throw new Error('upstream-secret'); });
  const res = new ResponseSink(); await handler(request('{}'), res);
  assert.equal(res.statusCode, 502);
  assert.equal((await trace()).metadata.state, 'failed');
  assert.doesNotMatch(res.bytes().toString(), /upstream-secret/);
});
test('deadline cancels pending upstream request and records timeout', async t => {
  const { handler, trace } = await setup(t, ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })), { timeoutMs: 50 });
  const res = new ResponseSink(); await handler(request('{}'), res);
  assert.equal(res.statusCode, 504); assert.equal((await trace()).metadata.state, 'timeout');
});
test('client cancellation propagates to upstream and records partial stream', async t => {
  let signal;
  const stream = Object.assign(new PassThrough(), { statusCode: 200, headers: { 'content-type': 'text/event-stream' } });
  const { handler, trace } = await setup(t, async options => { signal = options.signal; return stream; });
  const res = new ResponseSink();
  const started = new Promise(resolve => { res._write = (chunk, encoding, callback) => { res.chunks.push(Buffer.from(chunk)); callback(); resolve(); }; });
  const running = handler(request('{"stream":true}'), res);
  stream.write('data: {"choices":[]}\n\n'); await started;
  res.destroy(); await running;
  assert.equal(signal.aborted, true);
  assert.equal((await trace()).metadata.state, 'client-aborted');
});
test('mid-stream upstream failure is not misclassified as client cancellation', async t => {
  const stream = Object.assign(new PassThrough(), { statusCode: 200, headers: { 'content-type': 'text/event-stream' } });
  const { handler, trace } = await setup(t, async () => stream);
  const res = new ResponseSink();
  const started = new Promise(resolve => { res._write = (chunk, encoding, callback) => { callback(); resolve(); }; });
  const running = handler(request('{"stream":true}'), res);
  stream.write('data: {}\n\n'); await started; stream.destroy(new Error('socket failed'));
  await running; assert.equal((await trace()).metadata.state, 'failed');
});
test('compressed responses stay byte-exact with unknown usage, malformed SSE is inspectable', async t => {
  const compressed = gzipSync('{"usage":{"total_tokens":12}}');
  const { handler, directory } = await setup(t, async () => upstream(compressed, { 'content-type': 'application/json', 'content-encoding': 'gzip' }));
  const res = new ResponseSink(); await handler(request('{}'), res);
  assert.deepEqual(res.bytes(), compressed);
  const summary = await summarizeTraces(directory);
  assert.equal(summary.callsWithoutTokenUsage, 1);
  const parsed = inspectResponse(Buffer.from('data: broken\n\ndata: {"choices":[]}\n\n'), { 'content-type': 'text/event-stream' });
  assert.equal(parsed.malformedEvents, 1); assert.equal(parsed.done, false);
});
test('hop-by-hop headers and connection-nominated fields are removed', () => {
  assert.deepEqual(forwardHeaders({ connection: 'keep-alive, x-internal', 'x-internal': 'secret', 'content-type': 'application/json', 'transfer-encoding': 'chunked' }), { 'content-type': 'application/json' });
});

test('Responses preserves reasoning, tool output and streamed final response', async t => {
  const input = { model: 'gpt-6.1-sol', reasoning: { effort: 'medium' }, stream: true, store: false, input: [{ type: 'function_call_output', call_id: 'call-1', output: 'file contents' }], tools: [{ type: 'function', name: 'read', parameters: { type: 'object', properties: {} } }] };
  const output = [{ type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque', summary: [] }, { type: 'function_call', id: 'fc_1', call_id: 'call-2', name: 'read', arguments: '{"path":"a.py"}' }];
  const sse = `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } })}\n\n`;
  const { handler, trace } = await setup(t, async options => {
    assert.equal(options.url.pathname, '/v1/responses');
    assert.deepEqual(JSON.parse(options.body), input);
    return upstream([Buffer.from(sse.slice(0, 20)), Buffer.from(sse.slice(20))], { 'content-type': 'text/event-stream' });
  });
  const req = request(JSON.stringify(input)); req.url = '/v1/responses';
  const res = new ResponseSink(); await handler(req, res);
  assert.equal(res.bytes().toString(), sse);
  const { metadata } = await trace();
  assert.equal(metadata.endpoint, '/v1/responses');
  assert.deepEqual(metadata.response.output, output);
  assert.equal(metadata.response.usage.total_tokens, 15);
  assert.equal(metadata.response.done, true);
});
test('Responses failed, incomplete and partial streams are distinguished from success', () => {
  for (const status of ['failed', 'incomplete']) {
    const parsed = inspectResponse(Buffer.from(`data: ${JSON.stringify({ type: `response.${status}`, response: { status, output: [], error: status === 'failed' ? { code: 'server_error' } : null, incomplete_details: { reason: 'max_output_tokens' } } })}\n\n`), { 'content-type': 'text/event-stream' }, '/v1/responses');
    assert.equal(parsed.done, true); assert.equal(parsed.status, status); assert.equal(parsed.usage, null);
  }
  const item = { type: 'function_call', name: 'read', arguments: '{}' };
  const partial = inspectResponse(Buffer.from(`data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item })}\n\n`), { 'content-type': 'text/event-stream' }, '/v1/responses');
  assert.equal(partial.done, false); assert.deepEqual(partial.output, [item]);
  const plain = inspectResponse(Buffer.from('{"status":"completed","output":[],"usage":{"total_tokens":7}}'), { 'content-type': 'application/json' }, '/v1/responses');
  assert.equal(plain.usage.total_tokens, 7);
});
