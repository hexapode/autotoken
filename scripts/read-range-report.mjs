import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const dir=resolve(process.argv[2]||'data/experiments/read-range-live-v1');
const output=process.argv[3];
const state=JSON.parse(await readFile(join(dir,'budget.json')));
const strictIds=new Set(['asottile__pyupgrade-890','asottile__pyupgrade-142','asottile__pyupgrade-104']);
const runs=[];
for(const r of state.runs){
 let m;try{m=JSON.parse(await readFile(join(r.directory,'manifest.json')));}catch{continue;}
 let events=[];try{events=(await readFile(join(r.directory,'read-range-events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch{}
 const traces=[];try{for(const f of await readdir(join(r.directory,'traces')))traces.push(JSON.parse(await readFile(join(r.directory,'traces',f,'metadata.json'))));}catch{}
 const ids=new Set(traces.map(t=>t.id));
 runs.push({instance:r.instance,repeat:r.repeat,arm:r.arm,state:r.state,strictEligible:strictIds.has(r.instance),calls:m.usage?.calls??0,tokens:m.usage?.knownTotalTokens??0,costUsd:Object.entries(state.requests).filter(([id])=>ids.has(id)).reduce((n,[,r])=>n+r.charged,0),suitePassed:m.evaluation?.passed??null,bugTestsPassed:m.datasetOracle?.passed??null,oracleReproduced:m.datasetOracle?.reproduced??null,inferenceMs:r.inferenceMs??null,reads:events.filter(e=>e.type==='read').length,retries:events.filter(e=>e.type==='retry').length,successfulRetries:events.filter(e=>e.type==='retry'&&e.succeeded).length});
}
const pairs=[];
for(const b of runs.filter(r=>r.strictEligible&&r.arm==='read-range-baseline'&&r.state==='complete')){
 const t=runs.find(r=>r.instance===b.instance&&r.repeat===b.repeat&&r.arm==='read-range-repair'&&r.state==='complete');
 if(t)pairs.push({instance:b.instance,repeat:b.repeat,baseline:b,treatment:t});
}
const sum=(arm,key)=>pairs.reduce((n,p)=>n+(p[arm][key]||0),0);
const report={version:1,status:state.status,model:state.model,harness:'Pi with an OpenHands-style view tool',plannedRuns:36,attemptedRuns:runs.length,completedRuns:runs.filter(r=>r.state==='complete').length,providerRequests:Object.keys(state.requests).length,conservativeCostUsd:Object.values(state.requests).reduce((n,r)=>n+r.charged,0),strictEligibleIssues:[...strictIds],completeStrictPairs:pairs.length,paired:{baseline:{calls:sum('baseline','calls'),tokens:sum('baseline','tokens'),bugTestsPassed:sum('baseline','bugTestsPassed'),suitePassed:sum('baseline','suitePassed')},treatment:{calls:sum('treatment','calls'),tokens:sum('treatment','tokens'),bugTestsPassed:sum('treatment','bugTestsPassed'),suitePassed:sum('treatment','suitePassed'),automaticRetries:sum('treatment','retries')}},allRunsAutomaticRetries:runs.reduce((n,r)=>n+r.retries,0),protocolDeviation:'Preflight initially accepted assertion text inside exception tracebacks. Three issues (146,143,135) were excluded from the strict cohort after inference started, before their paired outcomes were examined. Their usage remains included in total spending and their runs are reported separately.',limitations:['Not official SWE-bench evaluation.','No synthetic read errors in live runs.','A call-count difference without a repair trigger is model sampling variation, not evidence that the program saved a call.','Replay and scripted integration do not establish live savings.'],runs,pairs};
try { const supplemental=JSON.parse(await readFile(join(dir,'supplemental-oracle-report.json'))); report.supplementalEvaluation={kind:supplemental.kind,method:supplemental.method,summary:supplemental.summary}; } catch {}
if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,runs:undefined,pairs:undefined},null,2));
