import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Analysis is separate from forwarding. Unknown events remain intact in response.bin.
export function inspectResponse(buffer, headers, endpoint = '/v1/chat/completions') {
  if (headers['content-encoding'] && headers['content-encoding'] !== 'identity') return { usage: null, parseError: 'Compressed response retained raw; analysis unavailable' };
  const text = buffer.toString('utf8');
  if (!String(headers['content-type']).includes('text/event-stream')) {
    try {
      const body = JSON.parse(text);
      if (endpoint === '/v1/responses') return { usage: body.usage ?? null, output: body.output ?? [], status: body.status ?? null, error: body.error ?? null, incomplete_details: body.incomplete_details ?? null };
      return { usage: body.usage ?? null, choices: body.choices ?? [], error: body.error ?? null };
    } catch { return { usage: null, parseError: 'Non-JSON response' }; }
  }
  let usage = null, done = false, malformedEvents = 0;
  let status = null, error = null, incomplete_details = null, finalOutput = null;
  const outputItems = new Map();
  const choices = new Map();
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data) continue;
    if (data.trim() === '[DONE]') { done = true; continue; }
    try {
      const value = JSON.parse(data);
      if (endpoint === '/v1/responses') {
        if (value.type === 'response.output_item.done' && value.item) outputItems.set(value.output_index, value.item);
        if (['response.completed', 'response.failed', 'response.incomplete'].includes(value.type)) {
          done = true;
          status = value.response?.status ?? value.type.slice('response.'.length);
          usage = value.response?.usage ?? null;
          error = value.response?.error ?? null;
          incomplete_details = value.response?.incomplete_details ?? null;
          finalOutput = value.response?.output ?? null;
        }
        if (value.type === 'error') { error = value; status = 'failed'; }
        continue;
      }
      if (value.usage) usage = value.usage;
      for (const choice of value.choices || []) {
        if (!choices.has(choice.index)) choices.set(choice.index, { index: choice.index, message: { role: 'assistant', content: '', tool_calls: [] }, finish_reason: null });
        const target = choices.get(choice.index), delta = choice.delta || {};
        if (typeof delta.content === 'string') target.message.content += delta.content;
        if (choice.finish_reason) target.finish_reason = choice.finish_reason;
        for (const tool of delta.tool_calls || []) {
          // Bound indexes from malformed provider output; raw bytes are still preserved.
          if (!Number.isInteger(tool.index) || tool.index < 0 || tool.index > 1000) continue;
          const current = target.message.tool_calls[tool.index] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (tool.id) current.id = tool.id;
          if (tool.type) current.type = tool.type;
          if (typeof tool.function?.name === 'string') current.function.name += tool.function.name;
          if (typeof tool.function?.arguments === 'string') current.function.arguments += tool.function.arguments;
        }
      }
    } catch { malformedEvents++; }
  }
  if (endpoint === '/v1/responses') return { usage, output: finalOutput ?? [...outputItems.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item), status, error, incomplete_details, done, malformedEvents };
  return { usage, choices: [...choices.values()], done, malformedEvents };
}

export async function summarizeTraces(directory) {
  const traces = [], unreadable = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try { traces.push(JSON.parse(await readFile(join(directory, entry.name, 'metadata.json'), 'utf8'))); }
    catch { unreadable.push(entry.name); }
  }
  traces.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const known = traces.filter(t => Number.isFinite(t.response?.usage?.total_tokens));
  const groups = new Map();
  for (const t of traces) {
    const key = JSON.stringify([t.runId, t.instanceId, t.sessionId]);
    if (!groups.has(key)) groups.set(key, { runId: t.runId, instanceId: t.instanceId, sessionId: t.sessionId, calls: 0, traceIds: [] });
    const group = groups.get(key); group.calls++; group.traceIds.push(t.id);
  }
  return {
    mode: 'record-only', calls: traces.length, unreadable,
    completeTransports: traces.filter(t => t.state === 'complete').length,
    upstreamErrors: traces.filter(t => t.upstreamStatus >= 400).length,
    responseFailures: traces.filter(t => ['failed', 'incomplete'].includes(t.response?.status) || t.response?.error).length,
    interrupted: traces.filter(t => t.state !== 'complete').length,
    incompleteRecordings: traces.filter(t => t.recordingTruncated || t.recordingError).length,
    streamsWithoutDone: traces.filter(t => t.stream && t.response?.done === false).length,
    knownTotalTokens: known.reduce((sum, t) => sum + t.response.usage.total_tokens, 0),
    callsWithoutTokenUsage: traces.length - known.length,
    groups: [...groups.values()]
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  summarizeTraces(process.argv[2] || './data/trajectories').then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
