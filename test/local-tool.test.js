import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localEnvironment, runLocalCommand } from '../src/local-tool.js';
import { localProfile } from '../src/local-workspace.js';
import { parseOptions, taskPrompt } from '../src/swe-runner.js';

test('local mode is explicit and prompt does not claim container isolation', () => {
  const options = parseOptions(['--execution', 'local', '--instance', 'a__b-1']);
  assert.equal(options.execution, 'local');
  const prompt = taskPrompt({ repo: 'a/b', instance_id: 'a__b-1', problem_statement: 'fix' }, 'local');
  assert.match(prompt, /local_bash/); assert.match(prompt, /not a sandbox/);
  assert.doesNotMatch(prompt, /container_bash|\/testbed/);
  assert.throws(() => parseOptions(['--execution', 'unknown', '--instance', 'a__b-1']));
});
test('local tool environment does not inherit API keys, proxy tokens or shell init files', () => {
  const env = localEnvironment('/repo', '/venv', '/home', '/temp');
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'PATH', 'PYTEST_DISABLE_PLUGIN_AUTOLOAD', 'PYTHONNOUSERSITE', 'PYTHONPATH', 'TMPDIR', 'VIRTUAL_ENV']);
  assert.equal(env.HOME, '/home'); assert.match(env.PATH, /^\/venv\/bin:/);
  assert.throws(() => localEnvironment('relative', '/venv', '/home', '/temp'));
});
test('local tool runs in its checkout and terminates a timed-out command group', async t => {
  const root = await mkdtemp(join(tmpdir(), 'm2c-local-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = { repo: join(root, 'repo'), venv: join(root, 'venv'), home: join(root, 'home'), temp: join(root, 'tmp') };
  for (const path of Object.values(paths)) await mkdir(path);
  const result = await runLocalCommand(paths, 'printf "%s" "$PWD"');
  assert.equal(result.code, 0); assert.equal(result.output, await realpath(paths.repo));
  const timeout = await runLocalCommand(paths, 'sleep 30', 1);
  assert.equal(timeout.timedOut, true); assert.equal(timeout.code, null);
});
test('unknown local repositories fail instead of guessing dependencies', () => {
  assert.throws(() => localProfile({ repo: 'unknown/repo', instance_id: 'unknown__repo-1' }), /No verified local/);
  assert.equal(localProfile({ repo: 'marshmallow-code/marshmallow', instance_id: 'marshmallow-code__marshmallow-1343' }).python, '3.9');
});
