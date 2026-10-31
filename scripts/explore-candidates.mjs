import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseReadCommand,parseSearchCommand} from '../src/pattern-miner.js';

// Offline observation only: no recorded command is executed. Select candidates
// from discovery issues only; do not inspect calibration or evaluation turns.
const snapshotPath='data/experiments/router-all-traces-v2/snapshot.json';
const snapshot=JSON.parse(await readFile(snapshotPath,'utf8'));
const assignments=JSON.parse(await readFile('data/experiments/router-all-traces-v2/report.json','utf8')).assignments;
const candidates=Object.fromEntries(['missing_path_recovery','missing_tool_recovery','repository_configuration','same_file_read_continuation','repeated_readonly_command','verification_packet'].map(k=>[k,[]]));
let runs=0,decisions=0;
const command=t=>t.actions.map(a=>a.command||'').join('\n');
const output=t=>t.actions.map(a=>a.result||'').join('\n');
const pureReads=t=>t.valid&&t.actions.length===1&&['local_bash','container_bash'].includes(t.actions[0].name)?parseReadCommand(command(t)):null;
const inspection=t=>t.valid&&t.tags.length>0&&t.tags.every(x=>['search','file-read','workspace-inspection'].includes(x));
for(const run of snapshot.runs){
 if(run.arm!=='baseline'||![2,3,4].includes(assignments[run.instanceId]))continue;
 runs++;decisions+=run.turns.length;
 const seen=new Map();
 for(let i=0;i<run.turns.length;i++){
  const t=run.turns[i];if(!t.valid){seen.clear();continue;}
  const c=command(t),o=output(t),n=run.turns[i+1];
  const base={issue:run.instanceId,traceId:t.id,run:run.directory};
  const add=(key,extra={})=>candidates[key].push({...base,...extra});
  // Require a shell utility diagnostic, not merely a quoted error in source.
  const errors=o.split('\n').filter(line=>/^(?:grep|rg|sed|cat|head|tail|ls|find): .*(?:No such file or directory|does not exist)/.test(line)||/^[\w./*-]+: No such file or directory \(os error 2\)$/.test(line));
  if(errors.length)add('missing_path_recovery',{diagnostics:errors.slice(0,10),nextInspection:!!n&&inspection(n),nextTraceId:n?.id});
  if(/^(?:.*(?:bash|sh): .*command not found|.*: (?:rg|timeout): (?:command )?not found)$/m.test(o))add('missing_tool_recovery',{nextInspection:!!n&&inspection(n)});
  if(inspection(t)&&/(?:cat|head|sed)\b[^\n;]*(?:pyproject\.toml|setup\.cfg|setup\.py|tox\.ini|requirements[^\s;]*|pytest\.ini)/.test(c))add('repository_configuration',{earlyTurn:i<3,wholeTurnConfigurationOnly:false});
  const reads=pureReads(t),nextReads=n?pureReads(n):null;
  if(reads&&nextReads&&reads.every(r=>r.end!==null)&&nextReads.every(r=>r.end!==null)){
   const previousFiles=new Set(reads.map(r=>r.file));
   if(nextReads.every(r=>previousFiles.has(r.file)))add('same_file_read_continuation',{nextTraceId:n.id,previousRanges:reads,nextRanges:nextReads,nextAlreadyCovered:nextReads.every(r=>reads.some(p=>p.file===r.file&&p.start<=r.start&&p.end>=r.end))});
  }
  // Conservative observation epochs: ANY non-parsed read/search action clears
  // cache history, including tests, mixed commands, and unknown commands.
  const supported=t.actions.length===1&&(reads||parseSearchCommand(c));
  if(supported){
   if(seen.has(c))add('repeated_readonly_command',{previousTraceId:seen.get(c).id,identicalRecordedOutput:seen.get(c).output===o});
   seen.set(c,{id:t.id,output:o});
  }else seen.clear();
  if(t.tags.includes('test-run')&&t.tags.includes('diff-review')&&!t.tags.includes('edit'))add('verification_packet',{nextIsFinalAnswer:!!n?.finalAnswer&&n.actions.length===0});
 }
}
const summary=Object.fromEntries(Object.entries(candidates).map(([id,events])=>[id,{observations:events.length,distinctIssues:new Set(events.map(e=>e.issue)).size,...(id==='missing_path_recovery'?{followedByInspection:events.filter(e=>e.nextInspection).length}:{}),...(id==='repository_configuration'?{earlyTurns:events.filter(e=>e.earlyTurn).length}:{}),...(id==='same_file_read_continuation'?{alreadyCovered:events.filter(e=>e.nextAlreadyCovered).length}:{}),...(id==='repeated_readonly_command'?{identicalRecordedOutput:events.filter(e=>e.identicalRecordedOutput).length}:{}),...(id==='verification_packet'?{followedByFinalAnswer:events.filter(e=>e.nextIsFinalAnswer).length}:{})}]));
const report={snapshot:snapshotPath,scope:'Discovery folds 2,3,4; baseline only; no calibration/evaluation inspection',runs,decisions,summary,candidates,limitations:['Exploratory heuristic observations, not saved model calls or causal results.','Repeated issue runs are correlated; distinct issue counts are reported.','Tag-based classification does not establish shell purity.','Recorded identical outputs do not establish cache safety; execution would require filesystem/configuration fingerprints.','Continuation uses future actions as descriptive labels, not routing inputs.','Repository configuration and verification packets may already be batched; savings require a live trial.','Historical discovery issues have already been inspected; new independent issues are needed for validation.']};
const out='data/analysis/more-candidates-v1';await mkdir(out,{recursive:true,mode:0o700});await writeFile(`${out}/report.json`,JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify({runs,decisions,summary},null,2));
