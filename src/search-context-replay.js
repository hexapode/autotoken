import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {expandMatchRanges} from './search-context.js';

export const REPLAY_LIMITS=Object.freeze({before:20,after:20,maxFiles:5,maxRanges:40,maxLines:200});
const digest=value=>createHash('sha256').update(value).digest('hex');
const safePath=value=>typeof value==='string'&&/^[A-Za-z0-9_./-]+$/.test(value)&&!value.startsWith('/')&&!value.split('/').includes('..')&&!value.startsWith('-');
const normalize=value=>value.replace(/^(?:\.\/)+/,'');

// Parse a small shell subset solely for offline evidence. Never execute it.
export function tokenizeShell(text){
 if(typeof text!=='string'||text.length>100000)return null;
 const tokens=[];let word='',active=false,quote=null;
 const push=()=>{if(active){tokens.push(word);word='';active=false;}};
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quote){
   if(ch===quote){quote=null;continue;}
   if(ch==='`'||(quote==='"'&&ch==='$'))return null;
   if(ch==='\\'&&quote==='"'&&['"','\\','$','`'].includes(text[i+1])){word+=text[++i];continue;}
   word+=ch;continue;
  }
  if(ch==='"'||ch==="'"){quote=ch;active=true;continue;}
  if(ch==='\\'){if(i+1===text.length)return null;word+=text[++i];active=true;continue;}
  if('$`<>&()'.includes(ch))return null;
  if(ch===';'||ch==='|'||ch==='\n'){push();tokens.push(ch==='\n'?';':ch);continue;}
  if(/\s/.test(ch)){push();continue;}
  word+=ch;active=true;
 }
 if(quote)return null;push();return tokens;
}
function groups(tokens,separator){
 const result=[[]];for(const token of tokens){if(token===separator)result.push([]);else result.at(-1).push(token);}return result.filter(g=>g.length);
}
function searchPaths(command){
 const tokens=tokenizeShell(command);if(!tokens)return {reason:'Unsupported shell syntax'};
 const all=[];
 for(const segment of groups(tokens,';')){
  const pipeline=groups(segment,'|');if(pipeline.length>2)return {reason:'Unsupported pipeline'};
  if(pipeline.length===2&&!/^head(?: -(?:n )?\d+)?$/.test(pipeline[1].join(' ')))return {reason:'Unsupported pipeline'};
  const words=pipeline[0];if(!['grep','rg'].includes(words[0]))return {reason:'Mixed or unsupported search command'};
  let pattern=false,afterOptions=false;const paths=[];
  for(let i=1;i<words.length;i++){
   const word=words[i];
   if(!afterOptions&&word==='--'){afterOptions=true;continue;}
   if(!afterOptions&&word.startsWith('-')){
    if(['-e','--regexp','-g','--glob','-A','-B','-C','--after-context','--before-context','--context','-m','--max-count'].includes(word)){
     if(!words[i+1])return {reason:'Missing search option argument'};
     if(['-e','--regexp'].includes(word))pattern=true;i++;continue;
    }
    if(/^-[nrRiIlHhFEswcv]+$/.test(word)||/^-[ABCm]\d+$/.test(word)||['--line-number','--no-heading','--with-filename','--fixed-strings','--ignore-case','--hidden'].includes(word))continue;
    return {reason:'Unsupported search option'};
   }
   if(!pattern){pattern=true;continue;}
   paths.push(word);
  }
  if(!pattern)return {reason:'Missing search pattern'};
  all.push(...paths);
 }
 return {paths:all};
}
export function parseSearchEvidence(action){
 if(!action||!['local_bash','container_bash'].includes(action.name))return {supported:false,reason:'Unsupported tool'};
 const parsed=searchPaths(action.command);if(parsed.reason)return {supported:false,reason:parsed.reason};
 if(typeof action.result!=='string'||!action.result.startsWith('Exit code: 0; timed out: false\n'))return {supported:false,reason:'Search did not complete successfully'};
 if(/\[output truncated\]/i.test(action.result))return {supported:false,reason:'Truncated search result'};
 const unique=[...new Set(parsed.paths.filter(p=>safePath(p)&&!p.endsWith('/')).map(normalize))];
 // Bare line numbers have a path only when the entire command had one explicit,
 // ordinary file target. Never infer that path from the following read command.
 const inferred=unique.length===1&&parsed.paths.length===1&&/\.[A-Za-z0-9_]+$/.test(unique[0])?unique[0]:null;
 const matches=[],visible=[];let ambiguous=0;
 for(const line of action.result.split('\n').slice(1)){
  let m=line.match(/^([A-Za-z0-9_./-]+):(\d+):(.*)$/),path,number,isMatch;
  if(m){path=m[1];number=Number(m[2]);isMatch=true;}
  else if((m=line.match(/^([A-Za-z0-9_./-]+)-(\d+)-(.*)$/))){path=m[1];number=Number(m[2]);isMatch=false;}
  else if((m=line.match(/^(\d+)([:-])(.*)$/))){if(!inferred){ambiguous++;continue;}path=inferred;number=Number(m[1]);isMatch=m[2]===':';}
  else continue;
  if(!safePath(path)||!Number.isSafeInteger(number)||number<1)continue;
  const point={path:normalize(path),line:number};visible.push(point);if(isMatch)matches.push(point);
 }
 if(ambiguous)return {supported:false,reason:'Ambiguous path for bare line numbers'};
 if(!matches.length)return {supported:false,reason:'No numbered search matches'};
 return {supported:true,matches,visible};
}
export function parseReadRanges(turn){
 if(!turn?.valid||!turn.actions?.length)return {supported:false,reason:'No valid next tool action'};
 const ranges=[];
 for(const action of turn.actions){
  if(!['local_bash','container_bash'].includes(action.name))return {supported:false,reason:'Unsupported next tool'};
  const tokens=tokenizeShell(action.command);if(!tokens||tokens.includes('|'))return {supported:false,reason:'Mixed or unsupported next action'};
  for(const words of groups(tokens,';')){
   let start,end,path;
   if(words[0]==='sed'&&words[1]==='-n'&&words.length===4){
    const m=words[2].match(/^(\d+)(?:,(\d+))?p$/);if(!m)return {supported:false,reason:'Unsupported sed address'};
    start=Number(m[1]);end=Number(m[2]||m[1]);path=words[3];
   }else if(words[0]==='head'&&words.length===2){start=1;end=10;path=words[1];}
   else if(words[0]==='head'&&words.length===4&&words[1]==='-n'&&/^\d+$/.test(words[2])){start=1;end=Number(words[2]);path=words[3];}
   else if(words[0]==='head'&&words.length===3&&/^-\d+$/.test(words[1])){start=1;end=Number(words[1].slice(1));path=words[2];}
   else return {supported:false,reason:'Next action is not a bounded pure file read'};
   if(!safePath(path)||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start||end-start>100000)return {supported:false,reason:'Invalid read range'};
   ranges.push({path:normalize(path),start,end});
  }
 }
 return ranges.length?{supported:true,ranges}:{supported:false,reason:'No read ranges'};
}
function coveredLength(request,proposed){
 const overlaps=proposed.filter(p=>p.path===request.path&&p.end>=request.start&&p.start<=request.end).map(p=>({start:Math.max(p.start,request.start),end:Math.min(p.end,request.end)})).sort((a,b)=>a.start-b.start);
 let covered=0,last=-1;for(const p of overlaps){covered+=Math.max(0,p.end-Math.max(last,p.start-1));last=Math.max(last,p.end);}return covered;
}
export function scoreRanges(requested,proposed){
 let requestedLines=0,coveredLines=0;
 for(const r of requested){requestedLines+=r.end-r.start+1;coveredLines+=coveredLength(r,proposed);}
 return {requestedLines,coveredLines,wholeNextTurnCovered:requestedLines>0&&coveredLines===requestedLines,partiallyCovered:coveredLines>0&&coveredLines<requestedLines};
}
export function proposeFromTurn(turn){
 if(!turn?.valid||!turn.actions?.length)return {supported:false,reason:'Invalid search turn'};
 const matches=[],visible=[];
 for(const action of turn.actions){const p=parseSearchEvidence(action);if(!p.supported)return p;matches.push(...p.matches);visible.push(...p.visible);}
 const expanded=expandMatchRanges(matches,REPLAY_LIMITS);
 const ranges=expanded.ranges;const proposedLines=ranges.reduce((sum,r)=>sum+r.end-r.start+1,0);
 const visibleKeys=new Set(visible.filter(v=>ranges.some(r=>r.path===v.path&&r.start<=v.line&&r.end>=v.line)).map(v=>`${v.path}:${v.line}`));
 return {supported:true,ranges,truncated:expanded.truncated,proposedLines,additionalLinesBeyondSearchEvidence:Math.max(0,proposedLines-visibleKeys.size),matchCount:matches.length};
}
function summarize(rows){
 const supported=rows.filter(r=>r.proposal.supported),reads=supported.filter(r=>r.label.supported);
 return {searchTaggedTurns:rows.length,supportedProposals:supported.length,unsupportedSearchTurns:rows.length-supported.length,
  supportedNextReadTurns:reads.length,wholeNextTurnsCovered:reads.filter(r=>r.score.wholeNextTurnCovered).length,partiallyCoveredTurns:reads.filter(r=>r.score.partiallyCovered).length,
  wholeCoverageIssues:new Set(reads.filter(r=>r.score.wholeNextTurnCovered).map(r=>r.issue)).size,
  cappedProposals:supported.filter(r=>r.proposal.truncated).length,proposedLines:supported.reduce((n,r)=>n+r.proposal.proposedLines,0),additionalLinesBeyondSearchEvidence:supported.reduce((n,r)=>n+r.proposal.additionalLinesBeyondSearchEvidence,0),
  unsupportedReasons:Object.fromEntries([...new Set(rows.filter(r=>!r.proposal.supported).map(r=>r.proposal.reason))].map(reason=>[reason,rows.filter(r=>r.proposal.reason===reason).length]))};
}
export function evaluateSearchReplay(snapshot,assignments){
 const rows=[];
 for(const run of snapshot.runs){
  if(!Object.hasOwn(assignments,run.instanceId))throw Error('Missing frozen issue assignment');
  for(let i=0;i<run.turns.length-1;i++){
   const turn=run.turns[i],next=run.turns[i+1];
   if(!turn.valid||!turn.tags?.includes('search'))continue;
   // Freeze proposal before reading the target action, which is used only as label.
   const proposal=proposeFromTurn(turn),label=parseReadRanges(next);
   const fold=assignments[run.instanceId];
   rows.push({issue:run.instanceId,arm:run.arm||'baseline',model:run.model,split:fold===0?'test':fold===1?'calibration':'discovery',searchTraceId:turn.id,nextTraceId:next.id,proposal,label,score:proposal.supported&&label.supported?scoreRanges(label.ranges,proposal.ranges):null});
  }
 }
 const primary={},treatments={};for(const split of ['discovery','calibration','test']){primary[split]=summarize(rows.filter(r=>r.split===split&&r.arm==='baseline'));treatments[split]=summarize(rows.filter(r=>r.split===split&&r.arm!=='baseline'));}
 return {version:1,kind:'frozen-search-context-range-replay',limits:REPLAY_LIMITS,primary,treatmentDiagnostic:treatments,rows,realizedQueriesSaved:null,contentCorrectnessValidated:false,
 limitations:['Fixed bounds were chosen before held-out replay; no held-out tuning.','Inputs use only the completed search action and its result; the next action supplies labels only.','Strict shell subset excludes mixed commands, ambiguous paths and unnumbered results.','Line-range coverage is not content equivalence, successful substitution, or realized savings.','Current working trees were not read because they may contain later edits.','Proposed line counts are bounds, not token costs; windows may extend beyond historical EOF.','Repeated issues remain grouped using the existing frozen assignments.','Prior project inspection of these traces means this is algorithm-held-out evaluation, not a pristine benchmark.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [snapshotArg='data/experiments/router-all-traces-v2/snapshot.json',assignmentArg='data/experiments/router-all-traces-v2/report.json',outArg='data/experiments/search-context-replay-v1']=process.argv.slice(2);
  const snapshotBytes=await readFile(snapshotArg),assignmentBytes=await readFile(assignmentArg);
  const report=evaluateSearchReplay(JSON.parse(snapshotBytes),JSON.parse(assignmentBytes).assignments);
  report.source={snapshot:resolve(snapshotArg),snapshotSha256:digest(snapshotBytes),assignments:resolve(assignmentArg),assignmentsSha256:digest(assignmentBytes)};
  const out=resolve(outArg);await mkdir(out,{recursive:true,mode:0o700});await writeFile(join(out,'report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({primary:report.primary,treatmentDiagnostic:report.treatmentDiagnostic},null,2));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
