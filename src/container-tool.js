import { spawn } from 'node:child_process';

export function dockerCommand(container, command, seconds = 120) {
  if (!/^m2c-swe-[a-f0-9]{16}$/.test(container)) throw new Error('Invalid task container');
  if (typeof command !== 'string' || !command.trim() || command.length > 100000) throw new Error('Invalid command');
  const timeout = Math.min(120, Math.max(1, Math.floor(Number(seconds) || 120)));
  return ['exec', '-w', '/testbed', container, '/bin/bash', '-c',
    'if [ -f /opt/miniconda3/bin/activate ]; then source /opt/miniconda3/bin/activate testbed; fi; exec timeout --signal=TERM --kill-after=5s "$1" /bin/bash -c "$2"',
    'm2c-tool', String(timeout), command];
}
export function runContainerCommand(container, command, seconds, signal) {
  const args = dockerCommand(container, command, seconds);
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', truncated = false;
    const append = data => { if (output.length < 30000) output += data.toString().slice(0, 30000 - output.length); else truncated = true; };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const abort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.on('error', error => { signal?.removeEventListener('abort', abort); reject(error); });
    child.on('close', code => { signal?.removeEventListener('abort', abort); resolve({ code, output: output + (truncated ? '\n[output truncated]' : '') }); });
  });
}
