import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {command} from './swe-runner.js';
import {localEnvironment} from './local-tool.js';
const out=resolve(process.argv[2] || 'data/experiments/workflow-live-v1');
const ledger=JSON.parse(await readFile(join(out,'budget.json'),'utf8'));
if(ledger.status==='running')throw new Error('Wait until all paired runs finish before comparing outcomes');
const rows=[];
for(const run of ledger.runs){
 const dir=join(out,`${run.instance}-${run.arm}`);
 const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));
 let logs=[];try{logs=(await readFile(join(dir,'workflow-events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;}
 let regression=null;
 if(manifest.evaluation?.freshCheckout){
  const repo=join(dir,'evaluation-checkout'),venv=join(dir,'task-venv'),home=join(dir,'task-home'),temp=join(dir,'task-tmp');
  const script=resolve('eval/swebench/workflow-regressions',run.instance.startsWith('pydicom')?'regression_pydicom.py':'regression_astroid.py');
  const result=await command(join(venv,'bin/python'),[script],{cwd:repo,env:localEnvironment(repo,venv,home,temp),allowFailure:true,log:join(dir,'independent-regression.log')});
  regression={exitCode:result.code,timedOut:result.timedOut,passed:result.code===0&&!result.timedOut};
 }
 rows.push({instance:run.instance,arm:run.arm,state:run.state,calls:manifest.usage?.calls ?? null,totalTokens:manifest.usage?.knownTotalTokens ?? null,localSuitePassed:manifest.evaluation?.passed ?? null,independentRegression:regression,workflowTriggers:logs.filter(r=>r.triggered).length,workflowFallbacks:logs.filter(r=>r.status==='fallback').length,elapsedSeconds:(Date.parse(manifest.finishedAt)-Date.parse(manifest.startedAt))/1000});
}
const report={kind:'exploratory-two-issue-three-arm-trial',rows,conservativeCostUsd:Object.values(ledger.requests).reduce((n,r)=>n+r.charged,0),limitations:['One rollout per arm per issue; sampling variation can dominate small differences.','Rule-triggered executor workflow, not learned model routing.','Full suites and independent public-issue regressions, not official SWE-bench scoring.','Wall time includes environment preparation and evaluation.','Initial post-patch test command is still model-selected.','Treatment tool output includes validation evidence and an instruction not to repeat unchanged checks; this effect is not separately isolated.']};
await writeFile(join(out,'comparison.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
