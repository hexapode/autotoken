import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRecordingServer } from './recording-proxy.js';
import { summarizeTraces } from './trace.js';

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address().port); });
});
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
const event = value => `data: ${JSON.stringify(value)}\n\n`;
let proxy, upstream;
try {
  const directory = await mkdtemp(join(tmpdir(), 'm2c-pi-smoke-'));
  const agentDir = join(directory, 'agent'), workDir = join(directory, 'work'), traces = join(directory, 'traces');
  await mkdir(agentDir); await mkdir(workDir);
  const marker = 'M2C_TOOL_READ_CONFIRMED_7382';
  await writeFile(join(workDir, 'fixture.txt'), marker);
  const requests = [];
  upstream = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
      assert.equal(req.headers.authorization, 'Bearer mock-upstream');
      assert.equal(body.model, 'm2c-smoke');
      assert.equal(body.stream, true);
      assert.ok(body.tools.some(tool => tool.function?.name === 'read'));
      assert.ok(requests.length <= 2, 'Unexpected extra model call');
      if (requests.length === 2) {
        assert.ok(body.messages.some(message => message.role === 'tool' && JSON.stringify(message.content).includes(marker)), 'Actual Pi read result missing');
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = requests.length === 1
        ? { role: 'assistant', tool_calls: [{ index: 0, id: 'read_fixture', type: 'function', function: { name: 'read', arguments: '{"path":"fixture.txt"}' } }] }
        : { role: 'assistant', content: 'Pi tool round-trip confirmed.' };
      const finish_reason = requests.length === 1 ? 'tool_calls' : 'stop';
      const base = { id: `chatcmpl-smoke-${requests.length}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'm2c-smoke' };
      res.write(event({ ...base, choices: [{ index: 0, delta, finish_reason: null }] }));
      res.write(event({ ...base, choices: [{ index: 0, delta: {}, finish_reason }] }));
      res.write(event({ ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
      res.end('data: [DONE]\n\n');
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); }
  });
  const upstreamPort = await listen(upstream);
  proxy = createRecordingServer({ upstreamBase: `http://127.0.0.1:${upstreamPort}/v1`, upstreamKey: 'mock-upstream', proxyToken: 'mock-local', directory: traces });
  const proxyPort = await listen(proxy);
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { 'm2c-smoke': {
    baseUrl: `http://127.0.0.1:${proxyPort}/v1`, api: 'openai-completions', apiKey: 'mock-local',
    headers: { 'X-M2C-Run-ID': 'pi-smoke', 'X-M2C-Session-ID': 'session-1' },
    models: [{ id: 'm2c-smoke', name: 'Mock model', reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }]
  } } }));
  const pi = resolve('node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [pi, '--offline', '--no-extensions', '--no-skills', '--no-context-files', '--no-prompt-templates', '--no-mcp', '--no-session', '--no-approve', '--tools', 'read', '--provider', 'm2c-smoke', '--model', 'm2c-smoke', '--print', 'Read fixture.txt using the read tool and confirm its contents.'], {
      cwd: workDir, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || tmpdir(), PI_CODING_AGENT_DIR: agentDir, PI_TELEMETRY: '0' }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => { clearTimeout(timeout); code === 0 ? resolve(stdout) : reject(new Error(`Pi exited ${code}: ${stderr}\n${stdout}`)); });
  });
  assert.match(output, /Pi tool round-trip confirmed/); assert.equal(requests.length, 2);
  for (let i = 0; i < 100; i++) {
    const ids = await readdir(traces);
    const states = await Promise.all(ids.map(async id => JSON.parse(await readFile(join(traces, id, 'metadata.json'), 'utf8')).state));
    if (states.length === 2 && states.every(state => state === 'complete')) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const summary = await summarizeTraces(traces);
  assert.equal(summary.completeTransports, 2); assert.equal(summary.knownTotalTokens, 30);
  console.log(`Pi smoke passed: real Pi executed a read tool and returned its result through the proxy.\nMock provider only; no paid model calls.\nTraces: ${traces}`);
} catch (error) { console.error(error); process.exitCode = 1; }
finally { if (proxy) await close(proxy); if (upstream) await close(upstream); }
