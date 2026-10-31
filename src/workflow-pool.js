// One process owns the ledger; workers overlap independent issue/repetition blocks.
export async function runWorkflowPool(schedule, concurrency, run, shouldStop = () => false) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error('Workers must be 1..3');
  const blocks = new Map();
  for (const spec of schedule) {
    const key = `${spec.instance}:r${spec.repeat}`;
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key).push(spec);
  }
  const queue = [...blocks.values()];
  let next = 0;
  await Promise.all(Array.from({length: Math.min(concurrency, queue.length)}, async () => {
    while (!shouldStop()) {
      const block = queue[next++];
      if (!block) return;
      for (const spec of block) {
        if (shouldStop()) return;
        await run(spec);
      }
    }
  }));
}
