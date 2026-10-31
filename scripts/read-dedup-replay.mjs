import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseReadCommand,parseSearchCommand,shellSegments} from '../src/pattern-miner.js';
import {unionReadRanges} from './read-dedup.mjs';
const snapshot=JSON.parse(await readFile('data/experiments/router-all-traces-v2/snapshot.json','utf8'));
const assignments=JSON.parse(await readFile('data/experiments/router-all-traces-v2/report.json','utf8')).assignments;
// Classify only an explicit grammar, not heuristic trace tags. This does not
// establish absence of external mutation, symlink changes or aliases.
function classify(command){
 const reads=parseReadCommand(command);if(reads)return {supported:true,ranges:reads.filter(r=>r.end!==null).map(({file,...r})=>({path:file,...r})),allBounded:reads.every(r=>r.end!==null),pureRead:true};
 if(parseSearchCommand(command))return {supported:true,ranges:[],allBounded:false,pureRead:false};
 const segments=shellSegments(command);if(!segments||segments.some(s=>s.separator==='|'||s.tokens.some(t=>t.includes("'"))))return {supported:false};
 const ranges=[];let pureRead=true;
 for(const segment of segments){
  const c=segment.tokens.map(t=>`'${t}'`).join(' '),r=parseReadCommand(c);
  if(r){ranges.push(...r.filter(x=>x.end!==null).map(({file,...x})=>({path:file,...x})));continue;}
  if(parseSearchCommand(c)){pureRead=false;continue;}
  return {supported:false};
 }
 return {supported:true,ranges,allBounded:false,pureRead};
}
const rows=[];let totalTurns=0,supportedTurns=0,pureBoundedTurns=0;const unionEvents=[],crossEvents=[],identicalOutputEvents=[];
for(const run of snapshot.runs){
 if(run.arm!=='baseline'||![2,3,4].includes(assignments[run.instanceId]))continue;
 let prior=[],priorOutput=new Map();
 for(const turn of run.turns){
  totalTurns++;
  const parts=turn.valid&&turn.actions.length?turn.actions.map(a=>['local_bash','container_bash'].includes(a.name)?classify(a.command):{supported:false}):[];
  if(!parts.length||parts.some(p=>!p.supported)){prior=[];priorOutput.clear();continue;}
  if(parts.every(p=>p.pureRead)&&turn.actions.every(a=>typeof a.result==='string'&&a.result.startsWith('Exit code: 0; timed out: false\n')&&!/output truncated/i.test(a.result))){
   const payload=turn.actions.map(a=>a.result.slice(a.result.indexOf('\n')+1)).join('\n');
   if(payload.length>80){const hash=createHash('sha256').update(payload).digest('hex');if(priorOutput.has(hash))identicalOutputEvents.push({issue:run.instanceId,traceId:turn.id,previousTraceId:priorOutput.get(hash),identicalPayloadBytes:Buffer.byteLength(payload)});priorOutput.set(hash,turn.id);}
  }
  supportedTurns++;if(parts.every(p=>p.pureRead&&p.allBounded))pureBoundedTurns++;
  const ranges=parts.flatMap(p=>p.ranges),plan=unionReadRanges(ranges);
  if(plan.status!=='planned'){prior=[];continue;}
  const base={issue:run.instanceId,traceId:turn.id};
  if(plan.duplicateRequestedLines)unionEvents.push({...base,plan});
  const old=unionReadRanges(prior),combined=unionReadRanges([...prior,...ranges]);
  if(old.status==='planned'&&combined.status==='planned'){
   const overlaps=old.uniqueLines+plan.uniqueLines-combined.uniqueLines;
   if(overlaps>0)crossEvents.push({...base,overlappingRequestedLines:overlaps,priorRanges:prior,currentRanges:ranges});
  }
  rows.push({...base,plan});
  const accumulated=unionReadRanges([...prior,...ranges]);prior=accumulated.status==='planned'?accumulated.ranges:[];
 }
}
const summary={totalTurns,supportedReadonlyTurns:supportedTurns,pureBoundedReadTurns:pureBoundedTurns,withinTurnOverlapEvents:unionEvents.length,withinTurnDuplicateRequestedLines:unionEvents.reduce((n,e)=>n+e.plan.duplicateRequestedLines,0),crossTurnOverlapEvents:crossEvents.length,crossTurnOverlappingRequestedLines:crossEvents.reduce((n,e)=>n+e.overlappingRequestedLines,0),identicalFullReadOutputEvents:identicalOutputEvents.length,identicalFullReadOutputBytes:identicalOutputEvents.reduce((n,e)=>n+e.identicalPayloadBytes,0),certifiedHistoricalBytesSaved:0,demonstratedCallsSaved:0};
const report={scope:'baseline discovery folds2,3,4 only',summary,unionEvents,crossEvents,identicalOutputEvents,limitations:['Line counts are requested-range upperbounds, not reconstructed historical output bytes.','Within-turn union requires reading one immutable snapshot; historical sequential shell output may differ.','Cross-turn reuse requires matching current content fingerprints, prior provenance, and retained source text still available to the consumer; otherwise resend content. No historical fingerprints or context-retention service reconstructed.','Strict parser rejects mixed edits/tests, redirects, unsupported commands and pipelines except supported search pipelines.','No recorded commands executed, no heldout inspected, no paid calls.']};
await mkdir('data/analysis/read-dedup-v1',{recursive:true,mode:0o700});await writeFile('data/analysis/read-dedup-v1/report.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(summary,null,2));
