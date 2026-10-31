import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRun, aggregateRuns, classifyCommand } from '../src/trajectory-analysis.js';
import { validateCandidate, generateProgram, replayProposal } from '../src/agent-programs.js';

const turn = (id, instanceId, phase = 'initial', command = 'git status --short; ls') => ({ id, instanceId, phase, valid: true, previousToolResult: null, actions: [{ name: 'local_bash', command, tags: ['workspace-inspection'] }], tags: ['workspace-inspection'], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 5 } } });
const evidence = [turn('a', 'issue-a'), turn('b', 'issue-b')];
const candidate = () => ({ name: 'inspect_workspace', description: 'Workspace inspection substep, not proven full-turn replacement', guard: 'initial', operations: ['git_status', 'list_root'], sourceTraceIds: ['a', 'b'] });

test('trace extraction links tool results and counts current actions only', () => {
  const metadata = (id, output, startedAt) => ({ id, instanceId: 'issue-a', state: 'complete', upstreamStatus: 200, startedAt, response: { output, done: true } });
  const action = { type: 'function_call', name: 'local_bash', call_id: 'call1', arguments: '{"command":"ls"}' };
  const toolResult = { type: 'function_call_output', call_id: 'call1', output: 'Exit code: 0; timed out: false\na.py' };
  const run = extractRun({ options: { instance: 'issue-a', split: 'dev' }, evaluation: { kind: 'local-tests-not-official-swebench', passed: true } }, [
    { metadata: metadata('b', [], '2026-01-02'), request: { input: [action, toolResult] } },
    { metadata: metadata('a', [action], '2026-01-01'), request: { input: [] } }
  ], '/run');
  assert.equal(run.turns.length, 2); assert.equal(run.turns[0].actions.length, 1); assert.equal(run.turns[1].actions.length, 0);
  assert.equal(run.turns[0].actions[0].result, toolResult.output);
  assert.equal(run.turns[1].previousToolResult, toolResult.output);
});

test('repeated rollouts of one issue are not distinct evidence; cached input not double-counted', () => {
  const report = aggregateRuns([{ instanceId: 'same', turns: [turn('a', 'same')] }, { instanceId: 'same', turns: [turn('b', 'same')] }]);
  assert.equal(report.distinctIssues, 1); assert.equal(report.patterns[0].distinctIssues, 1);
  assert.equal(report.knownInputTokens, 20); assert.equal(report.knownTotalTokens, 24); assert.equal(report.knownCachedInputTokens, 10);
});

test('behavior classification is multi-label and does not execute shell text', () => {
  assert.deepEqual(classifyCommand('python -m pytest -q; git diff --check'), ['test-run', 'diff-review']);
  assert.deepEqual(classifyCommand('pwd; git status --short; ls'), ['workspace-inspection']);
});

test('candidate validation rejects invented evidence, duplicate issue evidence and arbitrary code', () => {
  assert.equal(validateCandidate(candidate(), evidence).status, 'proposed');
  assert.throws(() => validateCandidate({ ...candidate(), sourceTraceIds: ['a', 'invented'] }, evidence));
  assert.throws(() => validateCandidate(candidate(), [turn('a', 'same'), turn('b', 'same')]));
  assert.throws(() => validateCandidate({ ...candidate(), operations: ['eval'] }, evidence));
  assert.throws(() => validateCandidate({ ...candidate(), name: '../../escape' }, evidence));
  assert.throws(() => validateCandidate({ ...candidate(), guard: 'after_tests_pass' }, evidence));
});

test('compiled candidate only proposes fixed commands under its guard', async () => {
  const spec = validateCandidate(candidate(), evidence);
  const { default: propose } = await import(`data:text/javascript;base64,${Buffer.from(generateProgram(spec)).toString('base64')}`);
  assert.equal(propose({ phase: 'continuation', toolName: 'local_bash' }), null);
  assert.equal(propose({ phase: 'initial', toolName: 'unknown' }), null);
  assert.deepEqual(propose({ phase: 'initial', toolName: 'local_bash', command: 'rm -rf /' }), { name: 'local_bash', arguments: { command: 'git status --short; ls', timeout: 30 } });
});

test('post-test guard abstains on failed, missing or ambiguous results', async () => {
  const source = generateProgram({ guard: 'after_tests_pass', operations: ['diff_check'] });
  const { default: propose } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const context = { phase: 'continuation', toolName: 'local_bash' };
  for (const result of [null, 'Exit code: 1; timed out: false\n5 passed, 1 failed', 'Exit code: 0; timed out: false\nhello']) assert.equal(propose({ ...context, previousToolResult: result }), null);
  assert.equal(propose({ ...context, previousToolResult: 'Exit code: 0; timed out: false\n5 passed in 1s' }).arguments.command, 'git diff --check');
});

test('replay distinguishes command substeps from exact full-action matches', async () => {
  const turns = [turn('a', 'issue-a'), turn('b', 'issue-b', 'initial', 'git status --short; ls; cat README.md')];
  const replay = await replayProposal(validateCandidate(candidate(), turns), turns);
  assert.equal(replay.triggered, 2); assert.equal(replay.exactCommandMatches, 1);
  assert.equal(replay.kind, 'discovery-replay-not-held-out');
});
