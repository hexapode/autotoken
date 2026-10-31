import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, taskPrompt, containerArgs } from '../src/swe-runner.js';
import { dockerCommand } from '../src/container-tool.js';

test('SWE pilot defaults to development split and validates budgets/IDs', () => {
  const options = parseOptions(['--instance', 'marshmallow-code__marshmallow-1343']);
  assert.equal(options.split, 'dev'); assert.equal(options.evaluate, true);
  assert.equal(options.maxRequests, 30);
  for (const args of [[], ['--instance', ';rm -rf /'], ['--instance', 'a__b-1', '--max-requests', '0'], ['--instance', 'a__b-1', '--timeout-seconds', 'NaN'], ['--instance', 'a__b-1', '--surprise']]) assert.throws(() => parseOptions(args));
});
test('agent prompt excludes hints, gold patches, test patches and evaluation labels', () => {
  const prompt = taskPrompt({ repo: 'example/repo', instance_id: 'example__repo-1', problem_statement: 'Fix the bug', patch: 'SECRET_GOLD', test_patch: 'SECRET_TEST', hints_text: 'SECRET_HINT', FAIL_TO_PASS: 'SECRET_LABEL', eval_script: 'SECRET_EVAL' });
  assert.match(prompt, /Fix the bug/); assert.doesNotMatch(prompt, /SECRET/);
});
test('task container has no networking, volumes, Docker socket, or injected credentials', () => {
  const args = containerArgs('m2c-swe-0123456789abcdef', 'swebench/sweb.eval.x86_64.example:latest');
  assert.equal(args[args.indexOf('--network') + 1], 'none');
  assert.equal(args[args.indexOf('--cap-drop') + 1], 'ALL');
  assert.ok(args.includes('no-new-privileges'));
  assert.ok(!args.some(x => ['-v', '--volume', '--mount', '-e', '--env', '--privileged'].includes(x)));
  assert.throws(() => containerArgs('bad-container', 'image'));
  assert.throws(() => containerArgs('m2c-swe-0123456789abcdef', 'untrusted/image'));
});
test('model shell text is one container argument, never a host shell expression', () => {
  const malicious = 'echo $(cat /host/secret); touch /tmp/test';
  const args = dockerCommand('m2c-swe-0123456789abcdef', malicious, 9999);
  assert.equal(args.at(-1), malicious); assert.equal(args.at(-2), '120');
  assert.equal(args[0], 'exec'); assert.equal(args[3], 'm2c-swe-0123456789abcdef');
  assert.throws(() => dockerCommand('other-container', 'true'));
});

test('read-repair arms have identical public prompts and keep evaluator data out', () => {
  const task = {repo:'fixture/repo',instance_id:'fixture__repo-1',problem_statement:'Fix behavior',test_patch:'PRIVATE_ORACLE',patch:'PRIVATE_GOLD'};
  const baseline=taskPrompt(task,'local','read-range-baseline');
  assert.equal(baseline,taskPrompt(task,'local','read-range-repair'));
  assert.match(baseline,/str_replace_editor/);
  assert.doesNotMatch(baseline,/PRIVATE_|repair|retry/);
});
