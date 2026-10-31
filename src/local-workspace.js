import { mkdir, writeFile, copyFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { localEnvironment } from './local-tool.js';

export function localProfile(task) {
  if (!['marshmallow-code/marshmallow', 'pydicom/pydicom', 'pylint-dev/astroid'].includes(task.repo)) throw new Error('No verified local environment profile for this issue; use Docker or add a tested profile');
  return { python: task.repo === 'pylint-dev/astroid' ? '3.10' : '3.9', testPath: task.repo === 'pydicom/pydicom' ? 'pydicom/tests' : 'tests', packages: [task.repo === 'pylint-dev/astroid' ? 'setuptools==65.6.3' : 'setuptools==68.2.2', 'wheel==0.42.0', 'pytest==6.2.5', 'python-dateutil==2.8.2', 'simplejson==3.19.2', 'pytz==2021.3', 'packaging==24.2', ...(task.repo === 'pylint-dev/astroid' ? ['wrapt==1.14.1', 'lazy-object-proxy==1.9.0', 'typing_extensions==4.12.2', 'attrs==23.2.0', 'six==1.16.0'] : []), ...(task.repo === 'pydicom/pydicom' ? ['numpy==1.23.5', 'Pillow==9.5.0'] : [])] };
}
export async function prepareLocal(task, directory, command) {
  const profile = localProfile(task);
  const paths = { repo: join(directory, 'checkout'), venv: join(directory, 'task-venv'), home: join(directory, 'task-home'), temp: join(directory, 'task-tmp') };
  for (const path of [paths.repo, paths.home, paths.temp]) await mkdir(path);
  // Provision the host's trusted search utility without inheriting its full PATH.
  const search = await command('which', ['rg'], { allowFailure: true });
  if (search.code === 0 && search.stdout.trim()) {
    const bin = join(paths.home, 'bin');
    await mkdir(bin);
    await copyFile(search.stdout.trim(), join(bin, 'rg'));
    await chmod(join(bin, 'rg'), 0o755);
    await writeFile(join(directory, 'search-tool.json'), JSON.stringify({ source: search.stdout.trim(), version: (await command(join(bin, 'rg'), ['--version'])).stdout.trim() }, null, 2));
  }
  await command('git', ['init', '-q', paths.repo]);
  await command('git', ['-C', paths.repo, 'fetch', '--depth=1', `https://github.com/${task.repo}.git`, task.base_commit], { timeoutMs: 180000, log: join(directory, 'checkout.log') });
  await command('git', ['-C', paths.repo, 'checkout', '--detach', 'FETCH_HEAD']);
  const head = (await command('git', ['-C', paths.repo, 'rev-parse', 'HEAD'])).stdout.trim();
  if (head !== task.base_commit) throw new Error('Local checkout has wrong base commit');
  await command('uv', ['venv', '--python', profile.python, paths.venv], { timeoutMs: 180000, log: join(directory, 'venv.log') });
  const python = join(paths.venv, 'bin/python');
  await command('uv', ['pip', 'install', '--python', python, ...profile.packages], { timeoutMs: 180000, log: join(directory, 'dependencies.log') });
  await command('uv', ['pip', 'install', '--python', python, '--no-build-isolation', '--no-deps', '-e', paths.repo], { timeoutMs: 180000, log: join(directory, 'install.log') });
  const freeze = (await command('uv', ['pip', 'freeze', '--python', python])).stdout;
  await writeFile(join(directory, 'task-requirements.txt'), freeze);
  // Independent regression from the public issue; never uses SWE-bench's gold/test patches.
  const regression = ['marshmallow-code__marshmallow-1343', 'marshmallow-code__marshmallow-1359'].includes(task.instance_id) ? join(directory, 'issue-regression.py') : null;
  const regressionCode = task.instance_id === 'marshmallow-code__marshmallow-1359'
    ? `from datetime import datetime\nfrom marshmallow import Schema, fields\nclass Lists(Schema):\n    times = fields.List(fields.DateTime())\nclass Tuples(Schema):\n    times = fields.Tuple((fields.DateTime(),))\nfor cls in [Lists, Tuples]:\n    schema = cls()\n    result = schema.load({'times': ['2020-01-02T03:04:05']})\n    assert result['times'][0] == datetime(2020, 1, 2, 3, 4, 5), result\nprint('Public-issue list/tuple DateTime regression passed')\n`
    : `from marshmallow import Schema, fields, validates\nclass Bar(Schema):\n    value = fields.String()\n    @validates('value')\n    def validate_value(self, value):\n        pass\nclass Foo(Schema):\n    bar = fields.Nested(Bar)\nerrors = Foo().validate({'bar': 'invalid'})\nassert isinstance(errors, dict) and 'bar' in errors, repr(errors)\nprint('Public-issue regression passed')\n`;
  if (regression) await writeFile(regression, regressionCode);
  return { ...paths, profile, python, regression, env: localEnvironment(paths.repo, paths.venv, paths.home, paths.temp) };
}
export async function localTests(local, directory, phase, command) {
  const common = { cwd: local.repo, env: local.env, allowFailure: true, timeoutMs: 180000 };
  const suite = await command(local.python, ['-m', 'pytest', '-q', local.profile.testPath], { ...common, log: join(directory, `${phase}-tests.log`) });
  const regression = local.regression ? await command(local.python, [local.regression], { ...common, log: join(directory, `${phase}-regression.log`) }) : null;
  return { kind: 'local-tests-not-official-swebench', suite: { exitCode: suite.code, timedOut: suite.timedOut }, regression: regression ? { exitCode: regression.code, timedOut: regression.timedOut } : null, independentRegression: !!regression, passed: suite.code === 0 && !suite.timedOut && (!regression || (regression.code === 0 && !regression.timedOut)) };
}

export async function verifyLocalPatch(local, task, directory, command) {
  const repo = join(directory, 'evaluation-checkout');
  await command('git', ['clone', '--no-local', '--no-checkout', local.repo, repo], { timeoutMs: 180000 });
  await command('git', ['-C', repo, 'checkout', '--detach', task.base_commit]);
  await command('git', ['-C', repo, 'apply', '--binary', join(directory, 'patch.diff')]);
  const clean = { ...local, repo, env: localEnvironment(repo, local.venv, local.home, local.temp) };
  return { ...await localTests(clean, directory, 'after', command), freshCheckout: true };
}
