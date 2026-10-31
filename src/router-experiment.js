import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {analyzeTrajectories} from './trajectory-analysis.js';
import {PATCH_REVIEW,FEATURES,fingerprint,contextBefore,newPolicy,observe,metrics,calibrate,reviewLabel,exactMatch} from './decision-router.js';

export function makeRows(runs){return runs.flatMap(run=>run.turns.flatMap((turn,index)=>turn.valid?[{id:turn.id,issue:run.instanceId,context:contextBefore(run,index),label:reviewLabel(turn),exact:exactMatch(turn)}]:[]));}
export function splitIssues(runs){
 const ids=[...new Set(runs.map(r=>r.instanceId))].sort((a,b)=>fingerprint('router-v1:'+a).localeCompare(fingerprint('router-v1:'+b)));
 const trainEnd=Math.floor(ids.length*.6),calEnd=Math.floor(ids.length*.8);
 const partitions={train:ids.slice(0,trainEnd),calibration:ids.slice(trainEnd,calEnd),test:ids.slice(calEnd)};
 return Object.fromEntries(Object.entries(partitions).map(([key,ids])=>[key,{issues:ids,rows:makeRows(runs.filter(r=>ids.includes(r.instanceId)))}]));
}
function fit(rows,epochs){const policy=newPolicy();for(let epoch=0;epoch<epochs;epoch++)for(const row of rows)observe(policy,row.context,row.label);return policy;}
export async function runRouterExperiment(analysis,out,externalRuns=[]){
 const runs=analysis.runs.filter(r=>r.state==='complete'&&r.localTestsPassed===true);
 if(runs.length<10)throw Error('Need at least 10 passing discovery issues');
 const split=splitIssues(runs),positives=split.train.rows.filter(r=>r.label);
 if(new Set(positives.map(r=>r.issue)).size<2)throw Error('Insufficient recurring program evidence on training issues');
 // Restricted synthesis: compose audited operations, never arbitrary model source.
 const program={...PATCH_REVIEW,status:'shadow',sourceIssues:[...new Set(positives.map(r=>r.issue))],sourceTraceIds:positives.map(r=>r.id),synthesis:'restricted-operation-template'};
 const policy=fit(split.train.rows,40),online=fit(split.train.rows,1);
 const calibration=calibrate(split.calibration.rows,policy),onlineCalibration=calibrate(split.calibration.rows,online);
 const test=metrics(split.test.rows,policy,calibration.threshold),onlineTest=metrics(split.test.rows,online,onlineCalibration.threshold);
 const used=new Set(runs.map(r=>r.instanceId));
 if(externalRuns.some(r=>used.has(r.instanceId)))throw Error('External evaluation issues overlap discovery');
 const external=makeRows(externalRuns);
 const report={version:1,kind:'offline-router-replay',createdAt:new Date().toISOString(),program,
 partitions:Object.fromEntries(Object.entries(split).map(([k,v])=>[k,{issues:v.issues,examples:v.rows.length,positives:v.rows.filter(r=>r.label).length}])),
 features:FEATURES,batch:{epochs:40,calibration,test,external:metrics(external,policy,calibration.threshold),diagnosticAtPointOne:{test:metrics(split.test.rows,policy,.1),external:metrics(external,policy,.1)}},
 online:{passes:1,updates:online.updates,calibration:onlineCalibration,test:onlineTest,external:metrics(external,online,onlineCalibration.threshold),diagnosticAtPointOne:{test:metrics(split.test.rows,online,.1),external:metrics(external,online,.1)}},
 externalIssues:[...new Set(external.map(r=>r.issue))],
 deploymentEligible:false,realizedQueriesSaved:null,
 limitations:['Historical replay, not a live intervention or measured savings.','Labels mark whole-turn read-only Git packet compatibility, not equivalent output or verified task success.','Router inputs contain only past commands/results, never the target response.','Issue-level train/calibration/test partitions are fixed before fitting.','These discovery traces were previously inspected by the project; this is algorithm-held-out evaluation, not a pristine benchmark.','One frozen first-repetition baseline per external issue; no treatment traces train the router.','Candidate is compiled from a restricted operation template; no paid model synthesis or routing calls in this experiment.','Online learning uses training examples once; held-out labels never update weights.','The fixed 0.1 diagnostic threshold is exploratory and never used for promotion.', 'Activation requires independent downstream task checks and measured total cost, beyond replay precision.']};
 const artifact={version:1,program,policy,threshold:calibration.threshold,status:'shadow',reportHash:fingerprint(report),trainingIssues:split.train.issues,evaluationIssues:[...split.calibration.issues,...split.test.issues,...report.externalIssues],deploymentEligible:false};
 await mkdir(out,{recursive:true,mode:0o700});
 const save=(file,value)=>writeFile(join(out,file),JSON.stringify(value,null,2),{mode:0o600});
 await save('report.json',report);await save('router.json',artifact);await save('online-router.json',{...artifact,policy:online,threshold:onlineCalibration.threshold});
 await writeFile(join(out,'patch-review.js'),`// Generated from the restricted operation registry. Proposed tool action only.\nexport default function propose(args) {\n if (!args || args.scope !== 'current_patch' || Object.keys(args).length !== 1) return null;\n return ${JSON.stringify({name:'local_bash',arguments:{command:PATCH_REVIEW.commands.join('; '),timeout:30}})};\n}\n`,{mode:0o600});
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [input,outArg,externalRoot]=process.argv.slice(2);if(!input||!outArg)throw Error('Usage: router-experiment ANALYSIS_JSON OUTPUT_DIRECTORY [EXTERNAL_TRIAL_DIRECTORY]');
  const analysis=JSON.parse(await readFile(input,'utf8'));let external=[];
  if(externalRoot){const all=await analyzeTrajectories(externalRoot);external=all.runs.filter(r=>r.directory.endsWith('-r1-baseline')&&r.localTestsPassed===true);}
  const report=await runRouterExperiment(analysis,resolve(outArg),external);
  console.log(JSON.stringify({partitions:report.partitions,batch:{threshold:report.batch.calibration.threshold,qualified:report.batch.calibration.qualified,test:report.batch.test,external:report.batch.external},online:{threshold:report.online.calibration.threshold,test:report.online.test,external:report.online.external},deploymentEligible:report.deploymentEligible},null,2));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
