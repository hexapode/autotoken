import { spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';

// Environment minimization is not a filesystem or network sandbox.
export function localEnvironment(repo, venv, home, temp) {
  if (![repo, venv, home, temp].every(isAbsolute)) throw new Error('Local task paths must be absolute');
  return { PATH: `${join(venv, 'bin')}:${join(home, 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin`, HOME: home, TMPDIR: temp, VIRTUAL_ENV: venv, PYTHONPATH: join(repo, 'src'), PYTHONNOUSERSITE: '1', PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1' };
}
export function runLocalCommand({ repo, venv, home, temp }, command, seconds = 120, signal) {
  if (typeof command !== 'string' || !command.trim() || command.length > 100000) throw new Error('Invalid command');
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', ['--noprofile', '--norc', '-c', command], { cwd: repo, env: localEnvironment(repo, venv, home, temp), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', truncated = false, timedOut = false;
    const append = data => { const text = data.toString(); if (output.length + text.length > 30000) truncated = true; output += text.slice(0, Math.max(0, 30000 - output.length)); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => { timedOut = true; kill(); }, Math.min(120, Math.max(1, Number(seconds) || 120)) * 1000);
    signal?.addEventListener('abort', kill, { once: true }); if (signal?.aborted) kill();
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', kill); };
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => { cleanup(); resolve({ code, timedOut, output: output + (truncated ? '\n[output truncated]' : '') }); });
  });
}
