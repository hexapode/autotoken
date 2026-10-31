import { readFile, mkdir, writeFile, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { runTask } from './swe-runner.js';
import { CollectionBudget } from './collection-budget.js';

// Serial by design: one local coding agent, one durable budget ledger.
try {
  const [inventoryFile, outArg, budgetArg, targetArg = '1000'] = process.argv.slice(2);
  if (!inventoryFile || !outArg || !(Number.isFinite(Number(budgetArg)) && Number(budgetArg) > 0) || !Number.isSafeInteger(Number(targetArg)) || Number(targetArg) < 1) throw new Error('Usage: npm run swe:collect -- INVENTORY OUTPUT_DIR BUDGET_USD [QUERY_LIMIT=1000]');
  const inventory = JSON.parse(await readFile(inventoryFile, 'utf8'));
  if (inventory.split !== 'dev' || inventory.purpose !== 'discovery-only' || !/^[a-f0-9]{40}$/.test(inventory.revision)) throw new Error('Expected pinned discovery inventory');
  if (new Set(inventory.tasks.map(t => t.instance_id)).size !== inventory.tasks.length) throw new Error('Duplicate issues in inventory');
  const out = resolve(outArg); await mkdir(out, { recursive: true, mode: 0o700 });
  const lockPath = join(out, 'collector.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Error('Collector lock exists; verify its PID is stopped before removing it and resuming'); });
  await lock.writeFile(String(process.pid)); await lock.close();
  try {
    const statePath = join(out, 'collection.json');
    let state;
    try { state = JSON.parse(await readFile(statePath, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const identity = JSON.stringify(inventory);
    if (state && (state.inventoryIdentity !== identity || state.budgetUsd !== Number(budgetArg) || state.targetQueries !== Number(targetArg))) throw new Error('Resume requires identical inventory and budgets');
    state ||= { version: 1, model: 'gpt-6.1-sol', targetQueries: Number(targetArg), budgetUsd: Number(budgetArg), inventoryIdentity: identity, startedAt: new Date().toISOString(), requests: {}, tasks: [], status: 'running' };
    const budget = new CollectionBudget(statePath, state); budget.save();
    let stopping = false;
    const stop = () => { stopping = true; };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      for (const task of inventory.tasks) {
        if (stopping || state.accountingError || budget.attempts >= state.targetQueries || state.budgetStopped) break;
        if (state.tasks.some(t => t.instanceId === task.instance_id)) continue;
        const dir = join(out, task.instance_id);
        const record = { instanceId: task.instance_id, state: 'running', startedAt: new Date().toISOString() };
        state.tasks.push(record); budget.save();
        try {
          const result = await runTask({ dataset: inventory.dataset, split: inventory.split, revision: inventory.revision, instance: task.instance_id, execution: 'local', out: dir, maxRequests: 40, timeoutSeconds: 900, evaluate: true,
            beforeRequest: opts => {
              if (stopping || state.accountingError) throw new Error('Collection stopped');
              try { budget.reserve(opts); } catch (e) { if (/budget|query limit/.test(e.message)) state.budgetStopped = e.message; budget.save(); throw e; }
            }, onTrace: trace => { try { budget.settle(trace); } catch (e) { state.accountingError = 'Budget ledger write failed'; throw e; } }
          });
          record.state = 'complete'; record.evaluation = result.evaluation;
        } catch (e) { record.state = 'failed'; record.error = e.message; }
        record.finishedAt = new Date().toISOString(); budget.save();
        console.log(JSON.stringify({ queries: budget.attempts, completedQueries: Object.values(state.requests).filter(r => r.state === 'completed').length, conservativeCostUsd: budget.charged, issues: state.tasks.length, last: record.instanceId, state: record.state }));
      }
      state.status = state.accountingError ? 'accounting-review' : stopping ? 'interrupted' : state.budgetStopped ? 'budget-stopped' : budget.attempts >= state.targetQueries ? 'query-limit-reached' : 'inventory-exhausted';
      state.finishedAt = new Date().toISOString(); budget.save();
      await writeFile(join(out, 'summary.json'), JSON.stringify({ status: state.status, queries: budget.attempts, completedQueries: Object.values(state.requests).filter(r => r.state === 'completed').length, conservativeCostUsd: budget.charged, issues: state.tasks.length }, null, 2));
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
  } finally { await unlink(lockPath); }
} catch (e) { console.error(e.message); process.exitCode = 1; }
