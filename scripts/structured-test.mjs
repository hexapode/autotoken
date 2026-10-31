import {spawn} from 'node:child_process';

const MAX_INPUT=1024*1024;
export function summarizePytest(text,{exitCode=null,timedOut=false,outputLimited=false,spawnError=null}={}) {
 const input=String(text),limited=input.length>MAX_INPUT||outputLimited;
 const lines=input.slice(-MAX_INPUT).replace(/\x1b\[[0-9;]*m/g,'').split(/\r?\n/);
 const summaries=lines.filter(line=>/\b\d+ (?:passed|failed|skipped|error|errors|deselected|xfailed|xpassed)\b.*\bin [\d.]+s\b/.test(line)).slice(-5).map(line=>line.slice(0,400));
 const failureLines=lines.filter(line=>/^(?:FAILED|ERROR)\s+\S+/.test(line));
 const failureIds=[...new Set(failureLines.map(line=>line.match(/^(?:FAILED|ERROR)\s+(\S+)/)[1].slice(0,400)))].slice(0,10);
 const failureObserved=failureLines.length>0||summaries.some(line=>/\b[1-9]\d* (?:failed|errors?)\b/.test(line));
 const excerpt=lines.filter(line=>/^(?:FAILED|ERROR|E\s|_+ |\S+\.py:\d+:)/.test(line)).slice(-40).join('\n').slice(-3000);
 let outcome='unknown';
 if(spawnError)outcome='spawn_error';
 else if(timedOut)outcome='timed_out';
 else if(limited)outcome='output_limit';
 else if(exitCode===null)outcome='unknown'; // Pipeline's outer exit is NOT pytest's exit.
 else if(exitCode===0)outcome=failureObserved?'inconsistent':summaries.some(line=>/\b\d+ passed\b/.test(line))?'passed':'unknown';
 else outcome=({1:'failed',2:'interrupted',3:'internal_error',4:'usage_error',5:'no_tests'})[exitCode]||'process_error';
 return {outcome,pytestExitCode:spawnError?null:exitCode,statusKnown:exitCode!==null&&!spawnError,failureObserved,failureIds,summaries,excerpt,truncated:limited||failureLines.length>10,timedOut,spawnError};
}

// Caller supplies a trusted interpreter and repository, never a recorded shell
// command. Targets are literal file/node IDs; no shell, pipelines or option text.
// This executes code in a trusted workspace; it is NOT a sandbox or symlink jail.
// Fixed reporting flags are a prototype contract, not arbitrary baseline-command
// equivalence. Plugin loading is inherited unless explicitly disabled by caller.
export async function runPytest({python,cwd,targets,timeoutMs=120000,maxOutputBytes=MAX_INPUT,disablePluginAutoload=false}) {
 if(typeof python!=='string'||!python||typeof cwd!=='string'||!Array.isArray(targets)||!targets.length||targets.length>20||targets.some(t=>typeof t!=='string'||t.length>400||t.startsWith('-')||t.startsWith('/')||t.split('/').includes('..')||/[\s$`<>|;&\\]/.test(t)))throw Error('Invalid trusted interpreter, cwd, or literal test targets');
 if(!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>300000||!Number.isInteger(maxOutputBytes)||maxOutputBytes<100||maxOutputBytes>MAX_INPUT)throw Error('Invalid resource bound');
 return new Promise(resolve=>{
  const child=spawn(python,['-m','pytest','-q','--tb=short','-rfE','--disable-warnings',...targets],{cwd,shell:false,env:{...process.env,...(disablePluginAutoload?{PYTEST_DISABLE_PLUGIN_AUTOLOAD:'1'}:{})},detached:process.platform!=='win32'});
  let chunks=[],bytes=0,timedOut=false,outputLimited=false,spawnError=null;
  const stop=()=>{try{if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL');}catch{}};
  const timer=setTimeout(()=>{timedOut=true;stop();},timeoutMs);
  const collect=chunk=>{bytes+=chunk.length;if(bytes>maxOutputBytes){outputLimited=true;stop();return;}chunks.push(chunk);};
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.on('error',error=>{spawnError=error.code||'spawn_error';});
  child.on('close',code=>{clearTimeout(timer);resolve(summarizePytest(Buffer.concat(chunks).toString('utf8'),{exitCode:code,timedOut,outputLimited,spawnError}));});
 });
}
