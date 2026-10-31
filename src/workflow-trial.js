// Paired exploratory trial. Invocation authorizes at most the supplied budget.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { runTask } from './swe-runner.js';
import { CollectionBudget } from './collection-budget.js';

const [outArg, budgetArg] = process.argv.slice(2);
if (!outArg || !Number.isFinite(Number(budgetArg)) || Number(budgetArg) <= 0) throw new Error('Usage: node src/workflow-trial.js NEW_OUTPUT_DIRECTORY BUDGET_USD');
const out=resolve(outArg); await mkdir(out,{recursive:false,mode:0o700});
const inventory=JSON.parse(await readFile('data/collection-inventory-v2.json','utf8'));
const pairs=[['pylint-dev__astroid-1866',['baseline','singleton','workflow']],['pydicom__pydicom-1694',['workflow','singleton','baseline']]];
const state={version:1,kind:'exploratory-paired-workflow-trial',startedAt:new Date().toISOString(),budgetUsd:Number(budgetArg),targetQueries:240,requests:{},runs:[],plan:pairs,revision:inventory.revision,codeHashes:{},status:'running'};
for(const path of ['src/swe-runner.js','src/local-tool.js','src/local-workspace.js','src/validation-workflow.js','eval/swebench/workflow-extension.ts']) {
 try {state.codeHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');} catch(e){if(e.code!=='ENOENT')throw e;}
}
let stopping=false;
process.once('SIGINT',()=>{stopping=true;});process.once('SIGTERM',()=>{stopping=true;});
const ledger=new CollectionBudget(join(out,'budget.json'),state);ledger.save();
for(const [instance,arms] of pairs) {
 for(const arm of arms) {
  if(stopping||state.accountingError||state.budgetStopped)break;
  const record={instance,arm,state:'running'};state.runs.push(record);ledger.save();
  try {
   const result=await runTask({dataset:inventory.dataset,split:'dev',revision:inventory.revision,instance,execution:'local',out:join(out,`${instance}-${arm}`),maxRequests:40,timeoutSeconds:900,evaluate:true,...(arm==='baseline'?{}:{workflowArm:arm}),
    beforeRequest:opts=>{if(stopping||state.accountingError)throw new Error('Accounting review required');try{ledger.reserve(opts);}catch(e){if(/budget|query limit/.test(e.message))state.budgetStopped=e.message;ledger.save();throw e;}},
    onTrace:trace=>{try{ledger.settle(trace);}catch(e){state.accountingError='Budget ledger write failed';throw e;}}
   });
   Object.assign(record,{state:'complete',evaluation:result.evaluation,usage:result.usage});
  }catch(e){record.state='failed';record.error=e.message;}
  ledger.save();console.log(JSON.stringify({instance,arm,state:record.state,queries:record.usage?.calls,passed:record.evaluation?.passed,totalConservativeUsd:ledger.charged}));
 }
}
state.status=stopping?'interrupted':state.accountingError?'accounting-review':state.budgetStopped?'budget-stopped':'complete';state.finishedAt=new Date().toISOString();ledger.save();
await writeFile(join(out,'summary.json'),JSON.stringify({status:state.status,conservativeUsd:ledger.charged,queries:ledger.attempts,runs:state.runs},null,2));
