import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const json = async file => JSON.parse(await readFile(file, 'utf8'));
export function classifyCommand(command) {
  const tags = [];
  // Heuristic tags for browsing evidence, never an execution/authorization decision.
  if (/(?:^|[;\n&])\s*(?:pwd|ls|git status)\b/.test(command)) tags.push('workspace-inspection');
  if (/(?:^|[;\n&])\s*(?:rg|grep|find)\b/.test(command)) tags.push('search');
  if (/(?:^|[;\n&])\s*(?:sed|cat|head|tail)\b/.test(command)) tags.push('file-read');
  if (/\b(?:python(?:3)? -m )?pytest\b/.test(command)) tags.push('test-run');
  if (/\bgit diff\b/.test(command)) tags.push('diff-review');
  if (/write_text\(|open\([^\n]+['"]w['"]|\.write\(|\bsed -i\b|\bapply_patch\b/.test(command)) tags.push('edit');
  return tags.length ? tags : ['other'];
}
function text(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(item => item.text || '').join('\n');
  return JSON.stringify(value ?? null);
}
function toolResults(request) {
  const results = (Array.isArray(request.input) ? request.input : []).filter(i => i.type === 'function_call_output');
  for (const message of request.messages || []) {
    if (message.role === 'tool') results.push({call_id:message.tool_call_id,output:message.content});
    for (const block of Array.isArray(message.content) ? message.content : []) if (block.type === 'tool_result') results.push({call_id:block.tool_use_id,output:block.content});
  }
  return results;
}
function responseActions(response) {
  const actions = (response?.output || []).filter(i => ['function_call','tool_use'].includes(i.type)).map(i => ({call_id:i.call_id || i.id,name:i.name,arguments:i.type === 'tool_use' ? i.input : i.arguments}));
  for (const choice of response?.choices || []) for (const tool of choice.message?.tool_calls || []) if (tool) actions.push({call_id:tool.id,name:tool.function?.name,arguments:tool.function?.arguments});
  return actions;
}
export function extractRun(manifest, records, runDirectory) {
  const sorted = [...records].sort((a, b) => a.metadata.startedAt.localeCompare(b.metadata.startedAt));
  const results = new Map();
  for (const { request } of sorted) {
    for (const item of toolResults(request)) if (!results.has(item.call_id)) results.set(item.call_id, text(item.output));
  }
  const turns = [];
  for (const [index, { metadata, request }] of sorted.entries()) {
    const prior = toolResults(request);
    const actions = responseActions(metadata.response).map(item => {
      let argumentsValue = null;
      try { argumentsValue = typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments; } catch {}
      const command = typeof argumentsValue?.command === 'string' ? argumentsValue.command : null;
      const result = results.get(item.call_id) ?? null;
      return { callId: item.call_id, name: item.name, arguments: argumentsValue, command, tags: command === null ? ['unparsed'] : classifyCommand(command), result,
        toolExitCode: result?.match(/^Exit code: (-?\d+)/)?.[1] ?? null,
        missingCommand: result?.match(/(?:bash: |\/bin\/bash: )?(?:line \d+: )?([\w-]+): command not found/)?.[1] ?? null };
    });
    turns.push({ id: metadata.id, instanceId: metadata.instanceId ?? manifest.options?.instance, ordinal: index + 1, phase: prior.length ? 'continuation' : 'initial',
      previousToolResult: prior.length ? text(prior.at(-1).output) : null,
      actions, tags: [...new Set(actions.flatMap(a => a.tags))], usage: metadata.response?.usage ?? null, latencyMs: metadata.durationMs,
      valid: metadata.state === 'complete' && metadata.upstreamStatus === 200 && !metadata.recordingTruncated && !metadata.recordingError && metadata.response?.done !== false && !metadata.response?.error && !['failed','incomplete'].includes(metadata.response?.status),
      finalAnswer: actions.length === 0 });
  }
  return { directory: runDirectory, instanceId: manifest.options.instance, split: manifest.options.split, state: manifest.state, execution: manifest.options.execution,
    model: manifest.model, reasoning: manifest.reasoning, localTestsPassed: manifest.evaluation?.kind === 'local-tests-not-official-swebench' ? manifest.evaluation.passed : null,
    officialResolved: manifest.evaluation?.resolved ?? null, turns };
}
export function aggregateRuns(runs) {
  const turns = runs.flatMap(run => run.turns);
  const patterns = new Map();
  for (const turn of turns.filter(t => t.valid)) {
    for (const tag of turn.tags) {
      const key = `${turn.phase}:${tag}`;
      if (!patterns.has(key)) patterns.set(key, { phase: turn.phase, tag, traceIds: [], instances: new Set() });
      const pattern = patterns.get(key); pattern.traceIds.push(turn.id); pattern.instances.add(turn.instanceId);
    }
  }
  const transitions = new Map();
  for (const run of runs) for (let i = 1; i < run.turns.length; i++) {
    const previous = run.turns[i - 1], next = run.turns[i];
    if (!previous.valid || !next.valid) continue;
    const key = `${previous.tags.join('+') || 'final-answer'} → ${next.tags.join('+') || 'final-answer'}`;
    if (!transitions.has(key)) transitions.set(key, { pattern: key, count: 0, instances: new Set() });
    transitions.get(key).count++; transitions.get(key).instances.add(run.instanceId);
  }
  const total = field => turns.reduce((n, t) => n + (Number.isFinite(t.usage?.[field]) ? t.usage[field] : 0), 0);
  return { runs: runs.length, distinctIssues: new Set(runs.map(r => r.instanceId)).size, calls: turns.length,
    knownInputTokens: total('input_tokens'), knownOutputTokens: total('output_tokens'), knownTotalTokens: total('total_tokens'),
    knownCachedInputTokens: turns.reduce((n, t) => n + (t.usage?.input_tokens_details?.cached_tokens || 0), 0),
    callsWithoutUsage: turns.filter(t => !Number.isFinite(t.usage?.total_tokens)).length,
    locallyPassingRuns: runs.filter(r => r.localTestsPassed === true).length,
    missingCommandObservations: turns.flatMap(t => t.actions).filter(a => a.missingCommand).map(a => ({ callId: a.callId, command: a.missingCommand })),
    patterns: [...patterns.values()].map(p => ({ ...p, instances: [...p.instances], distinctIssues: p.instances.size })).sort((a, b) => b.distinctIssues - a.distinctIssues || b.traceIds.length - a.traceIds.length),
    transitions: [...transitions.values()].map(p => ({ ...p, instances: [...p.instances] })).sort((a, b) => b.count - a.count) };
}
export async function analyzeTrajectories(root) {
  const runs = [], skipped = [];
  for (const dir of await readdir(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const directory = join(root, dir.name);
    let manifest;
    try { manifest = await json(join(directory, 'manifest.json')); } catch { skipped.push({ directory, reason: 'No readable manifest' }); continue; }
    if (manifest.state !== 'complete' || !manifest.options?.instance || !manifest.usage?.calls) { skipped.push({ directory, reason: `Not a completed inference run (${manifest.state})` }); continue; }
    const records = [];
    for (const trace of await readdir(join(directory, 'traces'), { withFileTypes: true })) {
      if (!trace.isDirectory()) continue;
      try { records.push({ metadata: await json(join(directory, 'traces', trace.name, 'metadata.json')), request: await json(join(directory, 'traces', trace.name, 'request.json')) }); }
      catch { skipped.push({ directory: join(directory, 'traces', trace.name), reason: 'Unreadable trace' }); }
    }
    runs.push(extractRun(manifest, records, directory));
  }
  return { version: 1, createdAt: new Date().toISOString(), root: resolve(root), summary: aggregateRuns(runs), runs, skipped };
}
export function renderAnalysis(report) {
  const s = report.summary;
  return `# Coding trajectory analysis\n\n${s.runs} completed runs across ${s.distinctIssues} distinct issues; ${s.calls} model calls. ${s.locallyPassingRuns} runs passed local checks (not official SWE-bench scores).\n\nKnown token usage: ${s.knownInputTokens} input, ${s.knownOutputTokens} output, ${s.knownCachedInputTokens} cached input. ${s.callsWithoutUsage} calls have unknown usage. Cached tokens are included in input, not additional tokens.\n\n| Observed behavior | Phase | Calls containing it | Distinct issues |\n| --- | --- | ---: | ---: |\n` + s.patterns.map(p => `| ${p.tag} | ${p.phase} | ${p.traceIds.length} | ${p.distinctIssues} |`).join('\n') + `\n\n## Interpretation\n\nTags are heuristic labels, not shell parsers or proof that a model call can be replaced. One command can receive several tags. Counts use only the current response's actions, not repeated conversation history. Tool outputs are linked by call ID. Repeated runs of the same issue do not count as independent issues.\n\nCommand-not-found observations: ${s.missingCommandObservations.length}. Environment failures should be fixed or stratified before claiming useful learned recovery.\n\nNo programs are activated by this report. Replay can compare proposed actions, but only paired agent runs can establish downstream correctness and net savings. Discovery/calibration/test splitting must happen at the issue level.\n`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const root = resolve(process.argv[2] || 'data/swebench');
    const out = resolve(process.argv[3] || `data/analysis/${new Date().toISOString().replaceAll(':', '-')}`);
    const report = await analyzeTrajectories(root);
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'analysis.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    await writeFile(join(out, 'analysis.md'), renderAnalysis(report), { mode: 0o600 });
    console.log(renderAnalysis(report)); console.log(`Artifacts: ${out}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
