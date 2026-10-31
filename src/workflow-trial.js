// Resumable paired trial; budget counts every dispatched request, including unknown usage.
import { readFile, mkdir, writeFile, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { runTask } from './swe-runner.js';
import { CollectionBudget } from './collection-budget.js';
import { expandPlan } from './workflow-plan.js';
import { runWorkflowPool } from './workflow-pool.js';

const [outArg,budgetArg,planFile,modelArg='gpt-6.1-sol',workersArg='1',migrationArg]=process.argv.slice(2);
if(!outArg||!Number.isFinite(Number(budgetArg))||Number(budgetArg)<=0)throw new Error('Usage: node src/workflow-trial.js OUTPUT_DIRECTORY BUDGET_USD [PLAN_JSON] [MODEL_ID] [WORKERS=1] [--migrate-runtime]');
const workers=Number(workersArg);
if(!Number.isSafeInteger(workers)||workers<1||workers>3)throw new Error('Workers must be 1..3');
const out=resolve(outArg);await mkdir(out,{recursive:true,mode:0o700});
const lockPath=join(out,'trial.lock');const lock=await open(lockPath,'wx',0o600);await lock.writeFile(String(process.pid));await lock.close();
try {
 const inventory=JSON.parse(await readFile('data/collection-inventory-v2.json','utf8'));
 const plan=planFile?JSON.parse(await readFile(planFile,'utf8')):{version:1,issues:['pylint-dev__astroid-1866','pydicom__pydicom-1694'],repeats:1};
 const schedule=expandPlan(plan,inventory);
 const codeHashes={};
 for(const path of ['src/swe-runner.js','src/experiment-model.js','src/collection-budget.js','src/recording-proxy.js','src/trace-anthropic.js','src/trace.js','src/workflow-pool.js','src/local-tool.js','src/local-workspace.js','src/validation-workflow.js','eval/swebench/workflow-extension.ts','src/workflow-plan.js','src/workflow-trial.js']) codeHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
 let state;try{state=JSON.parse(await readFile(join(out,'budget.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(state&&(JSON.stringify(state.plan)!==JSON.stringify(plan)||state.budgetUsd!==Number(budgetArg)||state.model!==modelArg||state.revision!==inventory.revision))throw new Error('Resume requires identical plan, budget, dataset and runtime code');
 if(state && JSON.stringify(state.codeHashes)!==JSON.stringify(codeHashes)) {
  if(migrationArg!=='--migrate-runtime'||state.status==='running'||state.accountingError)throw new Error('Stopped trial requires explicit --migrate-runtime for runtime changes');
  (state.runtimeMigrations ||= []).push({at:new Date().toISOString(),previousCodeHashes:state.codeHashes,codeHashes,workers,reason:'Parallel scheduling and compressed-response analysis; experimental arms unchanged'});
  state.codeHashes=codeHashes;
 }
 state ||= {version:2,model:modelArg,kind:'expanded-paired-workflow-trial',startedAt:new Date().toISOString(),budgetUsd:Number(budgetArg),targetQueries:schedule.length*40,requests:{},runs:[],plan,revision:inventory.revision,codeHashes,status:'running'};
 for(const run of state.runs)if(run.state==='running'){run.state='interrupted';run.error='Interrupted run retained; no automatic retry';}
 state.status='running';state.workers=workers;delete state.finishedAt;
 let stopping=false;const stop=()=>{stopping=true;};process.once('SIGUSR2',stop);process.once('SIGINT',stop);process.once('SIGTERM',stop);
 const ledger=new CollectionBudget(join(out,'budget.json'),state);ledger.save();
 try {
  await runWorkflowPool(schedule,workers,async spec => {
   if(state.runs.some(r=>r.key===spec.key))return;
   const record={...spec,directory:spec.key,state:'running'};state.runs.push(record);ledger.save();
   try {
    const result=await runTask({model:modelArg,dataset:inventory.dataset,split:'dev',revision:inventory.revision,instance:spec.instance,execution:'local',out:join(out,spec.key),maxRequests:40,timeoutSeconds:900,evaluate:true,...(spec.arm==='baseline'?{}:{workflowArm:spec.arm}),
     beforeRequest:opts=>{if(state.accountingError)throw new Error('Accounting review required');try{ledger.reserve(opts);}catch(e){if(/budget|query limit/.test(e.message))state.budgetStopped=e.message;ledger.save();throw e;}},
     onTrace:trace=>{try{ledger.settle(trace);}catch(e){state.accountingError='Budget ledger write failed';throw e;}}
    });
    Object.assign(record,{state:'complete',evaluation:result.evaluation,usage:result.usage});
   }catch(e){record.state='failed';record.error=e.message;}
   ledger.save();console.log(JSON.stringify({...spec,state:record.state,queries:record.usage?.calls,passed:record.evaluation?.passed,totalConservativeUsd:ledger.charged}));
  },()=>stopping||state.accountingError||state.budgetStopped);
  state.status=stopping?'interrupted':state.accountingError?'accounting-review':state.budgetStopped?'budget-stopped':'complete';state.finishedAt=new Date().toISOString();ledger.save();
  await writeFile(join(out,'summary.json'),JSON.stringify({status:state.status,conservativeUsd:ledger.charged,queries:ledger.attempts,plannedRuns:schedule.length,runs:state.runs},null,2));
 }finally{process.removeListener('SIGUSR2',stop);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}finally{await unlink(lockPath);}
