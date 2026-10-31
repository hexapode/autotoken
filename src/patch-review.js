import {spawn} from 'node:child_process';
import {realpath,stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';

const STEPS=Object.freeze([
 {name:'whitespace',args:['diff','--no-ext-diff','--no-textconv','--check']},
 {name:'statistics',args:['diff','--no-ext-diff','--no-textconv','--stat']},
 {name:'patch',args:['diff','--no-ext-diff','--no-textconv']},
 {name:'status',args:['status','--short','--untracked-files=normal']}
]);
const PREFIX=['-c','core.fsmonitor=false','-c','core.pager=cat','-c','core.untrackedCache=false'];
const ENV={PATH:'/usr/bin:/bin:/usr/local/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};
function git(root,args,limit,timeoutMs){
 return new Promise((resolve,reject)=>{
  const child=spawn('git',[...PREFIX,...args],{cwd:root,env:ENV,shell:false,stdio:['ignore','pipe','pipe']});
  const chunks=[];let bytes=0,truncated=false,timedOut=false;
  const collect=chunk=>{const available=Math.max(0,limit-bytes);if(chunk.length>available){truncated=true;child.kill('SIGKILL');}const keep=chunk.subarray(0,available);chunks.push(keep);bytes+=keep.length;};
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs);
  child.on('error',e=>{clearTimeout(timer);reject(e);});
  child.on('close',code=>{clearTimeout(timer);resolve({exitCode:code,output:Buffer.concat(chunks).toString('utf8'),bytes,truncated,timedOut});});
 });
}
// Fixed argv only: callers choose a repository and output/time limits, never commands.
export async function patchReview(repoRoot,{maxBytes=12000,timeoutMs=5000}={}){
 if(typeof repoRoot!=='string'||!isAbsolute(repoRoot))throw Error('Expected an absolute repository root');
 if(!Number.isInteger(maxBytes)||maxBytes<256||maxBytes>200000||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)throw Error('Invalid patch-review bounds');
 const root=await realpath(repoRoot);if(!(await stat(root)).isDirectory())throw Error('Repository root is not a directory');
 const started=performance.now();let remaining=maxBytes;const results=[];
 const identity=await git(root,['rev-parse','--show-toplevel'],Math.min(maxBytes,4096),timeoutMs);
 if(identity.exitCode!==0||identity.truncated||identity.timedOut)return {status:'abstained',reason:'Repository identity unavailable',results:[],bytes:0};
 if(await realpath(identity.output.trim())!==root)return {status:'abstained',reason:'Provide repository top-level directory',results:[],bytes:0};
 for(const step of STEPS){
  const time=Math.floor(timeoutMs-(performance.now()-started));
  if(time<=0)return {status:'timeout',results,bytes:maxBytes-remaining};
  if(remaining<=0)return {status:'truncated',results,bytes:maxBytes};
  const result=await git(root,step.args,remaining,time);results.push({name:step.name,...result});remaining-=result.bytes;
  if(result.timedOut)return {status:'timeout',results,bytes:maxBytes-remaining};
  if(result.truncated)return {status:'truncated',results,bytes:maxBytes-remaining};
 }
 return {status:results.some(r=>r.exitCode!==0)?'checks-failed':'ok',results,bytes:maxBytes-remaining};
}
