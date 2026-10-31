import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { localEnvironment } from './local-tool.js';
const exec = promisify(execFile);

export const VALIDATION_ARMS = Object.freeze(['singleton', 'workflow']);
export function testCommandObserved(command) {
  // Detection only: never interpolate any matched shell text into a workflow.
  return typeof command === 'string' && /(?:^|[;\n&])\s*(?:python(?:3)?\s+-m\s+)?pytest(?:\s|$)/.test(command);
}
export function testsSucceeded(result) {
  return result?.code === 0 && result.timedOut === false && typeof result.output === 'string' && !result.output.includes('[output truncated]') && /\b\d+ passed\b/.test(result.output) && !/\b(?:failed|errors?|ERROR|FAILURES)\b/i.test(result.output);
}
export function validationSteps(arm, testPath) {
  if (!VALIDATION_ARMS.includes(arm)) throw new Error('Unknown validation arm');
  if (!['tests', 'pydicom/tests'].includes(testPath)) throw new Error('Unsupported test path');
  return arm === 'singleton' ? ['git diff --check'] : [`python -m pytest -q ${testPath}`, 'git diff --check', 'git diff --stat'];
}
export async function patchFingerprint(paths) {
  const root = await realpath(paths.repo);
  const options = { cwd: root, env: localEnvironment(paths.repo, paths.venv, paths.home, paths.temp), maxBuffer: 10 * 1024 * 1024, timeout: 10000, encoding: 'buffer' };
  const diff = (await exec('git', ['diff', 'HEAD', '--binary'], options)).stdout;
  const untracked = (await exec('git', ['ls-files', '--others', '--exclude-standard', '-z'], options)).stdout.toString().split('\0').filter(Boolean).sort();
  if (!diff.length && !untracked.length) return null;
  const hash = createHash('sha256').update(diff);
  for (const file of untracked) {
    const path = resolve(root, file);
    if (!path.startsWith(root + sep)) throw new Error('Untracked path escapes checkout');
    const info = await lstat(path);
    // Avoid following symlinks or reading special files; abstain instead.
    if (!info.isFile() || info.size > 10 * 1024 * 1024 || !(await realpath(path)).startsWith(root + sep)) throw new Error('Unsupported untracked file');
    hash.update('\0' + file + '\0'); hash.update(await readFile(path));
  }
  return hash.digest('hex');
}
export class ValidationWorkflow {
  constructor(arm, testPath) { this.arm = arm; this.steps = validationSteps(arm, testPath); this.seen = new Set(); }
  async afterAction({ command, result, fingerprint, execute, fingerprintAfter }) {
    if (!fingerprint || this.seen.has(fingerprint) || !testCommandObserved(command) || !testsSucceeded(result)) return { triggered: false, steps: [] };
    this.seen.add(fingerprint);
    const steps = [];
    for (const command of this.steps) {
      const result = await execute(command);
      steps.push({ command, ...result });
      if (result.code !== 0 || result.timedOut || result.output?.includes('[output truncated]') || (command.startsWith('python') && !testsSucceeded(result))) return { triggered: true, status: 'fallback', reason: 'Validation failed or was inconclusive; model must inspect results', fingerprint, steps };
    }
    if (fingerprintAfter && await fingerprintAfter() !== fingerprint) return { triggered: true, status: 'fallback', reason: 'Patch changed during validation; model must inspect results', fingerprint, steps };
    return { triggered: true, status: 'validated', reason: 'Configured checks passed; this is not proof the issue is fixed', fingerprint, steps };
  }
}
export function renderValidation(report) {
  if (!report.triggered) return '';
  return `\n\n[Automatic ${report.steps.length === 1 ? 'single-check' : 'validation workflow'} result: ${report.status}]\n` + report.steps.map(step => `$ ${step.command}\nExit code: ${step.code}; timed out: ${step.timedOut}\n${step.output}`).join('\n') + `\n${report.reason}. Continue reviewing the task; do not repeat unchanged checks without a reason.\n`;
}
