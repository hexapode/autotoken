import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseReadRanges,tokenizeShell} from '../src/search-context-replay.js';
import {FAILURE_CONTEXT_POLICY,planFailureContext,rangeCoverage} from './failure-context.mjs';
const snapshot=JSON.parse(await readFile('data/experiments/router-all-traces-v2/snapshot.json','utf8'));
const assignments=JSON.parse(await readFile('data/experiments/router-all-traces-v2/report.json','utf8')).assignments;
const root='data/analysis/failure-context-v1';await mkdir(root,{recursive:true,mode:0o700});
await writeFile(`${root}/protocol.json`,JSON.stringify({policy:FAILURE_CONTEXT_POLICY,scope:'baseline discovery folds2,3,4 only; first four supported prior-output pointers; no target-based selection'},null,2),{mode:0o600});
function mixedReadLabels(turn){
 const ranges=[];
 for(const action of turn?.actions||[]){
  if(!['local_bash','container_bash'].includes(action.name))continue;
  const tokens=tokenizeShell(action.command);if(!tokens||tokens.includes('|'))continue;
  const groups=[[]];for(const token of tokens){if(token===';')groups.push([]);else groups.at(-1).push(token);}
  for(const group of groups){if(!group.length)continue;const parsed=parseReadRanges({valid:true,actions:[{name:action.name,command:group.join(' ')}]});if(parsed.supported)ranges.push(...parsed.ranges);}
 }
 return ranges;
}
const rows=[];let eligibleFailureTurns=0;
for(const run of snapshot.runs){
 if(run.arm!=='baseline'||![2,3,4].includes(assignments[run.instanceId]))continue;
 for(let i=0;i<run.turns.length;i++){
  const t=run.turns[i];if(!t.valid||!t.tags.includes('test-run'))continue;
  const output=t.actions.map(a=>a.result||'').join('\n');
  const proposal=planFailureContext(output);
  if(proposal.status==='no_failure_evidence')continue;
  eligibleFailureTurns++;
  if(proposal.status!=='planned')continue;
  // Proposal is frozen before even reading the next action.
  const target=run.turns[i+1],pure=parseReadRanges(target),mixed=mixedReadLabels(target),reads=pure.supported?pure.ranges:mixed;
  const coverage=rangeCoverage(proposal.ranges,reads);
  rows.push({issue:run.instanceId,traceId:t.id,proposal,nextTraceId:target?.id,nextHasReadTag:!!target?.tags.includes('file-read'),nextPureBoundedRead:pure.supported,nextReadRanges:reads,coverage,wholeTurnCovered:pure.supported&&coverage.allCovered,partialReadCoverage:coverage.coveredLines>0&&!(pure.supported&&coverage.allCovered)});
 }
}
const summary={eligibleFailureTurns,proposals:rows.length,issues:new Set(rows.map(r=>r.issue)).size,nextHasReadTag:rows.filter(r=>r.nextHasReadTag).length,nextPureBoundedRead:rows.filter(r=>r.nextPureBoundedRead).length,nextWithParsedReadRanges:rows.filter(r=>r.nextReadRanges.length).length,wholeTurnsCovered:rows.filter(r=>r.wholeTurnCovered).length,partialReadCoverage:rows.filter(r=>r.partialReadCoverage).length,proposedLines:rows.reduce((s,r)=>s+r.proposal.proposedLines,0),requestedParsedLines:rows.reduce((s,r)=>s+r.coverage.requestedLines,0),coveredRequestedLines:rows.reduce((s,r)=>s+r.coverage.coveredLines,0)};
const report={policy:FAILURE_CONTEXT_POLICY,scope:'baseline discovery folds2,3,4 only',summary,rows,limitations:['Syntactic range coverage only; source contents at historical turn not reconstructed.','Proposed lines are a maximum additional-context budget, not actual extra lines: files may be shorter and output may already show source.','Mixed commands with redirects, pipelines or unsupported shell syntax have no read-range labels; zero observed coverage is not proof of zero possible relevance.','Failure pointers may reference intentional original-code tests, library frames or less relevant source.','Proposals use only prior completed output; no next-target tuning.','No model calls executed and no savings established.']};
await writeFile(`${root}/report.json`,JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(summary,null,2));
