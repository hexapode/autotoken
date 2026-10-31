import {proposeFromTurn,REPLAY_LIMITS} from './search-context-replay.js';
import {readSourceRanges} from './search-context.js';

// Opt-in tool-result enrichment. No extra instructions or changes to tool schema.
export async function searchContextAfterAction({root,command,result}){
 if(result?.code!==0||result.timedOut||typeof result.output!=='string'||/\[output truncated\]/i.test(result.output))return {triggered:false,reason:'Unsuccessful or truncated action',bytes:0,appendedText:''};
 try{
  const proposal=proposeFromTurn({valid:true,actions:[{name:'local_bash',command,result:`Exit code: 0; timed out: false\n${result.output}`}]});
  if(!proposal.supported)return {triggered:false,reason:proposal.reason,bytes:0,appendedText:''};
  const context=await readSourceRanges({root,ranges:proposal.ranges,limits:{maxFiles:REPLAY_LIMITS.maxFiles,maxRanges:REPLAY_LIMITS.maxRanges,maxLines:REPLAY_LIMITS.maxLines,maxOutputBytes:16000}});
  if(context.status!=='ok'||!context.ranges.length)return {triggered:false,reason:context.reason||'No source context',bytes:0,appendedText:''};
  const appendedText='\n\n[Source context]\n'+context.ranges.map(r=>`${r.path}:${r.start}-${r.end}\n${r.lines.map(line=>`${line.number}: ${line.text}`).join('\n')}`).join('\n\n')+(context.truncated?'\n[Source context truncated]':'');
  return {triggered:true,bytes:Buffer.byteLength(appendedText),appendedText,ranges:context.ranges.map(({path,start,end})=>({path,start,end})),truncated:proposal.truncated||context.truncated,matchCount:proposal.matchCount};
 }catch{return {triggered:false,reason:'Context proposal unavailable',bytes:0,appendedText:''};}
}
