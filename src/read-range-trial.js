// Frozen fresh-task trial. One owner and a durable reservation before each API call.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {runTask} from './swe-runner.js';
import {CollectionBudget} from './collection-budget.js';
import {runWorkflowPool} from './workflow-pool.js';

const catalog=resolve(process.argv[2] || '');
if(!process.argv[2])throw Error('Usage: node --env-file=.env.anthropic src/read-range-trial.js PREFLIGHT_DIRECTORY');
const report=JSON.parse(await readFile(join(catalog,'report.json')));
const records=report.records.filter(r=>r.state==='eligible'&&r.repo==='asottile/pyupgrade').slice(0,20);
if(!records.length)throw Error('No eligible fresh tasks');
const tasks=await Promise.all(records.map(async r=>({...r,task:JSON.parse(await readFile(r.publicTask))})));
const out=resolve('data/experiments/read-range-live-v1');
const priorLedgers=['opus55-v1','opus-fast-v1','search-context-live-v1'];
let prior=0;
for(const name of priorLedgers){
 const old=JSON.parse(await readFile(`data/experiments/${name}/budget.json`));
 if(!['complete','budget-stopped'].includes(old.status)||old.accountingError||old.externalCosts?.length)throw Error('Prior ledger not settled');
 for(const r of Object.values(old.requests)){
  if(r.state==='reserved'||!Number.isFinite(r.charged)||r.charged<0)throw Error('Unsettled prior request');
  prior+=r.charged;
 }
}
const cap=19.20;
if(prior+cap>50)throw Error('Would exceed authorized total');
await mkdir(out,{recursive:false,mode:0o700});
await writeFile('data/experiments/read-range-live-allocation.json',JSON.stringify({authorizedUsd:50,priorConservativeUsd:prior,reservedUsd:cap,ledger:join(out,'budget.json')},null,2),{flag:'wx',mode:0o600});
const schedule=[];
for(let repeat=1;repeat<=3;repeat++)for(const [i,r] of tasks.entries()){
 const arms=['read-range-baseline','read-range-repair'];if((i+repeat)%2===0)arms.reverse();
 for(const arm of arms)schedule.push({instance:r.task.instance_id,repeat,arm});
}
const hashes={};for(const path of ['src/read-range-tool.js','eval/swebench/read-range-extension.ts','src/swe-runner.js','src/dataset-oracle.js','src/local-workspace.js','src/read-range-trial.js'])hashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
await writeFile(join(out,'protocol.json'),JSON.stringify({version:1,kind:'fresh-issue-paired-live-trial',model:'claude-opus-5-5',harness:'Pi with an OpenHands-style view tool',workers:3,maxRequests:20,timeoutSeconds:600,repeats:3,codeHashes:hashes,schedule,tasks:tasks.map(r=>r.task),selection:'preflight suite passes; held-out dataset bug tests fail by assertion; no source gold patch read',primary:'paired total provider calls, with suite and independent bug-test outcomes',secondary:['tokens','conservative cost','inference wall time','natural error triggers'],limitations:['local execution, not official SWE-bench evaluation','model sampling variance','budget may stop before planned repeats']},null,2),{mode:0o600});
const state={model:'claude-opus-5-5',budgetUsd:cap,targetQueries:2400,requests:{},runs:[],status:'running',startedAt:new Date().toISOString()};
const budget=new CollectionBudget(join(out,'budget.json'),state);budget.save();let stopped=false;
await runWorkflowPool(schedule,3,async spec=>{
 const selected=tasks.find(r=>r.task.instance_id===spec.instance),directory=join(out,`${spec.instance}-r${spec.repeat}-${spec.arm}`);
 const record={...spec,state:'running',directory};state.runs.push(record);budget.save();
 try{
  const result=await runTask({model:state.model,dataset:'nebius/SWE-bench-extra',split:'train',revision:'11dcbfb30e19552df2a2f8030bd764adc95c92a5',instance:spec.instance,execution:'local',publicTask:selected.task,programArm:spec.arm,datasetOraclePath:selected.oracle,out:directory,maxRequests:20,timeoutSeconds:600,evaluate:true,beforeRequest:opts=>{if(stopped)throw Error('Trial budget stopped');try{budget.reserve(opts);}catch(e){if(/budget|Accounting|accounting|reservation/i.test(e.message))stopped=true;throw e;}},onTrace:t=>budget.settle(t)});
  let events=[];try{events=(await readFile(join(directory,'read-range-events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch{}
  Object.assign(record,{state:'complete',calls:result.usage.calls,tokens:result.usage.knownTotalTokens,suitePassed:result.evaluation.passed,bugTestsPassed:result.datasetOracle?.passed===true,inferenceMs:Date.parse(result.stageTimes['exporting-patch'])-Date.parse(result.stageTimes.inference),reads:events.filter(e=>e.type==='read').length,retries:events.filter(e=>e.type==='retry').length});
 }catch(e){record.state='failed';record.error=e.message;}
 budget.save();console.log(JSON.stringify(record));
},()=>stopped||!!state.accountingError);
state.status=stopped?'budget-stopped':'complete';state.finishedAt=new Date().toISOString();budget.save();
const pairs=[];
for(const base of state.runs.filter(r=>r.arm==='read-range-baseline'&&r.state==='complete')){
 const treatment=state.runs.find(r=>r.instance===base.instance&&r.repeat===base.repeat&&r.arm==='read-range-repair'&&r.state==='complete');
 if(treatment)pairs.push({instance:base.instance,repeat:base.repeat,baseline:base,treatment,savedCalls:base.calls-treatment.calls,savedTokens:base.tokens-treatment.tokens});
}
await writeFile(join(out,'report.json'),JSON.stringify({status:state.status,plannedRuns:schedule.length,attemptedRuns:state.runs.length,completedRuns:state.runs.filter(r=>r.state==='complete').length,completePairs:pairs.length,costUsd:budget.charged,pairs},null,2),{mode:0o600});
console.log(JSON.stringify({status:state.status,costUsd:budget.charged,completePairs:pairs.length}));
