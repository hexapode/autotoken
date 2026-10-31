import {readFile,writeFile,mkdir,open,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {runTask} from './swe-runner.js';
import {runWorkflowPool} from './workflow-pool.js';
import {CollectionBudget} from './collection-budget.js';

// Fresh baseline Opus trajectories, with one shared synchronous budget ledger.
const [outArg,budgetArg='20',workersArg='12']=process.argv.slice(2);
if(!outArg)throw Error('Usage: fast-collect NEW_OUTPUT [BUDGET_USD=20] [WORKERS=12]');
const workers=Number(workersArg),budgetUsd=Number(budgetArg);
if(!Number.isInteger(workers)||workers<1||workers>12||!Number.isFinite(budgetUsd)||budgetUsd<=0)throw Error('Invalid workers or budget');
const out=resolve(outArg);await mkdir(resolve(out,'..'),{recursive:true});await mkdir(out,{recursive:false,mode:0o700});
const lockPath=join(out,'collector.lock'),lock=await open(lockPath,'wx',0o600);await lock.writeFile(String(process.pid));await lock.close();
try{
 const previousPath=resolve('data/experiments/opus55-v1/budget.json'),previous=JSON.parse(await readFile(previousPath,'utf8'));
 if(previous.status!=='complete'||previous.budgetUsd!==50)throw Error('Original Opus allocation must be terminal and reviewed');
 const previousCost=Object.values(previous.requests).reduce((n,r)=>n+r.charged,0);
 // One burst allocation for this authorized envelope. Never silently create a
 // second allocation or let separate worker processes maintain competing ledgers.
 const allocationPath=resolve('data/experiments/opus-fast-allocation.json');
 if(!Number.isFinite(previousCost)||previousCost+budgetUsd>50)throw Error('Burst exceeds remaining authorized $50');
 const allocation=await open(allocationPath,'wx',0o600);
 await allocation.writeFile(JSON.stringify({authorizedUsd:50,priorLedger:previousPath,priorConservativeUsd:previousCost,burstLedger:join(out,'budget.json'),burstReservedUsd:budgetUsd,unallocatedUsd:50-previousCost-budgetUsd},null,2));await allocation.close();
 const inventory=JSON.parse(await readFile('data/collection-inventory-v2.json','utf8'));
 const discovery=JSON.parse(await readFile('data/collections/discovery-25usd/collection.json','utf8'));
 const eligible=new Set(discovery.tasks.filter(t=>t.state==='complete').map(t=>t.instanceId));
 const tasks=inventory.tasks.filter(t=>eligible.has(t.instance_id));
 // Reuse local environment knowledge, never patched source. Marshmallow has
 // short suites; scheduling it first brings inference workers online quickly.
 tasks.sort((a,b)=>Number(b.repo==='marshmallow-code/marshmallow')-Number(a.repo==='marshmallow-code/marshmallow')||a.instance_id.localeCompare(b.instance_id));
 const hashes={};for(const file of ['src/fast-collect.js','src/swe-runner.js','src/local-workspace.js','src/warm-workspace.js','src/workflow-pool.js','src/collection-budget.js','src/trace.js'])hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
 const state={version:1,kind:'parallel-opus-discovery',model:'claude-opus-5-5',budgetUsd,targetQueries:1600,workers,requests:{},runs:[],status:'running',startedAt:new Date().toISOString(),revision:inventory.revision,issues:tasks.map(t=>t.instance_id),codeHashes:hashes,funding:allocationPath};
 const ledger=new CollectionBudget(join(out,'budget.json'),state);ledger.save();
 process.setMaxListeners(workers+5);let stopping=false;
 const stop=()=>{stopping=true;};process.once('SIGINT',stop);process.once('SIGTERM',stop);process.once('SIGUSR2',stop);
 try{
  await runWorkflowPool(tasks.map(t=>({instance:t.instance_id,repeat:1})),workers,async spec=>{
   const task=tasks.find(t=>t.instance_id===spec.instance),record={instance:spec.instance,directory:spec.instance,state:'running',startedAt:new Date().toISOString()};state.runs.push(record);ledger.save();
   try{
    const result=await runTask({model:state.model,dataset:inventory.dataset,split:'dev',revision:inventory.revision,instance:spec.instance,execution:'local',out:join(out,spec.instance),publicTask:task,warmSource:resolve('data/collections/discovery-25usd',spec.instance),maxRequests:40,timeoutSeconds:900,evaluate:true,
     beforeRequest:opts=>{if(state.accountingError||state.budgetStopped)throw Error('Collection stopped');try{ledger.reserve(opts);state.firstDispatchAt ||= new Date().toISOString();}catch(e){if(/budget|query limit/.test(e.message))state.budgetStopped=e.message;ledger.save();throw e;}},
     onTrace:trace=>{try{ledger.settle(trace);}catch{state.accountingError='Ledger settlement failed';throw Error(state.accountingError);}}
    });Object.assign(record,{state:'complete',usage:result.usage,evaluation:result.evaluation});
   }catch(e){record.state='failed';record.error=e.message;}
   record.finishedAt=new Date().toISOString();ledger.save();console.log(JSON.stringify({instance:record.instance,state:record.state,requests:ledger.attempts,conservativeUsd:ledger.charged,elapsedSeconds:(Date.now()-Date.parse(state.startedAt))/1000}));
  },()=>stopping||state.accountingError||state.budgetStopped);
  state.status=state.accountingError?'accounting-review':state.budgetStopped?'budget-stopped':stopping?'interrupted':'complete';state.finishedAt=new Date().toISOString();ledger.save();
  await writeFile(join(out,'summary.json'),JSON.stringify({status:state.status,queries:ledger.attempts,conservativeUsd:ledger.charged,elapsedSeconds:(Date.parse(state.finishedAt)-Date.parse(state.startedAt))/1000,runs:state.runs},null,2),{mode:0o600});
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);process.removeListener('SIGUSR2',stop);}
}finally{await unlink(lockPath);}
