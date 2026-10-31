import {open,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join,sep} from 'node:path';

export const READ_RANGE_POLICY=Object.freeze({maxRequestedLines:250,defaultLines:200,maxFileBytes:1024*1024,maxOutputBytes:32*1024,maxRetries:1});
const allowedKeys=new Set(['command','path','view_range']);
function validPath(path){return typeof path==='string'&&path.startsWith('/workspace/')&&path.length<=4096&&!/[\x00\r\n\\]/.test(path)&&path.slice(11).split('/').every(p=>p&&p!=='.'&&p!=='..');}
function validArgs(args){return args&&typeof args==='object'&&!Array.isArray(args)&&args.command==='view'&&validPath(args.path)&&Object.keys(args).every(k=>allowedKeys.has(k));}
function failure(code,text,extra={}){return {text,metadata:{status:'error',code,...extra,bytes:Buffer.byteLength(text)}};}

// Native-error planner only. It never reads files and never uses future actions.
// The file must remain unchanged between failure and immediate serialized retry.
export function planReadRangeRepair(args,text,{retries=0}={}){
 if(retries!==0||!validArgs(args)||typeof text!=='string'||text.length>1024)return null;
 const range=args.view_range;
 if(!Array.isArray(range)||range.length!==2||!range.every(Number.isSafeInteger))return null;
 const [lo,hi]=range;
 if(lo<1||hi<lo||hi-lo+1>READ_RANGE_POLICY.maxRequestedLines)return null;
 const m=text.trim().match(/^ERROR:\nInvalid `view_range` parameter: \[(\d+), (\d+)\]\. Its second element `(\d+)` should be smaller than the number of lines in the file: `(\d+)`\.$/);
 if(!m)return null;
 const [start,end,reportedEnd,total]=m.slice(1).map(Number);
 if(start!==lo||end!==hi||reportedEnd!==hi||!Number.isSafeInteger(total)||total<lo||total>=hi)return null;
 return {command:'view',path:args.path,view_range:[lo,total]};
}

// Trusted quiescent repository: component checks reject symlinks, but Node does
// not offer an openat2-style confinement guarantee against concurrent renames.
export async function readRangeTool({root,args}){
 if(!validArgs(args))return failure('invalid_arguments','ERROR:\nOnly command=view with a confined /workspace/ file path is supported.');
 const range=args.view_range;
 if(range!==undefined&&(!Array.isArray(range)||range.length!==2||!range.every(Number.isSafeInteger)||range[0]<1||(range[1]!==-1&&range[1]<range[0])))return failure('invalid_range','ERROR:\nview_range must be [start, end] with positive line numbers, or end=-1.');
 if(range&&range[1]!==-1&&range[1]-range[0]+1>READ_RANGE_POLICY.maxRequestedLines)return failure('range_limit',`ERROR:\nA view may request at most ${READ_RANGE_POLICY.maxRequestedLines} lines.`);
 let handle;
 try{
  if((await lstat(root)).isSymbolicLink())return failure('unsafe_path','ERROR:\nSymlink paths are not supported.');
  const realRoot=await realpath(root),parts=args.path.slice('/workspace/'.length).split('/');let file=realRoot;
  for(const part of parts){file=join(file,part);const st=await lstat(file);if(st.isSymbolicLink())return failure('unsafe_path','ERROR:\nSymlink paths are not supported.');}
  if(!resolve(file).startsWith(realRoot+sep))return failure('unsafe_path','ERROR:\nPath is outside the repository.');
  handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const stat=await handle.stat();
  if(!stat.isFile())return failure('not_regular_file','ERROR:\nOnly regular files can be viewed.');
  if(stat.size>READ_RANGE_POLICY.maxFileBytes)return failure('file_limit','ERROR:\nFile exceeds the 1 MB view limit.');
  const buffer=Buffer.alloc(READ_RANGE_POLICY.maxFileBytes+1);let length=0;
  while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
  if(length>READ_RANGE_POLICY.maxFileBytes)return failure('file_limit','ERROR:\nFile exceeds the 1 MB view limit.');
  const data=buffer.subarray(0,length);
  if(data.includes(0))return failure('binary_file','ERROR:\nBinary files are not supported.');
  let source;try{source=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{return failure('invalid_encoding','ERROR:\nFile is not valid UTF-8.');}
  const lines=source?source.split('\n'):[];if(source.endsWith('\n'))lines.pop();
  const totalLines=lines.length,lo=range?.[0]??1,requestedEnd=range?.[1];
  if(range&&lo>totalLines)return failure('start_out_of_range',`ERROR:\nInvalid \`view_range\` parameter: [${lo}, ${requestedEnd}]. Its first element \`${lo}\` should be within the range of lines of the file: [1, ${totalLines}].`,{totalLines});
  if(range&&requestedEnd!==-1&&requestedEnd>totalLines)return failure('end_out_of_range',`ERROR:\nInvalid \`view_range\` parameter: [${lo}, ${requestedEnd}]. Its second element \`${requestedEnd}\` should be smaller than the number of lines in the file: \`${totalLines}\`.`,{totalLines});
  const cap=range?READ_RANGE_POLICY.maxRequestedLines:READ_RANGE_POLICY.defaultLines;
  const desiredEnd=range?(requestedEnd===-1?totalLines:requestedEnd):totalLines;
  const end=Math.min(desiredEnd,lo+cap-1);
  let text=`Here's the result of running \`cat -n\` on ${args.path}:\n[Total lines: ${totalLines}]\n`,returnedLines=0;
  const suffix='\n[View truncated by line or output limit.]\n';
  for(let number=lo;number<=end;number++){
   const row=`${String(number).padStart(6)}\t${lines[number-1]}\n`;
   if(Buffer.byteLength(text)+Buffer.byteLength(row)+Buffer.byteLength(suffix)>READ_RANGE_POLICY.maxOutputBytes)break;
   text+=row;returnedLines++;
  }
  const truncated=lo+returnedLines-1<desiredEnd;
  if(truncated)text+=suffix;
  return {text,metadata:{status:'ok',code:'view',path:args.path,totalLines,start:lo,end:returnedLines?lo+returnedLines-1:null,returnedLines,truncated,bytes:Buffer.byteLength(text),fileBytes:length}};
 }catch(error){return failure('file_unavailable',error.code==='ENOENT'?'ERROR:\nFile does not exist.':'ERROR:\nFile could not be safely read.');}
 finally{await handle?.close();}
}

export async function runReadRangeTool({root,args,repair=false,onRetry}){
 const first=await readRangeTool({root,args});
 const planned=repair?planReadRangeRepair(args,first.text):null;
 if(!planned)return {...first,metadata:{...first.metadata,repairAttempted:false}};
 const retried=await readRangeTool({root,args:planned});
 const event={program:'read_range_repair_v1',originalArgs:args,retryArgs:planned,originalCode:first.metadata.code,retryCode:retried.metadata.code,succeeded:retried.metadata.status==='ok'};
 if(onRetry)await onRetry(event);
 return {...retried,metadata:{...retried.metadata,repairAttempted:true,repairSucceeded:event.succeeded,originalCode:first.metadata.code}};
}
