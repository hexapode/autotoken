import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createRecordingServer, dispatch } from './recording-proxy.js';
import { summarizeTraces } from './trace.js';

const model = 'gpt-6.1-sol';
const directory = resolve('data/live-smoke', new Date().toISOString().replaceAll(':', '-'));
let server;
try {
  const key = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Set LLM_API_KEY or OPENAI_API_KEY');
  const agentDir = join(directory, 'agent'), workDir = join(directory, 'work'), traceDir = join(directory, 'traces');
  await mkdir(agentDir, { recursive: true, mode: 0o700 }); await mkdir(workDir);
  const marker = `M2C_${randomBytes(12).toString('hex')}`;
  await writeFile(join(workDir, 'fixture.txt'), marker);
  const token = randomBytes(24).toString('hex');
  let attempts = 0;
  server = createRecordingServer({
    upstreamBase: process.env.LLM_BASE_URL || 'https://api.openai.com/v1', upstreamKey: key,
    proxyToken: token, directory: traceDir, runId: 'gpt-6.1-sol-live-smoke', sessionId: 'session-1', timeoutMs: 120000,
    transport: options => {
      if (++attempts > 4) throw new Error('Smoke test request limit reached');
      const payload = JSON.parse(options.body);
      assert.equal(options.url.pathname.endsWith('/responses'), true);
      assert.equal(payload.model, model);
      assert.equal(payload.reasoning?.effort, 'medium');
      assert.ok(payload.max_output_tokens > 0 && payload.max_output_tokens <= 4096);
      return dispatch(options);
    }
  });
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const config = { providers: { 'model-to-code': {
    baseUrl: `http://127.0.0.1:${port}/v1`, api: 'openai-responses', apiKey: '$PROXY_TOKEN',
    models: [{ id: model, name: model, reasoning: true, input: ['text'], contextWindow: 1050000, maxTokens: 4096,
      cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 } }]
  } } };
  await writeFile(join(agentDir, 'models.json'), JSON.stringify(config, null, 2));
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ transport: 'sse', retry: { enabled: false, provider: { maxRetries: 0 } } }));
  console.log(`Live smoke: ${model}, medium reasoning, read tool only, maximum 4 requests.\nArtifacts: ${directory}`);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [resolvePath(), '--offline', '--no-extensions', '--no-skills', '--no-context-files', '--no-prompt-templates', '--no-mcp', '--no-session', '--no-approve', '--tools', 'read', '--provider', 'model-to-code', '--model', model, '--thinking', 'medium', '--print', 'Use the read tool to read fixture.txt. Reply with exactly the complete token stored in that file, with no extra text.'], {
      cwd: workDir, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || tmpdir(), PI_CODING_AGENT_DIR: agentDir, PI_TELEMETRY: '0', PROXY_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timeout); resolve({ code, signal, stdout, stderr }); });
  });
  // Wait for post-stream metadata to flush before verifying it.
  let metadata = [];
  for (let i = 0; i < 100; i++) {
    const ids = await readdir(traceDir).catch(() => []);
    metadata = await Promise.all(ids.map(async id => JSON.parse(await readFile(join(traceDir, id, 'metadata.json'), 'utf8'))));
    if (metadata.length && metadata.every(m => m.state !== 'in-progress')) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const requests = await Promise.all(metadata.map(m => readFile(join(traceDir, m.id, 'request.json'), 'utf8').then(JSON.parse)));
  const summary = await summarizeTraces(traceDir);
  const verified = result.code === 0 && result.stdout.trim() === marker && requests.some(r => r.input?.some(item => item.type === 'function_call_output' && JSON.stringify(item.output).includes(marker)));
  await writeFile(join(directory, 'result.json'), JSON.stringify({ model, reasoning: 'medium', verified, ...result, summary }, null, 2), { mode: 0o600 });
  if (!verified) {
    console.error(`Live test did not complete. Pi exit: ${result.code}; upstream statuses: ${metadata.map(m => m.upstreamStatus).join(', ')}. Inspect result.json and traces. No alternative model was used.`);
    process.exitCode = 1;
  } else console.log(`PASS: live model requested a file read and correctly returned the unseen token.\n${JSON.stringify(summary, null, 2)}`);
} catch (error) { console.error(`Live smoke failed: ${error.message}`); process.exitCode = 1; }
finally { if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
function resolvePath() { return resolve('node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'); }
