import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {command} from './swe-runner.js';
import {localEnvironment} from './local-tool.js';
import {expandPlan} from './workflow-plan.js';
const out=resolve(process.argv[2] || 'data/experiments/workflow-live-v1');
const ledger=JSON.parse(await readFile(join(out,'budget.json'),'utf8'));
if(ledger.status==='running')throw new Error('Wait until all paired runs finish before comparing outcomes');
const rows=[];
for(const run of ledger.runs){
 const dir=join(out,run.directory || `${run.instance}-${run.arm}`);
 let manifest={};
 try {manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));} catch { /* Missing or partial manifests remain incomplete rows. */ }
 let logs=[];try{logs=(await readFile(join(dir,'workflow-events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;}
 let regression=null;
 if(manifest.evaluation?.freshCheckout && ['pylint-dev__astroid-1866','pydicom__pydicom-1694'].includes(run.instance)){
  const repo=join(dir,'evaluation-checkout'),venv=join(dir,'task-venv'),home=join(dir,'task-home'),temp=join(dir,'task-tmp');
  const script=resolve('eval/swebench/workflow-regressions',run.instance.startsWith('pydicom')?'regression_pydicom.py':'regression_astroid.py');
  const result=await command(join(venv,'bin/python'),[script],{cwd:repo,env:localEnvironment(repo,venv,home,temp),allowFailure:true,log:join(dir,'independent-regression.log')});
  regression={exitCode:result.code,timedOut:result.timedOut,passed:result.code===0&&!result.timedOut};
 }
 rows.push({instance:run.instance,repeat:run.repeat || 1,arm:run.arm,state:run.state,calls:manifest.usage?.calls ?? null,totalTokens:manifest.usage?.knownTotalTokens ?? null,localSuitePassed:manifest.evaluation?.passed ?? null,independentRegression:regression,workflowTriggers:logs.filter(r=>r.triggered).length,workflowFallbacks:logs.filter(r=>r.status==='fallback').length,elapsedSeconds:(Date.parse(manifest.finishedAt)-Date.parse(manifest.startedAt))/1000});
}
if(ledger.plan?.version===1){
 const planned=expandPlan(ledger.plan,{split:'dev',tasks:ledger.plan.issues.map(instance_id=>({instance_id}))});
 for(const spec of planned)if(!rows.some(r=>r.instance===spec.instance&&r.repeat===spec.repeat&&r.arm===spec.arm))rows.push({...spec,state:'not-started',calls:null,totalTokens:null,localSuitePassed:null,independentRegression:null});
}
const groups=new Map();
for(const row of rows){const key=`${row.instance}:r${row.repeat}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
const pairedBlocks=[],excludedBlocks=[];
for(const [key,block] of groups){
 if(block.length!==3 || new Set(block.map(r=>r.arm)).size!==3 || block.some(r=>r.state!=='complete'||r.localSuitePassed!==true||r.independentRegression?.passed===false||!Number.isFinite(r.calls))) {excludedBlocks.push({key,reason:'Missing, incomplete, or nonpassing arm'});continue;}
 const byArm=Object.fromEntries(block.map(r=>[r.arm,r]));
 pairedBlocks.push({key,calls:Object.fromEntries(block.map(r=>[r.arm,r.calls])),workflowMinusBaseline:byArm.workflow.calls-byArm.baseline.calls,singletonMinusBaseline:byArm.singleton.calls-byArm.baseline.calls,workflowMinusSingleton:byArm.workflow.calls-byArm.singleton.calls});
}
const report={kind:'paired-workflow-trial',rows,pairedBlocks,excludedBlocks,conservativeCostUsd:Object.values(ledger.requests).reduce((n,r)=>n+r.charged,0),limitations:['Small development-issue sample; repeated rollouts on an issue are not independent issues.','Rule-triggered executor workflow, not learned model routing.','Independent regressions exist only for the original two issues; null means unavailable. Full suites are not proof of issue resolution or official SWE-bench scoring.','Wall time includes environment preparation and evaluation.','Initial post-patch test command is still model-selected.','Treatment tool output includes validation evidence and an instruction not to repeat unchanged checks; this effect is not separately isolated.']};
await writeFile(join(out,'comparison.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
