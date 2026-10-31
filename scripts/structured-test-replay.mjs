import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {summarizePytest} from './structured-test.mjs';
const snapshot=JSON.parse(await readFile('data/experiments/router-all-traces-v2/snapshot.json','utf8'));
const assignments=JSON.parse(await readFile('data/experiments/router-all-traces-v2/report.json','utf8')).assignments;
const rows=[];
for(const run of snapshot.runs){
 if(run.arm!=='baseline'||![2,3,4].includes(assignments[run.instanceId]))continue;
 for(const turn of run.turns){
  if(!turn.valid)continue;
  const command=turn.actions.map(a=>a.command||'').join('\n');
  const matches=command.match(/(?:^|[;\n])\s*(?:python(?:3)?\s+-m\s+)?pytest\b[^\n]*/g)||[];
  if(!matches.some(line=>/\|\s*tail\b/.test(line)))continue;
  const output=turn.actions.map(a=>a.result||'').join('\n');
  const result=summarizePytest(output); // Never use outer shell exit as pytest status.
  rows.push({issue:run.instanceId,traceId:turn.id,result,outerExitZero:output.startsWith('Exit code: 0; timed out: false\n'),multiplePytestCommands:(command.match(/(?:^|[;\n]|&&|\|\|)\s*(?:python(?:3)?\s+-m\s+)?pytest\b/g)||[]).length>1,inputChars:output.length,summaryChars:JSON.stringify(result).length});
 }
}
const summary={observations:rows.length,issues:new Set(rows.map(r=>r.issue)).size,withRecognizedSummary:rows.filter(r=>r.result.summaries.length).length,withFailureEvidence:rows.filter(r=>r.result.failureObserved).length,withFailureIds:rows.filter(r=>r.result.failureIds.length).length,outerExitZeroWithFailure:rows.filter(r=>r.outerExitZero&&r.result.failureObserved).length,unknownPytestStatus:rows.filter(r=>!r.result.statusKnown).length,largerThanOriginal:rows.filter(r=>r.summaryChars>r.inputChars).length,multiplePytestCommands:rows.filter(r=>r.multiplePytestCommands).length,inputChars:rows.reduce((s,r)=>s+r.inputChars,0),summaryChars:rows.reduce((s,r)=>s+r.summaryChars,0)};
const report={scope:'baseline discovery folds 2,3,4 only',summary,rows,limitations:['Pipeline outer status is never treated as the pytest subprocess status.','Historical output may mix multiple test commands, intentional before-patch failures and other commands; no attribution or false-success claims.','No recorded commands executed. Real runner checked on synthetic local pytest fixtures only; trusted workspace, not a sandbox. Fixed reporting flags are not arbitrary baseline-command equivalence.','Character compression is not token savings or whole model call replacement.','Failure evidence extraction can lose details; bounded summary cannot replace raw logs for every investigation.','No heldout or calibration inspection, learned router activation, or paid calls.']};
await mkdir('data/analysis/structured-test-v1',{recursive:true,mode:0o700});await writeFile('data/analysis/structured-test-v1/report.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(summary,null,2));
