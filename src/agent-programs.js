// Model-proposed specifications compile to these audited read-only operations.
// Programs return a proposed tool call; they never execute it themselves.
export const OPERATIONS = Object.freeze({ pwd: 'pwd', git_status: 'git status --short', list_root: 'ls', diff_check: 'git diff --check', diff_stat: 'git diff --stat' });
export function validateCandidate(candidate, turns) {
  if (!candidate || !/^[a-z0-9_-]{1,60}$/.test(candidate.name || '') || typeof candidate.description !== 'string' || candidate.description.length > 2000) throw new Error('Invalid candidate name or description');
  if (!['initial', 'after_tests_pass'].includes(candidate.guard)) throw new Error('Unsupported guard');
  if (!Array.isArray(candidate.operations) || !candidate.operations.length || candidate.operations.length > 5 || new Set(candidate.operations).size !== candidate.operations.length || candidate.operations.some(op => !Object.hasOwn(OPERATIONS, op))) throw new Error('Unsupported operations');
  if (!Array.isArray(candidate.sourceTraceIds)) throw new Error('Missing evidence');
  const sources = [...new Set(candidate.sourceTraceIds)].map(id => turns.find(t => t.id === id));
  if (sources.some(t => !t?.valid) || new Set(sources.map(t => t.instanceId)).size < 2) throw new Error('Need valid evidence from at least two distinct issues');
  const allowedOps = candidate.guard === 'initial' ? ['pwd', 'git_status', 'list_root'] : ['diff_check', 'diff_stat'];
  if (candidate.operations.some(op => !allowedOps.includes(op))) throw new Error('Operation is not supported by this guard');
  if (sources.some(t => t.phase !== (candidate.guard === 'initial' ? 'initial' : 'continuation'))) throw new Error('Evidence phase mismatch');
  return { name: candidate.name, description: candidate.description, guard: candidate.guard, operations: candidate.operations, sourceTraceIds: sources.map(t => t.id), sourceIssues: [...new Set(sources.map(t => t.instanceId))], status: 'proposed', validation: 'unvalidated-semantic-equivalence' };
}
export function generateProgram(candidate) {
  const command = candidate.operations.map(op => OPERATIONS[op]).join('; ');
  if (candidate.operations.some(op => !Object.hasOwn(OPERATIONS, op))) throw new Error('Unsupported operation');
  if (!['initial', 'after_tests_pass'].includes(candidate.guard)) throw new Error('Unsupported guard');
  return `// Generated from a validated operation specification; proposed only.\nexport default function propose(context) {\n  if (!context || !['local_bash', 'container_bash'].includes(context.toolName)) return null;\n  const initial = context.phase === 'initial';\n  const testsPassed = context.phase === 'continuation' && typeof context.previousToolResult === 'string' && /^Exit code: 0(?:;|\\n)/.test(context.previousToolResult) && /\\b\\d+ passed\\b/.test(context.previousToolResult) && !/\\b(?:failed|error|errors)\\b/i.test(context.previousToolResult);\n  if (!(${candidate.guard === 'initial' ? 'initial' : 'testsPassed'})) return null;\n  return { name: context.toolName, arguments: { command: ${JSON.stringify(command)}, timeout: 30 } };\n}\n`;
}
export async function replayProposal(candidate, turns) {
  // Execute only the compiler's own template, never source returned by a model.
  const source = generateProgram(candidate);
  const { default: propose } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const observations = turns.filter(t => t.valid).map(turn => {
    const proposal = propose({ phase: turn.phase, previousToolResult: turn.previousToolResult, toolName: turn.actions[0]?.name || 'local_bash' });
    return { traceId: turn.id, triggered: proposal !== null, exactCommandMatch: proposal !== null && turn.actions.length === 1 && turn.actions[0].name === proposal.name && turn.actions[0].command?.trim() === proposal.arguments.command, proposal };
  });
  return { kind: 'discovery-replay-not-held-out', source, triggered: observations.filter(o => o.triggered).length, exactCommandMatches: observations.filter(o => o.exactCommandMatch).length, observations };
}
