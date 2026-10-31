import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DemoProvider } from '../src/provider.js';
import { grade, validateDataset, summarize, summarizeCalls, runEvaluation } from '../src/evaluate.js';

const fixture = () => JSON.parse(readFileSync(new URL('../eval/dataset.json', import.meta.url), 'utf8'));
function output(t) {
  const dir = mkdtempSync(join(tmpdir(), 'm2c-eval-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'run');
}
test('independent oracle handles JSON, text, unscored and wrong answers', () => {
  assert.equal(grade({ kind: 'json', value: { a: 1, b: 2 } }, '{ "b":2,"a":1 }'), true);
  assert.equal(grade({ kind: 'json', value: [1, 2] }, '[2,1]'), false);
  assert.equal(grade({ kind: 'json', value: 3 }, '```json\n3\n```'), false);
  assert.equal(grade({ kind: 'text', value: 'hello' }, 'hello\n'), true);
  assert.equal(grade({ kind: 'unscored' }, 'anything'), null);
});
test('rejects duplicate IDs, request contamination and cross-split input leakage', () => {
  validateDataset(fixture());
  const ids = fixture(); ids.test[0].id = ids.discovery[0].id;
  assert.throws(() => validateDataset(ids), /duplicate case ID/);
  const duplicate = fixture(); duplicate.test[0].request = duplicate.discovery[0].request;
  assert.throws(() => validateDataset(duplicate), /Duplicate request/);
  const data = fixture(); data.test[0].request.data = data.discovery[0].request.data;
  assert.throws(() => validateDataset(data), /leaks across splits/);
});
test('no program responses is N/A, not perfect routing accuracy; unknown usage is explicit', () => {
  const report = summarize([{ expected: { kind: 'unscored' }, automatable: false, proxy: { route: 'model', correct: null, latencyMs: 2 }, baseline: { correct: null, latencyMs: 3 } }]);
  assert.equal(report.incorrectProgramRate, null);
  assert.equal(report.proxy.accuracy, null);
  assert.deepEqual(summarizeCalls([{ kind: 'route', usage: null, error: 'timeout' }]), { attempted: 1, failed: 1, byKind: { answer: 0, route: 1, discover: 0 }, knownTotalTokens: 0, callsWithoutTokenUsage: 1 });
});
test('end-to-end evaluation separates phases and never sends labels to providers', async t => {
  const data = fixture(), provider = new DemoProvider();
  const original = provider.discover.bind(provider);
  let discoverCalls = 0;
  provider.discover = async (traffic, programs) => {
    discoverCalls++;
    assert.equal(traffic.length, data.discovery.length);
    for (const event of traffic) {
      assert.equal(Object.hasOwn(event.request, 'expected'), false);
      assert.ok(data.discovery.some(item => item.request.prompt === event.request.prompt));
    }
    return original(traffic, programs);
  };
  const route = provider.route.bind(provider);
  provider.route = (request, programs) => {
    assert.deepEqual(Object.keys(request).sort(), ['data', 'prompt']);
    return route(request, programs);
  };
  const outputDir = output(t);
  const report = await runEvaluation({ dataset: data, provider, outputDir, mode: 'demo' });
  assert.equal(discoverCalls, 1);
  assert.equal(report.promotion.filter(p => p.active).length, 1);
  assert.equal(report.results.length, data.test.length);
  assert.equal(report.summary.programResponses, 3);
  assert.equal(report.summary.incorrectProgramResponses, 0);
  assert.equal(report.usage.proxyTest.byKind.answer, data.test.length - 3);
  assert.equal(report.usage.baselineTest.byKind.answer, data.test.length);
  assert.equal(report.usage.setup.byKind.discover, 1);
  assert.ok(report.usage.proxyIncludingSetup.attempted > report.usage.baselineTest.attempted);
  assert.equal(JSON.parse(readFileSync(join(outputDir, 'report.json'), 'utf8')).mode, 'demo');
  assert.match(readFileSync(join(outputDir, 'report.md'), 'utf8'), /NOT evidence of real model/);
  await assert.rejects(runEvaluation({ dataset: data, provider, outputDir }), /EEXIST/);
});
test('teacher/program agreement cannot override the independent calibration oracle', async t => {
  const data = fixture();
  data.calibration[0].expected.value = [999];
  const report = await runEvaluation({ dataset: data, provider: new DemoProvider(), outputDir: output(t) });
  assert.equal(report.promotion[0].active, false);
  assert.match(report.promotion[0].reason, /Independent calibration oracle/);
  assert.equal(report.summary.programResponses, 0);
});
test('bad routing on the test split is counted without adapting the registry', async t => {
  const provider = new DemoProvider(), data = fixture();
  const route = provider.route.bind(provider);
  provider.route = async (request, programs) => {
    if (request.prompt === data.test.find(c => c.id === 't-descending').request.prompt) return { value: { programId: programs[0]?.id, confidence: 1 } };
    return route(request, programs);
  };
  const report = await runEvaluation({ dataset: data, provider, outputDir: output(t) });
  assert.equal(report.summary.incorrectProgramResponses, 1);
  assert.equal(report.registry[0].status, 'active');
});
test('provider failures remain in call accounting and request errors', async t => {
  const data = fixture(), provider = new DemoProvider();
  const answer = provider.answer.bind(provider);
  provider.answer = request => {
    if (request.prompt === data.test.find(c => c.id === 't-subjective').request.prompt) throw new Error('Test provider timeout');
    return answer(request);
  };
  const report = await runEvaluation({ dataset: data, provider, outputDir: output(t) });
  assert.equal(report.summary.proxy.errors, 1);
  assert.equal(report.summary.baseline.errors, 1);
  assert.equal(report.usage.proxyTest.failed, 1);
  assert.equal(report.usage.baselineTest.failed, 1);
});
