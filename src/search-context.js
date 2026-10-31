import {constants} from 'node:fs';
import {open,realpath,lstat,opendir} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep,join} from 'node:path';
import {expandMatchRanges,createTextMatcher as matcher,portablePath,integer,insist} from './context-core.js';
export {expandMatchRanges} from './context-core.js';

const DEFAULTS=Object.freeze({maxFiles:64,maxEntries:4096,maxFileBytes:128*1024,maxTotalBytes:1024*1024,maxMatches:40,maxRanges:40,maxLines:400,maxOutputBytes:32*1024});
const CAPS=Object.freeze({maxFiles:128,maxEntries:8192,maxFileBytes:512*1024,maxTotalBytes:4*1024*1024,maxMatches:100,maxRanges:100,maxLines:1000,maxOutputBytes:64*1024});
const OMIT=new Set(['node_modules','__pycache__']);
function bounds(options={}){
 const out={...DEFAULTS};
 insist(options&&typeof options==='object'&&!Array.isArray(options),'invalid_limits');
 for(const [key,value] of Object.entries(options)){
  insist(Object.hasOwn(CAPS,key)&&integer(value,key==='maxOutputBytes'?2048:1,CAPS[key]),'invalid_limits');out[key]=value;
 }
 return out;
}

function contained(root,path){const rel=relative(root,path);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);}
async function checkedPath(root,path){
 const normalized=portablePath(path),absolute=resolve(root,normalized);insist(contained(root,absolute),'path_escape');
 let cursor=root;
 for(const part of normalized==='.'?[]:normalized.split('/')){
  cursor=join(cursor,part);insist(!(await lstat(cursor)).isSymbolicLink(),'symlink_path');
 }
 const actual=await realpath(absolute);insist(contained(root,actual),'path_escape');
 return {absolute,stat:await lstat(absolute)};
}
async function readBounded(root,path,maxBytes){
 const {absolute,stat}=await checkedPath(root,path);
 insist(stat.isFile(),'not_regular_file');
 if(stat.size>maxBytes)return {skip:'file_bytes'};
 const handle=await open(absolute,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const current=await handle.stat();
  insist(current.isFile()&&current.dev===stat.dev&&current.ino===stat.ino,'file_changed');
  insist(contained(root,await realpath(absolute)),'path_escape');
  const buffer=Buffer.alloc(maxBytes+1);let length=0;
  while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
  if(length>maxBytes)return {skip:'file_bytes'};
  const bytes=buffer.subarray(0,length);if(bytes.includes(0))return {skip:'binary'};
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return {skip:'binary'};}
  const lines=text.split(/\r?\n/);if(lines.at(-1)==='')lines.pop();
  return {bytes:length,lines};
 }finally{await handle.close();}
}

