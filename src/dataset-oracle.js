// Host-only evaluation. Never pass oracle metadata/test patches to the agent.
// Executes repository tests in trusted local workspaces, not a security sandbox.
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';

export function validateDatasetOracle(oracle){
 if(!oracle||typeof oracle.test_patch!=='string'||!oracle.test_patch||oracle.test_patch.length>1000000||!Array.isArray(oracle.FAIL_TO_PASS)||!oracle.FAIL_TO_PASS.length||oracle.FAIL_TO_PASS.length>200)throw Error('Invalid dataset oracle');
 const ids=oracle.FAIL_TO_PASS;
 if(new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||id.length>4096||/[\0\r\n]/.test(id)||id.startsWith('-')||id.split('::')[0].startsWith('/')||id.split('::')[0].split('/').includes('..')))throw Error('Invalid oracle test targets');
 const paths=[...oracle.test_patch.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].flatMap(m=>[m[1],m[2]]);
 if(!paths.length||paths.some(path=>path.startsWith('/')||path.split('/').includes('..')||!/(?:^|\/)(?:tests?|testing)\/|(?:^|\/)test_[^/]+\.py$/.test(path))||/^(?:new|old) file mode 120000$/m.test(oracle.test_patch))throw Error('Oracle patch must modify ordinary test files only');
 return {targets:[...ids],testPaths:paths};
}
export function scoreOracleResults(baseline,patched,expectedCount){
 const complete=r=>!r.timedOut&&r.cases?.length===expectedCount&&r.cases.every(c=>!c.error&&!c.skipped);
 const reproduced=complete(baseline)&&baseline.code===1&&baseline.cases.every(c=>c.failed&&c.assertionFailure);
 const fixed=complete(patched)&&patched.code===0&&patched.cases.every(c=>!c.failed);
 return {reproduced,fixed,passed:reproduced&&fixed};
}
function execute(binary,args,{cwd,env,timeoutMs=180000}){
 return new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{cwd,env,shell:false,detached:process.platform!=='win32'});let output='',timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;try{process.platform==='win32'?child.kill('SIGKILL'):process.kill(-child.pid,'SIGKILL');}catch{}},timeoutMs);
  const collect=data=>{if(output.length<2000000)output+=data.toString().slice(0,2000000-output.length);};child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);resolve({code,timedOut,output});});
 });
}
const XML_SCRIPT=String.raw`import json,sys,xml.etree.ElementTree as E,re
try:
 root=E.parse(sys.argv[1]); rows=[]
 for c in root.iter('testcase'):
  f=c.find('failure'); text='' if f is None else (f.text or '')+' '+f.get('message','')
  rows.append({'name':c.get('name'),'failed':f is not None,'assertionFailure':bool(re.match(r'(?:AssertionError\b|assert\b|Failed: DID NOT RAISE\b)', '' if f is None else f.get('message','').strip())),'error':c.find('error') is not None,'skipped':c.find('skipped') is not None})
 print(json.dumps(rows))
except (OSError,E.ParseError): print('[]')`;

export async function evaluateDatasetOracle({sourceRepo,baseCommit,agentPatch,oracle,python,outputDir,timeoutMs=180000}){
 const {targets}=validateDatasetOracle(oracle);
 if(!/^[a-f0-9]{40}$/.test(baseCommit)||typeof agentPatch!=='string'||agentPatch.length>5000000)throw Error('Invalid base or agent patch');
 const out=resolve(outputDir);await mkdir(out,{recursive:false,mode:0o700});const home=join(out,'home');await mkdir(home);
 await writeFile(join(out,'oracle.patch'),oracle.test_patch,{mode:0o600});await writeFile(join(out,'agent.patch'),agentPatch,{mode:0o600});
 const interpreter=resolve(python),env={PATH:`${dirname(interpreter)}:${process.env.PATH||'/usr/bin:/bin'}`,HOME:home,TMPDIR:out,PYTEST_DISABLE_PLUGIN_AUTOLOAD:'1'};
 const must=async(binary,args,cwd)=>{const result=await execute(binary,args,{cwd,env,timeoutMs});if(result.code!==0||result.timedOut)throw Error(`Oracle preparation failed: ${binary} (${result.code})`);return result;};
 const results={};
 for(const stage of ['baseline','patched']){
  const cwd=join(out,stage);await must('git',['clone','--quiet','--shared',resolve(sourceRepo),cwd],out);await must('git',['checkout','--quiet',baseCommit],cwd);
  if(stage==='patched'&&agentPatch.trim()){await must('git',['apply','--check',join(out,'agent.patch')],cwd);await must('git',['apply',join(out,'agent.patch')],cwd);}
  // Identical test patch is applied after the agent patch, never before inference.
  // Conflicting agent test edits reject evaluation instead of weakening the oracle.
  await must('git',['apply','--check',join(out,'oracle.patch')],cwd);await must('git',['apply',join(out,'oracle.patch')],cwd);
  const xml=join(out,`${stage}.xml`),testEnv={...env,PYTHONPATH:cwd};
  const run=await execute(interpreter,['-m','pytest','-q','--disable-warnings',`--junitxml=${xml}`,...targets],{cwd,env:testEnv,timeoutMs});await writeFile(join(out,`${stage}.log`),run.output,{mode:0o600});
  const parsed=await execute(interpreter,['-c',XML_SCRIPT,xml],{cwd:out,env,timeoutMs:10000});
  results[stage]={code:run.code,timedOut:run.timedOut,cases:parsed.code===0?JSON.parse(parsed.output):[]};
 }
 const report={...scoreOracleResults(results.baseline,results.patched,targets.length),expectedTests:targets.length,...results,oracleIsHostOnly:true,officialSwebenchEvaluation:false};
 await writeFile(join(out,'report.json'),JSON.stringify(report,null,2),{mode:0o600});return report;
}
