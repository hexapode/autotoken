import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { Store } from './store.js';
import { Engine } from './engine.js';
import { DemoProvider, ModelProvider } from './provider.js';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export function validateDataset(dataset) {
  const ids = new Set(), requests = new Set(), inputs = new Map();
  for (const split of ['discovery', 'calibration', 'test']) {
    if (!Array.isArray(dataset[split]) || !dataset[split].length) throw new Error(`Missing ${split} split`);
    for (const item of dataset[split]) {
      if (!item || typeof item.id !== 'string' || ids.has(item.id)) throw new Error('Missing or duplicate case ID');
      ids.add(item.id);
      if (!item.request || typeof item.request.prompt !== 'string' || !item.request.prompt.trim() || Object.keys(item.request).some(k => !['prompt', 'data'].includes(k))) throw new Error(`Invalid request: ${item.id}`);
      if (typeof item.automatable !== 'boolean' || typeof item.category !== 'string') throw new Error(`Missing labels: ${item.id}`);
      if (!item.expected || !['json', 'text', 'unscored'].includes(item.expected.kind)) throw new Error(`Missing oracle: ${item.id}`);
      if (item.expected.kind !== 'unscored' && !Object.hasOwn(item.expected, 'value')) throw new Error(`Missing oracle value: ${item.id}`);
      if (item.expected.kind === 'text' && typeof item.expected.value !== 'string') throw new Error(`Invalid text oracle: ${item.id}`);
      if (item.automatable && item.expected.kind !== 'json') throw new Error(`Automatable cases need a JSON oracle: ${item.id}`);
      const fingerprint = JSON.stringify(canonical(item.request));
      if (requests.has(fingerprint)) throw new Error(`Duplicate request: ${item.id}`);
      requests.add(fingerprint);
      if (Object.hasOwn(item.request, 'data')) {
        const input = JSON.stringify(canonical(item.request.data));
        if (inputs.has(input) && inputs.get(input) !== split) throw new Error(`Input leaks across splits: ${item.id}`);
        inputs.set(input, split);
      }
    }
  }
}
export function grade(expected, answer) {
  if (expected.kind === 'unscored') return null;
  if (typeof answer !== 'string') return false;
  if (expected.kind === 'text') return answer.trim() === expected.value.trim();
  try { return isDeepStrictEqual(JSON.parse(answer), expected.value); } catch { return false; }
}
function average(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
function ratio(numerator, denominator) { return denominator ? numerator / denominator : null; }
function latency(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { meanMs: average(values), p50Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.5) - 1] : null, p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null };
}
export function summarize(rows) {
  const scored = rows.filter(r => r.expected.kind !== 'unscored');
  const served = rows.filter(r => r.proxy.route === 'program');
  const wrong = served.filter(r => !r.automatable || r.proxy.correct !== true);
  const eligible = rows.filter(r => r.automatable);
  const correctProgram = served.filter(r => r.automatable && r.proxy.correct === true);
  const negatives = rows.filter(r => !r.automatable);
  return {
    cases: rows.length, scoredCases: scored.length, unscoredCases: rows.length - scored.length,
    programResponses: served.length, incorrectProgramResponses: wrong.length,
    incorrectProgramRate: ratio(wrong.length, served.length),
    fallbackRequiredCases: negatives.length,
    fallbackViolations: negatives.filter(r => r.proxy.route === 'program').length,
    automatableCases: eligible.length,
    correctProgramCoverage: ratio(correctProgram.length, eligible.length),
    programResponseRate: ratio(served.length, rows.length),
    proxy: { correct: scored.filter(r => r.proxy.correct === true).length, accuracy: ratio(scored.filter(r => r.proxy.correct === true).length, scored.length), errors: rows.filter(r => r.proxy.error).length, latency: latency(rows.map(r => r.proxy.latencyMs)) },
    baseline: { correct: scored.filter(r => r.baseline.correct === true).length, accuracy: ratio(scored.filter(r => r.baseline.correct === true).length, scored.length), errors: rows.filter(r => r.baseline.error).length, latency: latency(rows.map(r => r.baseline.latencyMs)) }
  };
}
export function summarizeCalls(calls) {
  return {
    attempted: calls.length, failed: calls.filter(c => c.error).length,
    byKind: Object.fromEntries(['answer', 'route', 'discover'].map(kind => [kind, calls.filter(c => c.kind === kind).length])),
    // Never interpret missing provider usage as zero tokens.
    knownTotalTokens: calls.reduce((sum, c) => sum + (Number.isFinite(c.usage?.total_tokens) ? c.usage.total_tokens : 0), 0),
    callsWithoutTokenUsage: calls.filter(c => !Number.isFinite(c.usage?.total_tokens)).length
  };
}
function instrument(provider, calls, context) {
  return Object.fromEntries(['answer', 'route', 'discover'].map(kind => [kind, async (...args) => {
    const entry = { ...context, kind, model: provider.models?.[kind] ?? null };
    const start = performance.now();
    try {
      const response = await provider[kind](...args);
      entry.model = response.model ?? entry.model; entry.usage = response.usage ?? null;
      return response;
    } catch (error) { entry.error = error.message; throw error; }
    finally { entry.latencyMs = performance.now() - start; calls.push(entry); }
  }]));
}
export async function runEvaluation({ dataset, provider, outputDir, mode = 'custom', onProgress = () => {} }) {
  validateDataset(dataset);
  // Refuse to reuse state or overwrite a previous evaluation.
  mkdirSync(outputDir, { recursive: false, mode: 0o700 });
  const calls = [], context = { phase: 'discovery', caseId: null };
  const measured = instrument(provider, calls, context);
  const engine = new Engine(new Store(join(outputDir, 'state')), measured);
  const report = { version: 1, mode, startedAt: new Date().toISOString(), dataset: structuredClone(dataset), training: [], calibration: [], promotion: [], results: [], calls };
  const checkpoint = () => writeFileSync(join(outputDir, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  async function query(item, phase) {
    Object.assign(context, { phase, caseId: item.id });
    const start = performance.now();
    try {
      const event = await engine.query(structuredClone(item.request));
      return { ...event, correct: grade(item.expected, event.answer), latencyMs: performance.now() - start };
    } catch (error) { return { error: error.message, correct: item.expected.kind === 'unscored' ? null : false, latencyMs: performance.now() - start }; }
  }
  for (const item of dataset.discovery) {
    onProgress(`Discovery traffic: ${item.id}`);
    report.training.push({ id: item.id, result: await query(item, 'discovery') });
    checkpoint();
  }
  Object.assign(context, { phase: 'learning', caseId: null });
  try { report.learning = await engine.learn(); }
  catch (error) { report.learning = { error: error.message }; }
  checkpoint();
  for (const item of dataset.calibration) {
    onProgress(`Shadow calibration: ${item.id}`);
    report.calibration.push({ ...item, result: await query(item, 'calibration') });
    checkpoint();
  }
  for (const p of engine.store.state.programs) {
    const observations = report.calibration.filter(r => r.result.shadow?.programId === p.id);
    try {
      if (observations.some(r => !r.automatable || grade(r.expected, JSON.stringify(r.result.shadow.output)) !== true)) throw new Error('Independent calibration oracle rejected program');
      if (observations.length < 3) throw new Error('Fewer than 3 independently checked calibration observations');
      engine.setStatus(p.id, 'active');
      report.promotion.push({ id: p.id, name: p.name, active: true });
    } catch (error) {
      engine.setStatus(p.id, 'disabled');
      report.promotion.push({ id: p.id, name: p.name, active: false, reason: error.message });
    }
  }
  // Freeze the registry before opening the test split. No discovery or promotion below.
  report.registry = structuredClone(engine.store.state.programs);
  checkpoint();
  for (const [index, item] of dataset.test.entries()) {
    onProgress(`Held-out comparison: ${item.id}`);
    let proxy, baseline;
    const runBaseline = async () => {
      Object.assign(context, { phase: 'baseline', caseId: item.id });
      const start = performance.now();
      try {
        const response = await measured.answer(structuredClone(item.request));
        return { answer: response.value, correct: grade(item.expected, response.value), latencyMs: performance.now() - start };
      } catch (error) { return { error: error.message, correct: item.expected.kind === 'unscored' ? null : false, latencyMs: performance.now() - start }; }
    };
    // Alternate order to reduce systematic cache/warm-up advantage.
    if (index % 2 === 0) { baseline = await runBaseline(); proxy = await query(item, 'test'); }
    else { proxy = await query(item, 'test'); baseline = await runBaseline(); }
    report.results.push({ ...item, proxy, baseline });
    checkpoint();
  }
  report.finishedAt = new Date().toISOString();
  report.summary = summarize(report.results);
  report.categories = Object.fromEntries([...new Set(report.results.map(r => r.category))].map(category => [category, summarize(report.results.filter(r => r.category === category))]));
  report.usage = {
    setup: summarizeCalls(calls.filter(c => ['discovery', 'learning', 'calibration'].includes(c.phase))),
    proxyTest: summarizeCalls(calls.filter(c => c.phase === 'test')),
    baselineTest: summarizeCalls(calls.filter(c => c.phase === 'baseline')),
    proxyIncludingSetup: summarizeCalls(calls.filter(c => c.phase !== 'baseline'))
  };
  checkpoint();
  writeFileSync(join(outputDir, 'report.md'), renderReport(report), { mode: 0o600 });
  return report;
}
const percent = n => n === null ? 'N/A' : `${(n * 100).toFixed(1)}%`;
const ms = n => n === null ? 'N/A' : `${n.toFixed(1)} ms`;
export function renderReport(report) {
  const s = report.summary;
  const usage = u => `${u.attempted} calls; ${u.failed} failed; ${u.knownTotalTokens} known tokens; ${u.callsWithoutTokenUsage} calls with unknown tokens`;
  return `# ModelToCode evaluation\n\nMode: **${report.mode}**. ${report.mode === 'demo' ? 'Scripted fixtures only; this is NOT evidence of real model learning, accuracy, cost, or speed.' : 'One small benchmark run; model results may vary between runs.'}\n\n` +
    `Discovery: ${report.dataset.discovery.length} cases. Calibration: ${report.dataset.calibration.length}. Held-out test: ${s.cases}. Active programs: ${report.promotion.filter(p => p.active).length}.\n\n` +
    `| Metric | Proxy | Model-only baseline |\n| --- | ---: | ---: |\n| Answer accuracy (${s.scoredCases} scored cases) | ${percent(s.proxy.accuracy)} | ${percent(s.baseline.accuracy)} |\n| Request errors | ${s.proxy.errors} | ${s.baseline.errors} |\n| Mean latency | ${ms(s.proxy.latency.meanMs)} | ${ms(s.baseline.latency.meanMs)} |\n| p95 latency | ${ms(s.proxy.latency.p95Ms)} | ${ms(s.baseline.latency.p95Ms)} |\n\n` +
    `- Program responses: ${s.programResponses}/${s.cases}.\n- Incorrect program responses: ${s.incorrectProgramResponses}/${s.programResponses} (${percent(s.incorrectProgramRate)}; N/A means none served).\n- Correct program coverage: ${percent(s.correctProgramCoverage)} of ${s.automatableCases} automatable cases.\n- Fallback violations: ${s.fallbackViolations}/${s.fallbackRequiredCases}.\n- Unscored subjective/invalid-input answers: ${s.unscoredCases}; these still count toward routing evaluation.\n\n` +
    `## Usage\n\n- Setup (discovery traffic, learning, calibration): ${usage(report.usage.setup)}.\n- Proxy test only: ${usage(report.usage.proxyTest)}.\n- Baseline test only: ${usage(report.usage.baselineTest)}.\n- Proxy including setup: ${usage(report.usage.proxyIncludingSetup)}.\n\nNo dollar savings inferred. Missing token usage is unknown, not zero. Failed calls are counted, though their billed token usage may be unavailable. Latency includes failed requests and is measured locally; alternating execution order does not eliminate provider caching effects.\n\n` +
    `## Categories\n\n| Category | Cases | Program responses | Incorrect program responses | Proxy accuracy | Baseline accuracy |\n| --- | ---: | ---: | ---: | ---: | ---: |\n` +
    Object.entries(report.categories).map(([category, v]) => `| ${category.replaceAll('|', '/').replaceAll('\n', ' ')} | ${v.cases} | ${v.programResponses} | ${v.incorrectProgramResponses} | ${percent(v.proxy.accuracy)} | ${percent(v.baseline.accuracy)} |`).join('\n') +
    `\n\n## Interpretation\n\nExpected answers are hand-authored, never generated by the answer model or program interpreter. JSON answers require exact structural equality; text answers compare after trimming. The model-only baseline is an independent call, not the correctness oracle. Calibration can reject promotion using its labels; held-out labels never reach the router or learner. Programs failing calibration are disabled before testing. This fixture covers a few transformation families, not general-purpose competence.\n\nSee report.json for per-case outputs, errors, decisions, promotion failures, exact dataset, registry snapshot, and every model-call attempt. Reports and state contain raw inputs and outputs.\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const options = { live: false, dataset: 'eval/dataset.json', out: null };
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--live') options.live = true;
      else if (['--dataset', '--out'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) options[args[i].slice(2)] = args[++i];
      else throw new Error('Usage: npm run eval -- [--live] [--dataset file.json] [--out NEW_DIRECTORY]');
    }
    const outputDir = resolve(options.out || `data/evals/${new Date().toISOString().replaceAll(':', '-')}`);
    mkdirSync(resolve(outputDir, '..'), { recursive: true });
    const dataset = JSON.parse(readFileSync(options.dataset, 'utf8'));
    const report = await runEvaluation({ dataset, outputDir, mode: options.live ? 'live' : 'demo', provider: options.live ? new ModelProvider() : new DemoProvider(), onProgress: console.log });
    console.log(renderReport(report));
    console.log(`Full report: ${join(outputDir, 'report.json')}`);
    if (report.summary.incorrectProgramResponses || report.summary.proxy.errors || report.summary.baseline.errors || report.learning.error || report.calls.some(c => c.error) || report.training.some(r => r.result.error) || report.calibration.some(r => r.result.error)) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
