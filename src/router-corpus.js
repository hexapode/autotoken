import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {extractRun} from './trajectory-analysis.js';
import {makeRows} from './router-experiment.js';
import {fingerprint,newPolicy,observe,metrics,calibrate,PATCH_REVIEW} from './decision-router.js';

export const DEFAULT_ROOTS=['data/swebench','data/collections/discovery-25usd','data/experiments/workflow-live-v1','data/experiments/workflow-expanded-v2','data/experiments/opus55-v1','data/experiments/opus-fast-v1'];
export async function snapshotCorpus(roots){
 const runs=[],excluded=[],sources=[],seen=new Set();
 for(const root of roots){
  const source={root:resolve(root),records:0,duplicateRecords:0,completeResponses:0,finishedRuns:0};sources.push(source);
  let directories;try{directories=await readdir(root,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')continue;throw e;}
  for(const entry of directories.filter(d=>d.isDirectory())){
   const directory=join(root,entry.name);let manifest;
   try{manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));}catch{continue;}
   let traceDirs;try{traceDirs=await readdir(join(directory,'traces'),{withFileTypes:true});}catch{continue;}
   const records=[];
   for(const trace of traceDirs.filter(d=>d.isDirectory())){
    const path=join(directory,'traces',trace.name);
    try{
     const metadata=JSON.parse(await readFile(join(path,'metadata.json'),'utf8'));source.records++;
     if(seen.has(metadata.id)){source.duplicateRecords++;continue;}
     seen.add(metadata.id);
     if(metadata.state==='complete'&&metadata.upstreamStatus===200&&metadata.response?.status!=='failed'&&metadata.response?.status!=='incomplete'&&!metadata.response?.error)source.completeResponses++;
     if(manifest.state!=='complete'){excluded.push({traceId:metadata.id,reason:`Run ${manifest.state}`,directory});continue;}
     const request=JSON.parse(await readFile(join(path,'request.json'),'utf8'));records.push({metadata,request});
    }catch{excluded.push({directory:path,reason:'Unreadable trace'});}
   }
   if(manifest.state==='complete'&&records.length&&manifest.options?.instance){
    const run=extractRun(manifest,records,directory);
    runs.push({...run,startedAt:manifest.startedAt,arm:manifest.options.programArm||manifest.options.workflowArm||'baseline',sourceRoot:resolve(root)});source.finishedRuns++;
   }
  }
 }
 runs.sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.directory.localeCompare(b.directory));
 return {createdAt:new Date().toISOString(),sources,runs,excluded};
}
export function issueFolds(runs,count=5){
 if(!Number.isInteger(count)||count<3)throw Error('At least three issue folds required');
 const ids=[...new Set(runs.map(r=>r.instanceId))].sort((a,b)=>fingerprint('all-traces-v1:'+a).localeCompare(fingerprint('all-traces-v1:'+b)));
 if(ids.length<count)throw Error('Insufficient distinct issues');
 return Object.fromEntries(ids.map((id,i)=>[id,i%count]));
}
function fit(rows,epochs){const p=newPolicy();for(let n=0;n<epochs;n++)for(const r of rows)observe(p,r.context,r.label);return p;}
function totals(values){
 const keys=['examples','positives','selected','tp','fp','fn','tn','exactActionMatches'];
 const out=Object.fromEntries(keys.map(k=>[k,values.reduce((sum,v)=>sum+v[k],0)]));
 return {...out,precision:out.selected?out.tp/out.selected:null,recall:out.positives?out.tp/out.positives:null};
}
export function evaluateCorpus(snapshot,count=5){
 const assignments=issueFolds(snapshot.runs,count),folds=[];
 for(let fold=0;fold<count;fold++){
  const role=issue=>assignments[issue]===fold?'test':assignments[issue]===(fold+1)%count?'calibration':'train';
  const select=(part,arm='baseline')=>snapshot.runs.filter(r=>role(r.instanceId)===part&&(arm==='treatment'?r.arm!=='baseline':r.arm===arm));
  const train=makeRows(select('train')),calibration=makeRows(select('calibration')),test=makeRows(select('test')),treatments=makeRows(select('test','treatment'));
  const policies={batch:fit(train,40),online:fit(train,1)};
  const result={fold,issues:Object.fromEntries(['train','calibration','test'].map(part=>[part,Object.keys(assignments).filter(id=>role(id)===part)])),trainingExamples:train.length,trainingPositives:train.filter(r=>r.label).length,calibrationExamples:calibration.length,calibrationPositives:calibration.filter(r=>r.label).length,policies:{}};
  for(const [name,policy] of Object.entries(policies)){
   const gate=calibrate(calibration,policy);
   const perModel={};
   for(const model of new Set(select('test').map(r=>r.model)))perModel[model]=metrics(makeRows(select('test').filter(r=>r.model===model)),policy,gate.threshold);
   result.policies[name]={policy,threshold:gate.threshold,qualified:gate.qualified,test:metrics(test,policy,gate.threshold),perModel,treatmentDiagnostic:metrics(treatments,policy,gate.threshold),exploratoryAtPointOne:metrics(test,policy,.1)};
  }
  folds.push(result);
 }
 const summary={};
 for(const name of ['batch','online'])summary[name]={primary:totals(folds.map(f=>f.policies[name].test)),treatmentDiagnostic:totals(folds.map(f=>f.policies[name].treatmentDiagnostic)),exploratoryAtPointOne:totals(folds.map(f=>f.policies[name].exploratoryAtPointOne)),qualifiedFolds:folds.filter(f=>f.policies[name].qualified).length};
 return {version:1,kind:'all-corpus-issue-grouped-replay',createdAt:snapshot.createdAt,program:PATCH_REVIEW,assignmentSeed:'all-traces-v1:',assignments,sources:snapshot.sources,finishedRuns:snapshot.runs.length,distinctIssues:Object.keys(assignments).length,excluded:snapshot.excluded,summary,folds,realizedQueriesSaved:null,deploymentEligible:false,
 limitations:['Snapshot excludes unfinished/failed runs from scored replay; their trace IDs remain in the audit.','All providers, repetitions, and experimental arms of an issue share its fold.','Training and calibration use baseline runs only; treatment runs are diagnostic only.','Each issue is evaluated once out of fold. Repeated runs are correlated, not independent issues.','The patch-review hypothesis and some traces were inspected previously; cross-validation is not a pristine benchmark.','Programs, feature definitions, hyperparameters and thresholds are reused unchanged from router replay v1.','Coverage labels are heuristic whole-action compatibility, not equivalent output, independent task success, or realized savings.','Five-fold validation simulates the local classifier and restricted program proposal, not hosted decision-model accuracy or general code synthesis.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [outArg,...roots]=process.argv.slice(2);if(!outArg)throw Error('Usage: router-corpus OUTPUT_DIRECTORY [TRACE_ROOT ...]');
  const out=resolve(outArg);await mkdir(resolve(out,'..'),{recursive:true});await mkdir(out,{recursive:false,mode:0o700});
  if(roots[0]==='--snapshot'&&roots.length!==2)throw Error('Expected --snapshot SNAPSHOT_JSON');
  const snapshot=roots[0]==='--snapshot'?JSON.parse(await readFile(roots[1],'utf8')):await snapshotCorpus(roots.length?roots:DEFAULT_ROOTS);
  const report=evaluateCorpus(snapshot);
  await writeFile(join(out,'snapshot.json'),JSON.stringify(snapshot,null,2),{mode:0o600});
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({sources:report.sources,finishedRuns:report.finishedRuns,distinctIssues:report.distinctIssues,excluded:report.excluded.length,summary:report.summary},null,2));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
