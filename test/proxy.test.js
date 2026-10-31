import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { DemoProvider, ModelProvider } from '../src/provider.js';
import { execute } from '../src/program.js';
import { makeServer } from '../src/server.js';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'm2c-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return new Engine(new Store(dir), new DemoProvider());
}
async function discover(engine) {
  for (const [i, prompt] of ['Sort these numbers ascending', 'Order numbers ascending', 'Sort numbers from smallest to largest'].entries()) {
    await engine.query({ prompt, data: [9 + i, 2, 1] });
  }
  const learned = await engine.learn();
  assert.equal(learned.added.length, 1);
  return engine.store.state.programs[0];
}
async function shadow(engine) {
  for (const data of [[8, 4, 5], [12, -3, 0], [100, 10, 1]]) {
    const event = await engine.query({ prompt: 'Sort numbers ascending', data });
    assert.equal(event.route, 'model');
    assert.equal(event.shadow.match, true);
  }
}
test('learn, shadow, promote, serve code, abstain, disable, persist', async t => {
  const engine = setup(t), p = await discover(engine);
  assert.equal(p.status, 'shadow');
  assert.throws(() => engine.setStatus(p.id, 'active'), /Promotion needs/);
  await shadow(engine);
  engine.setStatus(p.id, 'active');
  const result = await engine.query({ prompt: 'Sort numbers ascending', data: [42, 7, 19] });
  assert.equal(result.route, 'program');
  assert.deepEqual(JSON.parse(result.answer), [7, 19, 42]);
  assert.deepEqual(result.calls.map(c => c.kind), ['route']);
  const fallback = await engine.query({ prompt: 'Rank these by beauty', data: [1, 2, 3] });
  assert.equal(fallback.route, 'model');
  engine.setStatus(p.id, 'disabled');
  assert.equal((await engine.query({ prompt: 'Sort numbers ascending', data: [4, 3] })).route, 'model');
  const restored = new Store(engine.store.directory);
  assert.equal(restored.state.programs[0].status, 'disabled');
  assert.equal(engine.stats().programResponses, 1);
});
test('repeated training inputs cannot satisfy held-out promotion', async t => {
  const engine = setup(t), p = await discover(engine);
  for (let i = 0; i < 4; i++) await engine.query({ prompt: 'Sort numbers ascending', data: [9, 2, 1] });
  assert.throws(() => engine.setStatus(p.id, 'active'), /Promotion needs/);
});
test('shadow disagreements block promotion', async t => {
  const engine = setup(t), p = await discover(engine);
  await shadow(engine);
  engine.provider.answer = async () => ({ value: '[999]' });
  const event = await engine.query({ prompt: 'Sort numbers ascending', data: [123, 2] });
  assert.equal(event.shadow.match, false);
  assert.throws(() => engine.setStatus(p.id, 'active'), /Promotion needs/);
});
test('bad routing, uncertainty, unknown ids and invalid inputs fall back', async t => {
  const engine = setup(t), p = await discover(engine);
  for (const decision of [null, { programId: p.id, confidence: 0.1 }, { programId: 'missing', confidence: 1 }, { programId: p.id, confidence: 5 }]) {
    engine.provider.route = async () => ({ value: decision });
    assert.equal((await engine.query({ prompt: 'Sort numbers ascending', data: [5, 2] })).shadow, null);
  }
  engine.provider.route = async () => { throw new Error('timeout'); };
  assert.equal((await engine.query({ prompt: 'Sort numbers ascending', data: [5, 2] })).route, 'model');
  engine.provider.route = async () => ({ value: { programId: p.id, confidence: 1 } });
  const result = await engine.query({ prompt: 'Sort', data: {} });
  assert.equal(result.route, 'model');
  assert.match(result.reason, /contract failure/);
});
test('ordinary conversations preserve context and bypass routing', async t => {
  const engine = setup(t); await discover(engine);
  engine.provider.route = () => { throw new Error('Must not call router'); };
  const messages = [{ role: 'system', content: 'Respond in French' }, { role: 'user', content: 'Sort numbers ascending' }];
  engine.provider.answer = async request => { assert.deepEqual(request.messages, messages); return { value: 'Bonjour' }; };
  assert.equal((await engine.query({ messages })).answer, 'Bonjour');
});
test('generated arbitrary code is rejected and duplicate programs are not registered', async t => {
  const engine = setup(t), p = await discover(engine);
  engine.provider.discover = async () => ({ value: { programs: [{ ...p, steps: [{ op: 'eval', code: 'process.exit()' }] }, p] } });
  const result = await engine.learn();
  assert.equal(result.added.length, 0);
  assert.equal(result.rejected.length, 2);
  assert.equal(engine.store.state.programs.length, 1);
});
test('upstream answer failure is surfaced without recording a fake successful answer', async t => {
  const engine = setup(t);
  engine.provider.answer = async () => { throw new Error('Upstream HTTP 503'); };
  await assert.rejects(engine.query({ prompt: 'hello' }), /503/);
  assert.equal(engine.store.state.traffic.length, 0);
});
test('DSL checks types, missing fields, overflow and stable transformations', () => {
  const run = (steps, data) => execute({ name: 'test', description: 'test', input: Array.isArray(data) ? 'array' : 'string', steps }, data);
  assert.deepEqual(run([{ op: 'sort', field: 'n', direction: 'desc' }, { op: 'pluck', field: 'n' }], [{ n: 1 }, { n: 3 }]), [3, 1]);
  assert.equal(run([{ op: 'pluck', field: 'n' }, { op: 'sum' }], [{ n: 1 }, { n: 3 }]), 4);
  assert.deepEqual(run([{ op: 'unique' }], [{ a: 1, b: 2 }, { b: 2, a: 1 }]), [{ a: 1, b: 2 }]);
  assert.equal(run([{ op: 'trim' }, { op: 'upper' }], ' hi '), 'HI');
  assert.equal(run([{ op: 'count' }], '🙂a'), 2);
  assert.throws(() => run([{ op: 'sum' }], [Number.MAX_VALUE, Number.MAX_VALUE]), /overflow/);
  assert.throws(() => run([{ op: 'pluck', field: 'n' }], [{}]), /Missing field/);
  assert.throws(() => run([{ op: 'sort', direction: 'asc' }], [1, '2']), /uniform/);
  assert.throws(() => run([{ op: '__proto__' }], []), /Unsupported/);
});
test('HTTP handlers: query, chat envelope, input validation and health', async t => {
  const { Readable } = await import('node:stream');
  const engine = setup(t), server = makeServer(engine, { demo: true });
  const handler = server.listeners('request')[0];
  const request = async (method, url, body, headers = {}) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, url, headers: { 'content-type': 'application/json', ...headers } });
    let status, result;
    await handler(req, { setHeader() {}, writeHead(value) { status = value; }, end(value) { result = JSON.parse(value); } });
    return { status, body: result };
  };
  const post = (path, body, headers) => request('POST', path, body, headers);
  assert.equal((await request('GET', '/health')).body.mode, 'offline-demo');
  const query = { prompt: 'Sort numbers ascending', data: [4, 2] };
  assert.equal((await post('/query', query)).body.answer, '[2,4]');
  const chat = (await post('/v1/chat/completions', { messages: [{ role: 'user', content: JSON.stringify(query) }] })).body;
  assert.equal(chat.choices[0].message.content, '[2,4]');
  assert.equal((await post('/query', {})).status, 400);
  assert.equal((await post('/query', query, { origin: 'https://example.com' })).status, 403);
  assert.equal((await post('/v1/chat/completions', { messages: [], stream: true })).status, 400);
  assert.equal((await post('/query', { prompt: 'x'.repeat(110000) })).status, 400);
});
test('live adapter sends expected model/messages and parses structured responses', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(url, 'https://example.invalid/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer fake-test-key');
    assert.equal(payload.model, 'router-test');
    assert.equal(payload.response_format.type, 'json_object');
    assert.equal(payload.messages[0].role, 'system');
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"programId":null,"confidence":0}' } }], usage: { total_tokens: 12 } }), { status: 200 });
  });
  const provider = new ModelProvider({ LLM_BASE_URL: 'https://example.invalid/v1', LLM_API_KEY: 'fake-test-key', ANSWER_MODEL: 'answer-test', ROUTER_MODEL: 'router-test', LEARNER_MODEL: 'learner-test' });
  const result = await provider.route({ prompt: 'hello' }, []);
  assert.equal(result.value.programId, null);
  assert.equal(result.usage.total_tokens, 12);
});
