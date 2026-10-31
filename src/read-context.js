import {realpath,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,sep,posix} from 'node:path';
import {parseReadCommand,coversReads} from './pattern-miner.js';

export const READ_CONTEXT_POLICY=Object.freeze({before:40,after:40,maxLines:200,maxFileBytes:1024*1024,maxOutputBytes:24000});
function validRange(range){return range&&typeof range.file==='string'&&range.file.length<=300&&!posix.isAbsolute(range.file)&&!range.file.split('/').some(p=>['..','.git','.autotoken.env','id_rsa','id_ed25519'].includes(p))&&!/[\s*?{}\[\]$`<>\\]/.test(range.file)&&!/(?:^|\/)\.env(?:\.|$)|\.(?:pem|key)$/.test(range.file)&&Number.isSafeInteger(range.start)&&Number.isSafeInteger(range.end)&&range.start>=1&&range.end>=range.start&&range.end<=1e7;}
function merge(ranges){
 const ordered=ranges.map(r=>({...r,file:r.file.replace(/^\.\//,'')})).sort((a,b)=>a.file.localeCompare(b.file)||a.start-b.start);
 const out=[];for(const r of ordered){const previous=out.at(-1);if(previous?.file===r.file&&r.start<=previous.end+1)previous.end=Math.max(previous.end,r.end);else out.push(r);}return out;
}
const count=ranges=>ranges.reduce((n,r)=>n+r.end-r.start+1,0);
export function planReadContext(requested,policy=READ_CONTEXT_POLICY){
 if(!Array.isArray(requested)||!requested.length||requested.length>8||requested.some(r=>!validRange(r)))return null;
 if(policy.before!==40||policy.after!==40||policy.maxLines!==200)throw Error('Read-context v1 uses its frozen 40/40/200 policy');
 const originals=merge(requested),ranges=merge(originals.map(r=>({...r,start:Math.max(1,r.start-policy.before),end:r.end+policy.after})));
 if(count(ranges)>policy.maxLines)return null;
 return {program:'read_context_v1',requested:originals,ranges,requestedLines:count(originals),proposedLines:count(ranges),extraLines:count(ranges)-count(originals)};
}
export function readContextFromTurn(turn){
 if(!turn?.valid||turn.actions?.length!==1||!['local_bash','container_bash'].includes(turn.actions[0].name))return null;
 const requested=parseReadCommand(turn.actions[0].command);return requested?planReadContext(requested):null;
}
export async function runReadContext(repo,requested){
 const plan=planReadContext(requested);if(!plan)return {status:'abstain',reason:'Unsupported range or context budget exceeded'};
 const root=await realpath(repo),contents=new Map();
 for(const file of new Set(plan.ranges.map(r=>r.file))){
  const resolved=await realpath(resolve(root,file)).catch(()=>null);
  if(!resolved||!resolved.startsWith(root+sep))return {status:'abstain',reason:'File is unavailable or outside repository'};
  let handle;
  try{
   handle=await open(resolved,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await handle.stat();
   if(!stat.isFile()||stat.size>READ_CONTEXT_POLICY.maxFileBytes)return {status:'abstain',reason:'File exceeds bounded source contract'};
   const data=await handle.readFile();if(data.includes(0))return {status:'abstain',reason:'Binary file unsupported'};
   contents.set(file,data.toString('utf8').split('\n'));
  }finally{await handle?.close();}
 }
 const snippets=plan.ranges.map(r=>({file:r.file,start:r.start,end:Math.min(r.end,contents.get(r.file).length),lines:contents.get(r.file).slice(r.start-1,r.end)}));
 const text=snippets.map(s=>`${s.file}:${s.start}-${s.end}\n`+s.lines.map((line,i)=>`${s.start+i}: ${line}`).join('\n')).join('\n\n');
 if(Buffer.byteLength(text)>READ_CONTEXT_POLICY.maxOutputBytes)return {status:'abstain',reason:'Output exceeds byte budget'};
 return {status:'ok',...plan,snippets,text,returnedLines:snippets.reduce((n,s)=>n+s.lines.length,0),bytes:Buffer.byteLength(text)};
}
export function evaluateReadContext(snapshot,assignments){
 const roles={discovery:[2,3,4],calibration:[1],heldout:[0]},events=[];
 for(const run of snapshot.runs){
  if(run.arm!=='baseline')continue;
  const partition=Object.entries(roles).find(([,folds])=>folds.includes(assignments[run.instanceId]))?.[0];if(!partition)throw Error('Missing frozen issue partition');
  for(let i=1;i<run.turns.length;i++){
   const previous=run.turns[i-1],target=run.turns[i];if(!target.valid)continue;
   const proposal=readContextFromTurn(previous);if(!proposal)continue;
   const targetReads=target.actions.length===1&&['local_bash','container_bash'].includes(target.actions[0].name)?parseReadCommand(target.actions[0].command):null;
   events.push({issue:run.instanceId,partition,model:run.model,sourceTraceId:previous.id,targetTraceId:target.id,proposal,nextPureRead:!!targetReads,covered:coversReads(proposal,targetReads),targetReads});
  }
 }
 return {version:1,policy:READ_CONTEXT_POLICY,partitions:Object.fromEntries(Object.keys(roles).map(role=>{const rows=events.filter(e=>e.partition===role);return [role,{opportunities:rows.length,issues:new Set(rows.map(r=>r.issue)).size,nextPureReadTurns:rows.filter(r=>r.nextPureRead).length,wholeReadTurnsCovered:rows.filter(r=>r.covered).length,proposedLines:rows.reduce((n,r)=>n+r.proposal.proposedLines,0),extraLines:rows.reduce((n,r)=>n+r.proposal.extraLines,0)}];})),events,realizedQueriesSaved:null,limitations:['Fixed ±40 line expansion capped at 200 lines; oversized reads abstain.','Program preserves all originally requested ranges, and never uses the next action to choose ranges.','Ranges are compared offline; source content at historical execution time is not reconstructed.','Coverage does not prove that an answer-model call can be skipped.','Earlier corpus inspection means the issue holdout is algorithmic rather than pristine.']};
}
