import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {suggestPaths} from './path-recovery.mjs';
const snapshot=JSON.parse(await readFile('data/experiments/router-all-traces-v2/snapshot.json','utf8'));
const assignments=JSON.parse(await readFile('data/experiments/router-all-traces-v2/report.json','utf8')).assignments;
const command=t=>t?.actions.map(a=>a.command||'').join('\n')||'';
const rows=[];
for(const run of snapshot.runs){
 if(run.arm!=='baseline'||![2,3,4].includes(assignments[run.instanceId]))continue;
 let files,indexError=null;
 try{
  const task=JSON.parse(await readFile(`${run.directory}/task.json`,'utf8'));
  files=execFileSync('git',['-C',`${run.directory}/checkout`,'ls-tree','-r','--name-only',task.base_commit],{encoding:'utf8',maxBuffer:8*1024*1024}).trim().split('\n');
 }catch(e){indexError=e.code||'missing_index';}
 for(let i=0;i<run.turns.length;i++){
  const t=run.turns[i];if(!t.valid)continue;
  const output=t.actions.map(a=>a.result||'').join('\n');
  const missing=[...new Set(output.split('\n').map(line=>line.match(/^(?:grep|rg|sed|cat|head|tail|ls|find): (.+?): (?:IO error.*?: )?No such file or directory(?: \(os error 2\))?$/)?.[1]).filter(Boolean))];
  for(const path of missing){
   const suggestion=indexError?{status:'index_unavailable',paths:[]}:suggestPaths(path,files);
   const next=run.turns[i+1],nextCommand=command(next);
   // Future command is only a descriptive outcome label. Tree comes from the
   // original task commit, not the final patched checkout contents.
   const mentions=suggestion.paths.filter(p=>nextCommand.includes(p));
   rows.push({issue:run.instanceId,traceId:t.id,missing:path,suggestion,nextMentionedSuggestions:mentions,nextInspection:!!next?.valid&&next.tags.length>0&&next.tags.every(tag=>['search','file-read','workspace-inspection'].includes(tag)),nextTraceId:next?.id});
  }
 }
}
const counts=Object.fromEntries([...new Set(rows.map(r=>r.suggestion.status))].map(status=>[status,rows.filter(r=>r.suggestion.status===status).length]));
const supported=rows.filter(r=>r.suggestion.paths.length);
const summary={diagnostics:rows.length,turns:new Set(rows.map(r=>r.traceId)).size,issues:new Set(rows.map(r=>r.issue)).size,status:counts,suggestionsMentionedInNextCommand:supported.filter(r=>r.nextMentionedSuggestions.length).length,suggestedTurns:new Set(supported.map(r=>r.traceId)).size,suggestedIssues:new Set(supported.map(r=>r.issue)).size};
const report={scope:'baseline discovery folds 2,3,4 only',summary,rows,limitations:['Suggestions only; never execute or rewrite mixed failed commands.','Next-command substring is weak descriptive evidence, not correctness or saved-call label.','Base-tree index excludes files created during the run; live version needs current bounded tracked and untracked index.','Exact basename and test/unittest prefix variants can still point at semantically wrong files.','Missing configuration and absent test data often have no replacement.','Previously seen discovery issues; requires independent live trial.']};
await mkdir('data/analysis/path-recovery-v1',{recursive:true,mode:0o700});await writeFile('data/analysis/path-recovery-v1/report.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(summary,null,2));
