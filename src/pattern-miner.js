import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,posix} from 'node:path';
import {pathToFileURL} from 'node:url';

export const MINER_POLICY=Object.freeze({version:1,contextLines:40,maxHits:4,maxLines:240,readAheadLines:40,split:{discovery:[2,3,4],calibration:[1],heldout:[0]}});
const validPath=path=>typeof path==='string'&&path.length<=300&&!path.startsWith('-')&&!posix.isAbsolute(path)&&!path.split('/').includes('..')&&!/[\s*?{}\[\]$`<>\\]/.test(path);
const cleanPath=path=>path.replace(/^\.\//,'');

// Observation parser only. Nothing parsed here is executed, and unsupported shell
// syntax abstains rather than being approximated as a safe command.
export function shellSegments(command){
 if(typeof command!=='string'||command.length>20000||/[$`<>]/.test(command))return null;
 const result=[];let tokens=[],token='',started=false,quote=null,escaped=false;
 const push=()=>{if(started){tokens.push(token);token='';started=false;}};
 for(let i=0;i<command.length;i++){
  const c=command[i];
  if(escaped){token+=c;started=true;escaped=false;continue;}
  if(c==='\\'&&quote!=="'"){escaped=true;continue;}
  if(quote){if(c===quote)quote=null;else token+=c;started=true;continue;}
  if(c==='"'||c==="'"){quote=c;started=true;continue;}
  if(c==='&')return null;
  if(c===';'||c==='\n'||c==='|'){
   push();if(tokens.length)result.push({tokens,separator:c});else if(c==='|')return null;
   tokens=[];continue;
  }
  if(/\s/.test(c)){push();continue;}
  token+=c;started=true;
 }
 if(quote||escaped)return null;push();if(tokens.length)result.push({tokens,separator:null});
 return result.length?result:null;
}
function headLimit(tokens){
 if(tokens.length===1)return 10;
 if(tokens.length===2&&/^-\d+$/.test(tokens[1]))return Number(tokens[1].slice(1));
 if(tokens.length===3&&tokens[1]==='-n'&&/^\d+$/.test(tokens[2]))return Number(tokens[2]);
 return null;
}
export function parseReadCommand(command){
 const segments=shellSegments(command);if(!segments)return null;
 const reads=[];
 for(let i=0;i<segments.length;i++){
  const {tokens:t,separator}=segments[i];
  if(separator==='|'||(i&&segments[i-1].separator==='|'))return null;
  if(t[0]==='sed'&&t.length===4&&t[1]==='-n'&&/^\d+(?:,\d+)?p$/.test(t[2])&&validPath(t[3])){
   const [start,end=start]=t[2].slice(0,-1).split(',').map(Number);if(start<1||end<start||end>1e7)return null;
   reads.push({file:cleanPath(t[3]),start,end});
  }else if(t[0]==='head'&&validPath(t.at(-1))){
   const lines=headLimit(t.slice(0,-1));if(lines===null||lines<1||lines>1e7)return null;
   reads.push({file:cleanPath(t.at(-1)),start:1,end:lines});
  }else if(t[0]==='cat'&&t.length===2&&validPath(t[1]))reads.push({file:cleanPath(t[1]),start:1,end:null});
  else return null;
 }
 return reads.length?reads:null;
}
export function parseSearchCommand(command){
 const segments=shellSegments(command);if(!segments)return null;
 const searches=[];
 for(let i=0;i<segments.length;i++){
  const {tokens:t,separator}=segments[i];
  if(i&&segments[i-1].separator==='|'){
   if(t[0]!=='head'||headLimit(t)===null||separator==='|')return null;continue;
  }
  if(!['grep','rg'].includes(t[0]))return null;
  const rest=t.slice(1),positionals=[];let pattern=null,ended=false;
  for(let j=0;j<rest.length;j++){
   const a=rest[j];
   if(!ended&&a==='--'){ended=true;continue;}
   if(!ended&&a.startsWith('-')){
    if(['-e','--regexp'].includes(a)){if(!rest[j+1])return null;pattern=rest[++j];continue;}
    if(['-A','-B','-C','--after-context','--before-context','--context','-m','--max-count'].includes(a)){if(!/^\d+$/.test(rest[++j]||''))return null;continue;}
    if(!/^-(?:[nriIEFHhwlvs]+|[ABCm]\d+)$/.test(a)&&!['--line-number','--no-heading','--with-filename','--fixed-strings','--ignore-case'].includes(a))return null;
    continue;
   }
   positionals.push(a);
  }
  if(pattern===null)pattern=positionals.shift();
  if(typeof pattern!=='string'||!positionals.length)return null;
  // Wildcards/directories may search multiple files; only explicit, unambiguous
  // file operands can supply filenames omitted from grep's output.
  const paths=positionals.filter(validPath).map(cleanPath);
  searches.push({tool:t[0],paths,pattern,singleFile:positionals.length===1&&paths.length===1&&/\.[A-Za-z0-9]+$/.test(paths[0])?paths[0]:null});
 }
 return searches.length?searches:null;
}
export function searchHits(command,result){
 const searches=parseSearchCommand(command);
 if(!searches||typeof result!=='string'||!/^Exit code: 0; timed out: false\n/.test(result))return [];
 const singles=[...new Set(searches.map(s=>s.singleFile))];
 const inferred=singles.length===1?singles[0]:null,hits=[];
 for(const line of result.split('\n').slice(1)){
  let match=line.match(/^([^:\n]+):(\d+):/),file,number;
  if(match){file=match[1];number=Number(match[2]);}
  else if(inferred&&(match=line.match(/^(\d+):/))){file=inferred;number=Number(match[1]);}
  else continue; // grep context lines marked '-' are not matches.
  if(!validPath(file)||number<1||number>1e7)continue;
  file=cleanPath(file);if(!hits.some(h=>h.file===file&&h.line===number))hits.push({file,line:number});
 }
 return hits;
}
function boundedWindows(ranges,maxLines){
 const merged=[];
 for(const range of ranges){
  const overlap=merged.find(r=>r.file===range.file&&r.start<=range.end+1&&range.start<=r.end+1);
  if(overlap){overlap.start=Math.min(overlap.start,range.start);overlap.end=Math.max(overlap.end,range.end);}
  else merged.push({...range});
 }
 let remaining=maxLines;const output=[];
 for(const range of merged){if(remaining<=0)break;const end=Math.min(range.end,range.start+remaining-1);output.push({...range,end});remaining-=end-range.start+1;}
 return output;
}
export function proposeSearchContext(previous,policy=MINER_POLICY){
 if(!previous?.valid||previous.actions?.length!==1)return null;
 const a=previous.actions[0];if(!['local_bash','container_bash'].includes(a.name))return null;
 const hits=searchHits(a.command,a.result).slice(0,policy.maxHits);
 if(!hits.length)return null;
 return {program:'search_context_v1',ranges:boundedWindows(hits.map(h=>({file:h.file,start:Math.max(1,h.line-policy.contextLines),end:h.line+policy.contextLines})),policy.maxLines),sourceTraceId:previous.id};
}
export function proposeReadAhead(previous,policy=MINER_POLICY){
 if(!previous?.valid||previous.actions?.length!==1)return null;
 const a=previous.actions[0];if(!['local_bash','container_bash'].includes(a.name))return null;
 const reads=parseReadCommand(a.command);if(!reads||reads.some(r=>r.end===null))return null;
 return {program:'read_ahead_v1',ranges:boundedWindows(reads.map(r=>({file:r.file,start:Math.max(1,r.start-policy.readAheadLines),end:r.end+policy.readAheadLines})),policy.maxLines),sourceTraceId:previous.id};
}
export function coversReads(proposal,reads){
 return !!proposal&&!!reads&&reads.length>0&&reads.every(read=>read.end!==null&&proposal.ranges.some(range=>range.file===read.file&&range.start<=read.start&&range.end>=read.end));
}
function summarize(events){
 const covered=events.filter(e=>e.wholeReadTurnCovered),targets=events.filter(e=>e.nextIsPureRead);
 return {opportunities:events.length,distinctIssues:new Set(events.map(e=>e.issue)).size,nextPureReadTurns:targets.length,nextPureReadIssues:new Set(targets.map(e=>e.issue)).size,wholeReadTurnsCovered:covered.length,wholeReadIssuesCovered:new Set(covered.map(e=>e.issue)).size,proposedLines:events.reduce((n,e)=>n+e.proposal.ranges.reduce((m,r)=>m+r.end-r.start+1,0),0)};
}
export function minePatterns(snapshot,assignments,policy=MINER_POLICY){
 if(snapshot.runs.some(r=>!Number.isInteger(assignments[r.instanceId])||assignments[r.instanceId]<0||assignments[r.instanceId]>4))throw Error('Snapshot requires frozen five-fold issue assignments');
 const role=issue=>Object.entries(policy.split).find(([,folds])=>folds.includes(assignments[issue]))?.[0];
 const events={search_context_v1:[],read_ahead_v1:[]};let baselineRuns=0,baselineCalls=0;
 for(const run of snapshot.runs){
  if(run.arm!=='baseline')continue;baselineRuns++;baselineCalls+=run.turns.length;
  for(let i=1;i<run.turns.length;i++){
   const previous=run.turns[i-1],target=run.turns[i];if(!previous.valid||!target.valid)continue;
   // Proposals are complete before the target response is consulted.
   const proposals=[proposeSearchContext(previous,policy),proposeReadAhead(previous,policy)];
   const reads=target.actions.length===1&&['local_bash','container_bash'].includes(target.actions[0].name)?parseReadCommand(target.actions[0].command):null;
   for(const proposal of proposals.filter(Boolean))events[proposal.program].push({issue:run.instanceId,model:run.model,partition:role(run.instanceId),run:run.directory,sourceTraceId:previous.id,targetTraceId:target.id,proposal,nextIsPureRead:!!reads,targetReads:reads,wholeReadTurnCovered:coversReads(proposal,reads)});
  }
 }
 const candidates=Object.entries(events).map(([id,rows])=>({id,partitions:Object.fromEntries(Object.keys(policy.split).map(partition=>[partition,summarize(rows.filter(r=>r.partition===partition))])),byModel:Object.fromEntries([...new Set(rows.map(r=>r.model))].map(model=>[model,summarize(rows.filter(r=>r.model===model))])),events:rows}));
 return {version:1,createdAt:snapshot.createdAt,kind:'source-only-context-program-mining',policy,assignments,baselineRuns,baselineCalls,candidates,realizedQueriesSaved:null,
 limitations:['Previously inspected historical traces; split is algorithm-held-out, not pristine discovery.','Only baseline runs; every repetition/provider of an issue shares its partition.','Read-range coverage is syntactic evidence, not proof the whole answer/model call can be replaced.','Target action is a label only; proposals use the preceding completed tool action/result.','Source lines are not read from final patched checkouts; historical content fidelity is unverified.','Fixed window/selection/budget policy is frozen before heldout evaluation; no heldout tuning.','Search parsing deliberately abstains on mixed commands, ambiguous bare filenames, unknown options, and unsupported shell syntax.','Extra context can add tokens or distract the model; live paired evaluation remains necessary.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [snapshotFile,foldReport,outArg]=process.argv.slice(2);if(!snapshotFile||!foldReport||!outArg)throw Error('Usage: pattern-miner SNAPSHOT_JSON FOLD_REPORT_JSON NEW_OUTPUT');
  const snapshot=JSON.parse(await readFile(snapshotFile,'utf8')),frozen=JSON.parse(await readFile(foldReport,'utf8'));
  const out=resolve(outArg);await mkdir(resolve(out,'..'),{recursive:true});await mkdir(out,{recursive:false,mode:0o700});
  // Write frozen policy before inspecting target-label results.
  await writeFile(join(out,'protocol.json'),JSON.stringify({policy:MINER_POLICY,assignments:frozen.assignments,snapshot:snapshotFile,foldReport},null,2),{mode:0o600});
  const report=minePatterns(snapshot,frozen.assignments);
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({baselineRuns:report.baselineRuns,baselineCalls:report.baselineCalls,candidates:report.candidates.map(({id,partitions,byModel})=>({id,partitions,byModel}))},null,2));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
