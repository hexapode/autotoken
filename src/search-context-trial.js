// One-off development probe. Allocation guard prevents silently reusing its budget.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=process.cwd();const {runTask,command}=await import(`${root}/src/swe-runner.js`);const {CollectionBudget}=await import(`${root}/src/collection-budget.js`);const {localEnvironment}=await import(`${root}/src/local-tool.js`);
const out=resolve('data/experiments/search-context-live-v1');await mkdir(out,{recursive:false,mode:0o700});
const old=JSON.parse(await readFile('data/experiments/opus55-v1/budget.json')),burst=JSON.parse(await readFile('data/experiments/opus-fast-v1/budget.json'));
if(old.status!=='complete'||burst.status!=='budget-stopped')throw Error('Prior spending not settled');
const charged=d=>Object.values(d.requests).reduce((n,r)=>n+r.charged,0);const prior=charged(old)+charged(burst);if(prior+3>50)throw Error('Authorization exceeded');
await writeFile('data/experiments/search-context-live-allocation.json',JSON.stringify({authorizedUsd:50,priorConservativeUsd:prior,pilotReservedUsd:3,ledger:join(out,'budget.json')},null,2),{flag:'wx',mode:0o600});
const inventory=JSON.parse(await readFile('data/collection-inventory-v2.json'));const task=inventory.tasks.find(t=>t.instance_id==='marshmallow-code__marshmallow-1524');
const state={model:'claude-opus-5-5',budgetUsd:3,targetQueries:30,requests:{},runs:[],status:'running',startedAt:new Date().toISOString(),kind:'development-mechanism-probe-not-independent-evaluation'};const budget=new CollectionBudget(join(out,'budget.json'),state);budget.save();
await Promise.all(['baseline','search-context'].map(async arm=>{
 const directory=join(out,arm),record={arm,state:'running'};state.runs.push(record);budget.save();
 try{
  const result=await runTask({model:state.model,dataset:inventory.dataset,split:'dev',revision:inventory.revision,instance:task.instance_id,execution:'local',publicTask:task,warmSource:resolve('data/collections/discovery-25usd',task.instance_id),out:directory,maxRequests:15,timeoutSeconds:300,evaluate:true,...(arm==='baseline'?{}:{programArm:arm}),beforeRequest:opts=>{if(state.accountingError)throw Error('Accounting review');budget.reserve(opts);},onTrace:t=>budget.settle(t)});
  const regression=join(directory,'public-issue-check.py');await writeFile(regression,"from marshmallow.validate import Email\nfrom marshmallow import ValidationError\nEmail()('email@domain.com')\nfor value in ['email@domain.com\\n', 'email\\n@domain.com', 'email\\n@domain.com\\n']:\n    try:\n        Email()(value)\n    except ValidationError:\n        pass\n    else:\n        raise AssertionError(repr(value))\nprint('Public issue email checks passed')\n");
  const repo=join(directory,'evaluation-checkout'),venv=join(directory,'task-venv'),home=join(directory,'task-home'),temp=join(directory,'task-tmp');
  const check=await command(join(venv,'bin/python'),[regression],{cwd:repo,env:localEnvironment(repo,venv,home,temp),allowFailure:true});
  Object.assign(record,{state:'complete',calls:result.usage.calls,tokens:result.usage.knownTotalTokens,suitePassed:result.evaluation.passed,issueCheckPassed:check.code===0,issueCheckOutput:check.stdout+check.stderr});
 }catch(e){record.state='failed';record.error=e.message;}
 budget.save();console.log(JSON.stringify(record));
}));
state.status='complete';state.finishedAt=new Date().toISOString();budget.save();console.log(JSON.stringify({cost:budget.charged,runs:state.runs}));