/** Deterministic, read-only tool. Results are proposals/data; never proxy activation. */
export async function searchContext({root,query,paths=['.'],mode='literal',caseSensitive=true,before=20,after=20,limits={}}={}){
 try{
  insist(typeof root==='string'&&isAbsolute(root),'invalid_root');
  const canonical=await realpath(root);insist((await lstat(canonical)).isDirectory(),'invalid_root');
  const cap=bounds(limits),matchesLine=matcher(query,mode,caseSensitive);
  insist(integer(before,0,100)&&integer(after,0,100),'invalid_context_size');
  insist(Array.isArray(paths)&&paths.length>0&&paths.length<=16,'invalid_paths');
  const queue=[...new Set(paths.map(portablePath))].sort(),files=[],seen=new Set(),reasons=new Set(),skipped={};let entries=0;
  const skip=kind=>{skipped[kind]=(skipped[kind]||0)+1;};
  while(queue.length){
   const path=queue.shift();if(seen.has(path))continue;seen.add(path);
   if(++entries>cap.maxEntries){reasons.add('entry_limit');break;}
   const {absolute,stat}=await checkedPath(canonical,path);
   if(stat.isDirectory()){
    const children=[];const dir=await opendir(absolute);
    try{
     for await(const entry of dir){
      if(entry.name.startsWith('.')||OMIT.has(entry.name))continue;
      if(++entries>cap.maxEntries){reasons.add('entry_limit');break;}
      if(entry.isSymbolicLink()){skip('symlink');continue;}
      if(!entry.isDirectory()&&!entry.isFile()){skip('special_file');continue;}
      children.push(path==='.'?entry.name:path+'/'+entry.name);
     }
    }finally{if(!dir.closed)await dir.close().catch(e=>{if(e.code!=='ERR_DIR_CLOSED')throw e;});}
    // If the directory exceeds its enumeration budget, abstain from claiming a
    // complete search. The bounded subset is still clearly marked truncated.
    queue.push(...children.sort());
    if(reasons.has('entry_limit'))break;
   }else if(stat.isFile()){
    if(files.length>=cap.maxFiles){reasons.add('file_limit');break;}files.push(path);
   }else skip('special_file');
  }
  const content=new Map(),matches=[];let bytesRead=0,filesRead=0;
  for(const path of files){
   const remaining=cap.maxTotalBytes-bytesRead;if(remaining<=0){reasons.add('total_bytes');break;}
   const value=await readBounded(canonical,path,Math.min(cap.maxFileBytes,remaining));
   if(value.skip){skip(value.skip);if(value.skip==='file_bytes')reasons.add(remaining<cap.maxFileBytes?'total_bytes':'file_bytes');continue;}
   bytesRead+=value.bytes;filesRead++;content.set(path,value.lines);
   for(let index=0;index<value.lines.length;index++){
    if(!matchesLine(value.lines[index]))continue;
    if(matches.length>=cap.maxMatches){reasons.add('match_limit');break;}
    matches.push({path,line:index+1});
   }
   if(reasons.has('match_limit'))break;
  }
  const expanded=expandMatchRanges(matches,{before,after,maxRanges:cap.maxRanges,maxLines:cap.maxLines,maxFiles:cap.maxFiles});
  for(const reason of expanded.reasons)reasons.add(reason);
  const ranges=expanded.ranges.flatMap(range=>{
   const source=content.get(range.path),end=Math.min(range.end,source.length);
   return end<range.start?[]:[{...range,end,lines:source.slice(range.start-1,end).map((text,i)=>({number:range.start+i,text}))}];
  });
  const result={status:'ok',mode,matches,ranges,truncated:reasons.size>0,reasons:[...reasons],filesRead,bytesRead,skipped};
  // Bound serialized output, including filenames and metadata, not just source text.
  while(Buffer.byteLength(JSON.stringify(result))>cap.maxOutputBytes){
   result.truncated=true;if(!result.reasons.includes('output_bytes'))result.reasons.push('output_bytes');
   if(result.ranges.length){const last=result.ranges.at(-1);last.lines.pop();last.end--;if(!last.lines.length)result.ranges.pop();}
   else if(result.matches.length)result.matches.pop();else break;
  }
  return result;
 }catch(error){return {status:'abstained',reason:error.code==='ENOENT'?'missing_path':error.code==='ELOOP'?'symlink_path':/^[a-z_]+$/.test(error.message)?error.message:'filesystem_error',matches:[],ranges:[],truncated:false,reasons:[]};}
}

/** Read only explicit proposed ranges; never expand them using future actions. */
export async function readSourceRanges({root,ranges,limits={}}={}){
 try{
  insist(typeof root==='string'&&isAbsolute(root),'invalid_root');const canonical=await realpath(root);
  const cap=bounds(limits);insist(Array.isArray(ranges)&&ranges.length>0&&ranges.length<=cap.maxRanges,'invalid_ranges');
  const validated=ranges.map(r=>{const path=portablePath(r.path);insist(path!=='.'&&integer(r.start,1,10_000_000)&&integer(r.end,r.start,10_000_000),'invalid_ranges');return {path,start:r.start,end:r.end};});
  insist(new Set(validated.map(r=>r.path)).size<=cap.maxFiles&&validated.reduce((n,r)=>n+r.end-r.start+1,0)<=cap.maxLines,'range_budget');
  const files=new Map();let bytesRead=0;
  for(const path of new Set(validated.map(r=>r.path))){
   const remaining=cap.maxTotalBytes-bytesRead;insist(remaining>0,'total_bytes');
   const value=await readBounded(canonical,path,Math.min(cap.maxFileBytes,remaining));insist(!value.skip,value.skip||'unsupported_file');bytesRead+=value.bytes;files.set(path,value.lines);
  }
  const output=validated.flatMap(r=>{const source=files.get(r.path),end=Math.min(source.length,r.end);return end<r.start?[]:[{...r,end,lines:source.slice(r.start-1,end).map((text,i)=>({number:r.start+i,text}))}];});
  const result={status:'ok',ranges:output,truncated:false,reasons:[],filesRead:files.size,bytesRead};
  while(Buffer.byteLength(JSON.stringify(result))>cap.maxOutputBytes&&result.ranges.length){
   result.truncated=true;result.reasons=['output_bytes'];const last=result.ranges.at(-1);last.lines.pop();last.end--;if(!last.lines.length)result.ranges.pop();
  }
  return result;
 }catch(error){return {status:'abstained',reason:error.code==='ENOENT'?'missing_path':error.code==='ELOOP'?'symlink_path':/^[a-z_]+$/.test(error.message)?error.message:'filesystem_error',ranges:[],truncated:false,reasons:[]};}
}
