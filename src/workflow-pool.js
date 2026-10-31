// One process owns the ledger; workers overlap independent issue/repetition blocks.
export async function runWorkflowPool(schedule, concurrency, run, shouldStop = () => false) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 12) throw new Error('Workers must be 1..12');
  const blocks = new Map();
  for (const spec of schedule) {
    const key = `${spec.instance}:r${spec.repeat}`;
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key).push(spec);
  }
  const queue = [...blocks.values()];
  let next = 0, failed = false;
  const results = await Promise.allSettled(Array.from({length: Math.min(concurrency, queue.length)}, async () => {
    try { while (!failed && !shouldStop()) {
      const block = queue[next++];
      if (!block) return;
      for (const spec of block) {
        if (failed || shouldStop()) return;
        await run(spec);
      }
    } } catch (error) { failed = true; throw error; }
  }));
  const failure = results.find(r => r.status === 'rejected');
  if (failure) throw failure.reason;
}
