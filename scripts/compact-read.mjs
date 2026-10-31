import {lstat,open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {shellSegments} from '../src/pattern-miner.js';
export const LIMITS=Object.freeze({maxRanges:16,maxFileBytes:131072,maxTotalFileBytes:524288,maxLines:600,maxOutputBytes:32000});
const safe=p=>typeof p==='string'&&p.length>0&&p.length<=300&&!isAbsolute(p)&&!p.startsWith('-')&&!p.split('/').some(x=>!x||x==='..'||x.startsWith('.'))&&!/[\s*?{}\[\]$`<>\\]/.test(p);
const count=t=>t.length===1?10:t.length===2&&/^-\d+$/.test(t[1])?Number(t[1].slice(1)):t.length===3&&t[1]==='-n'&&/^\d+$/.test(t[2])?Number(t[2]):null;
const sed=t=>t.length===3&&t[0]==='sed'&&t[1]==='-n'&&/^\d+(?:,\d+)?p$/.test(t[2])?t[2].slice(0,-1).split(',').map(Number):null;
// Only whole, explicit read turns. Parsing never executes the original shell.
export function parseCompactReads(command){
 const parts=shellSegments(command);if(!parts)return null;
 const ranges=[];
 for(let i=0;i<parts.length;i++){
  const {tokens:t,separator}=parts[i];let path,start=1,end=null;
  if(separator==='|'){
   const next=parts[++i];if(!next||next.separator==='|')return null;
   if(t[0]==='cat'&&t.length===2&&next.tokens[0]==='head'){
    path=t[1];end=count(next.tokens);if(end===null)return null;
   }else if(t[0]==='nl'&&t.length===3&&t[1]==='-ba'){
    const range=sed(next.tokens);if(!range)return null;
    path=t[2];[start,end=range[0]]=range;
   }else return null;
  }else if(t[0]==='sed'&&t.length===4){
   const range=sed(t.slice(0,3));if(!range)return null;
   path=t[3];[start,end=range[0]]=range;
  }else if(t[0]==='head'&&t.length>=2){path=t.at(-1);end=count(t.slice(0,-1));if(end===null)return null;}
  else if(t[0]==='cat'&&t.length===2)path=t[1];
  else return null;
  path=path?.replace(/^\.\//,'');
  if(!safe(path)||!Number.isInteger(start)||start<1||(end!==null&&(!Number.isInteger(end)||end<start||end>1e7)))return null;
  ranges.push([path,start,end]);
 }
 return ranges.length&&ranges.length<=LIMITS.maxRanges?ranges:null;
}
export function compactArguments(ranges){return {r:ranges.map(([path,start,end],i)=>[i&&path===ranges[i-1][0]?null:path,start,end])};}
// Trusted, quiescent repositories only. Component checks are not an OS sandbox
// and do not prevent adversarial concurrent directory replacement.
export async function readMany(root,args){
 const ranges=args?.r;if(!Array.isArray(ranges)||!ranges.length||ranges.length>LIMITS.maxRanges)throw Error('Invalid range count');
 const requests=[];let previous;
 for(const tuple of ranges){
  if(!Array.isArray(tuple)||tuple.length!==3)throw Error('Expected [path,start,end] tuples');
  const [supplied,start,end]=tuple,path=supplied===null?previous:supplied;
  if(!safe(path)||!Number.isInteger(start)||start<1||start>1e7||(end!==null&&(!Number.isInteger(end)||end<start||end>1e7)))throw Error('Invalid range');
  requests.push({path,start,end});previous=path;
 }
 root=await realpath(root);const cache=new Map();let loaded=0,linesEmitted=0,bytesEmitted=0;const results=[];
 for(const request of requests){
  const {path,start,end}=request;
  if(!cache.has(path)){
   let current=root;
   for(const part of path.split('/')){current=resolve(current,part);if((await lstat(current)).isSymbolicLink())throw Error('Symlinks unsupported');}
   const actual=await realpath(current),rel=relative(root,actual);
   if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Path escaped root');
   const handle=await open(actual,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   try{
    const info=await handle.stat();if(!info.isFile()||info.size>LIMITS.maxFileBytes||loaded+info.size>LIMITS.maxTotalFileBytes)throw Error('File budget exceeded');
    // Fixed-size buffer prevents a concurrently growing file exceeding the cap.
    const buffer=Buffer.alloc(info.size+1);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
    if(bytesRead>info.size)throw Error('File changed during read');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,bytesRead));if(text.includes('\0'))throw Error('Binary file unsupported');
    const lines=text.split('\n');if(lines.at(-1)==='')lines.pop();cache.set(path,lines);loaded+=bytesRead;
   }finally{await handle.close();}
  }
  const source=cache.get(path),last=Math.min(end??source.length,source.length);const rows=[];let truncated=false;
  for(let line=start;line<=last;line++){
   const text=source[line-1],rendered=`${path}:${line}:${text}\n`,bytes=Buffer.byteLength(rendered);
   if(linesEmitted>=LIMITS.maxLines||bytesEmitted+bytes>LIMITS.maxOutputBytes){truncated=true;break;}
   rows.push({line,text});linesEmitted++;bytesEmitted+=bytes;
  }
  results.push({...request,rows,truncated});
 }
 const response={results,linesEmitted,bytesEmitted,truncated:results.some(r=>r.truncated)};
 // Account for escaped JSON and metadata, not just rendered source characters.
 while(Buffer.byteLength(JSON.stringify(response))>LIMITS.maxOutputBytes){
  const result=[...results].reverse().find(r=>r.rows.length);
  if(!result)throw Error('Response metadata exceeds budget');
  const row=result.rows.pop();result.truncated=true;response.truncated=true;
  response.linesEmitted--;response.bytesEmitted-=Buffer.byteLength(`${result.path}:${row.line}:${row.text}\n`);
 }
 return response;
}
