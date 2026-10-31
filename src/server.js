import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { Store } from './store.js';
import { Engine } from './engine.js';
import { ModelProvider, DemoProvider } from './provider.js';

async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 100000) throw new Error('Request exceeds 100 KB');
  }
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected JSON object');
  return parsed;
}
function validateQuery(data) {
  if (typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 16000) throw new Error('prompt must be a nonempty string of at most 16000 characters');
  if (Object.keys(data).some(k => !['prompt', 'data'].includes(k))) throw new Error('Supported query fields: prompt, data');
  return data;
}
export function makeServer(engine, { demo = false, learnEvery = 0 } = {}) {
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const send = (status, value) => { res.writeHead(status); res.end(JSON.stringify(value)); };
    // Local API has no authentication. Reject browser-origin requests and non-JSON writes.
    if (req.headers.origin) return send(403, { error: 'Browser-origin requests are not supported' });
    if (req.method === 'POST' && !req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'Use application/json' });
    try {
      if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, mode: demo ? 'offline-demo' : 'live' });
      if (req.method === 'GET' && req.url === '/stats') return send(200, engine.stats());
      if (req.method === 'GET' && req.url === '/programs') return send(200, engine.store.state.programs);
      if (req.method === 'POST' && req.url === '/learn') return send(200, await engine.learn());
      const match = req.url.match(/^\/programs\/([a-f0-9-]+)\/(active|shadow|disabled)$/);
      if (req.method === 'POST' && match) return send(200, engine.setStatus(match[1], match[2]));
      if (req.method === 'POST' && ['/query', '/v1/chat/completions'].includes(req.url)) {
        const input = await body(req);
        let request;
        if (req.url === '/query') request = validateQuery(input);
        else {
          if (Object.keys(input).some(k => !['model', 'messages', 'stream'].includes(k)) || (input.stream !== undefined && input.stream !== false)) throw new Error('Supported chat fields: model, messages, stream:false');
          if (!Array.isArray(input.messages) || !input.messages.length || !input.messages.every(m => m && ['system', 'user', 'assistant', 'developer'].includes(m.role) && typeof m.content === 'string' && Object.keys(m).every(k => ['role', 'content'].includes(k)))) throw new Error('Only plain text messages are supported');
          // Explicit single-user JSON envelope opts into deterministic programs.
          request = { messages: input.messages };
          if (input.messages.length === 1 && input.messages[0].role === 'user') {
            try { request = validateQuery(JSON.parse(input.messages[0].content)); } catch { /* ordinary conversation */ }
          }
        }
        const event = await engine.query(request);
        if (learnEvery > 0 && engine.store.state.totalRequests % learnEvery === 0 && !engine.learning) {
          engine.learn().catch(error => console.error(`Discovery failed: ${error.message}`));
        }
        if (req.url === '/query') return send(200, event);
        return send(200, {
          id: `chatcmpl-${event.id}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000),
          model: event.route === 'program' ? `program:${event.programId}` : event.calls.find(c => c.kind === 'answer')?.model,
          choices: [{ index: 0, message: { role: 'assistant', content: event.answer }, finish_reason: 'stop' }],
          proxy: { route: event.route, programId: event.programId, shadow: event.shadow, calls: event.calls }
        });
      }
      return send(404, { error: 'Not found' });
    } catch (error) {
      send(error.message.startsWith('Upstream') ? 502 : 400, { error: error.message });
    }
  });
  server.requestTimeout = 70000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const demo = process.env.DEMO_MODE === 'true';
  const engine = new Engine(new Store(process.env.DATA_DIR || './data'), demo ? new DemoProvider() : new ModelProvider());
  const server = makeServer(engine, { demo, learnEvery: Number(process.env.LEARN_EVERY || 0) });
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '127.0.0.1', () => console.log(`ModelToCode ${demo ? '(OFFLINE DEMO)' : '(live)'} listening at http://127.0.0.1:${port}`));
}
