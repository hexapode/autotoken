import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeTrajectories } from './trajectory-analysis.js';
import { testCommandObserved, testsSucceeded } from './validation-workflow.js';

export function coveredOperations(command, testPath) {
  if (typeof command !== 'string') return null;
  const commands = command.split(/[;\n]/).map(s=>s.trim()).filter(Boolean);
  if (!commands.length) return null;
  const operations=[];
  for (const c of commands) {
    if (c === 'git diff --check') operations.push('diff-check');
    else if (c === 'git diff --stat') operations.push('diff-stat');
    else if ([`python -m pytest -q ${testPath}`,`python -m pytest ${testPath} -q`,'python -m pytest -q',`pytest -q ${testPath}`,`pytest ${testPath} -q`,'pytest -q'].includes(c)) operations.push('full-suite');
    else return null;
  }
  return operations;
}
function resultOf(action) {
  const match=action.result?.match(/^Exit code: (-?\d+); timed out: (true|false)\n([\s\S]*)$/);
  return match ? {code:Number(match[1]),timedOut:match[2]==='true',output:match[3]} : null;
}
export function replayRun(run) {
  const testPath=run.instanceId.startsWith('pydicom__')?'pydicom/tests':'tests';
  let editGeneration=0,usedGeneration=0;
  const opportunities=[];
  for(let i=0;i<run.turns.length-1;i++) {
    const turn=run.turns[i],next=run.turns[i+1];
    if(turn.tags.includes('edit'))editGeneration++;
    if(!turn.valid||!editGeneration||editGeneration===usedGeneration||turn.actions.length!==1)continue;
    const action=turn.actions[0];
    if(!testCommandObserved(action.command)||!testsSucceeded(resultOf(action)))continue;
    usedGeneration=editGeneration;
    const operations=next.valid&&next.actions.length===1?coveredOperations(next.actions[0].command,testPath):null;
    opportunities.push({afterTraceId:turn.id,nextTraceId:next.id,nextOrdinal:next.ordinal,operations,singletonFullActionCovered:!!operations&&operations.every(o=>o==='diff-check'),workflowFullActionCovered:!!operations});
  }
  return {instanceId:run.instanceId,calls:run.turns.length,opportunities};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const [root,out]=process.argv.slice(2);
 const protocol=JSON.parse(await readFile(join(out,'protocol.json'),'utf8'));
 const analysis=await analyzeTrajectories(root);
 const runs=analysis.runs.filter(r=>protocol.replayIssues.includes(r.instanceId)).map(replayRun);
 const opportunities=runs.flatMap(r=>r.opportunities);
 const report={kind:'held-out-offline-opportunity-replay',protocol:resolve(join(out,'protocol.json')),runs,summary:{issues:runs.length,calls:runs.reduce((n,r)=>n+r.calls,0),guardOpportunities:opportunities.length,singletonFullActionsCovered:opportunities.filter(o=>o.singletonFullActionCovered).length,workflowFullActionsCovered:opportunities.filter(o=>o.workflowFullActionCovered).length,realizedQueriesSaved:null},limitations:['No routing or execution intervention occurred in these historical traces.','Patch dirtiness is approximated by observed edit tags; live implementation hashes actual changes.','Full-action coverage is a strict allowlist, not arbitrary shell semantic equivalence.','Supplying results may change model behavior; live paired trials are required.']};
 await writeFile(join(out,'replay.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report.summary,null,2));
}
