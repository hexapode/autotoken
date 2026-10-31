// Post-hoc evaluator repair only. Does not change trial runtime, source patches,
// manifests, inference, budget ledgers, or original primary classifications.
import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {evaluateDatasetOracle,validateDatasetOracle} from '../src/dataset-oracle.js';
const root=resolve(process.argv[2]||'data/experiments/read-range-live-v1');
const strict=new Set(['asottile__pyupgrade-890','asottile__pyupgrade-142','asottile__pyupgrade-104']);
const hash=text=>createHash('sha256').update(text).digest('hex');
const testPath=path=>/(?:^|\/)(?:tests?|testing)\/|(?:^|\/)test_[^/]+\.py$/.test(path);
const git=(cwd,args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024,env:{PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});if(r.error)throw r.error;return {code:r.status,stdout:r.stdout||'',stderr:r.stderr||''};};
const mustGit=(cwd,args)=>{const r=git(cwd,args);if(r.code!==0)throw Error(`git preparation failed (${r.code})`);return r.stdout;};
const runtimeHash=hash(await readFile(new URL('../src/dataset-oracle.js',import.meta.url)));
const records=[];
for(const name of (await readdir(root)).sort()){
 const directory=join(root,name);if(!(await stat(directory)).isDirectory())continue;
 let m;try{m=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));}catch{continue;}
 const issue=m.options?.instance;if(!strict.has(issue))continue;
 const base={run:name,issue,arm:m.options.programArm,repeat:Number(name.match(/-r(\d+)-/)?.[1]),originalState:m.state,originalOraclePassed:m.datasetOracle?.passed===true,calls:m.usage?.calls??null,tokens:m.usage?.knownTotalTokens??null};
 if(!['complete','failed'].includes(m.state)){records.push({...base,status:'pending_original_run'});continue;}
 if(m.datasetOracle){records.push({...base,status:'original_oracle_already_ran'});continue;}
 if(m.inference?.exitCode!==0||m.inference?.timedOut||m.error!=='Oracle preparation failed: git (1)'){records.push({...base,status:'not_oracle_apply_failure'});continue;}
 const supplemental=join(directory,'supplemental-oracle');
 const oracle=JSON.parse(await readFile(m.options.datasetOraclePath,'utf8')),originalPatch=await readFile(join(directory,'patch.diff'),'utf8'),task=JSON.parse(await readFile(join(directory,'task.json'),'utf8'));
 const {testPaths}=validateDatasetOracle(oracle),oraclePaths=new Set(testPaths),originalPatchHash=hash(originalPatch),oraclePatchHash=hash(oracle.test_patch);
 let cached;try{cached=JSON.parse(await readFile(join(supplemental,'report.json'),'utf8'));}catch{}
 if(cached){if(cached.originalPatchHash!==originalPatchHash||cached.oraclePatchHash!==oraclePatchHash||cached.runtimeHash!==runtimeHash)throw Error('Existing supplemental evaluation inputs changed');records.push(cached);continue;}
 await mkdir(supplemental,{recursive:true,mode:0o700});
 const attempts=(await readdir(supplemental)).filter(n=>/^attempt-\d+$/.test(n));const attempt=join(supplemental,`attempt-${attempts.length+1}`);await mkdir(attempt,{mode:0o700});
 const row={...base,status:'checking_conflict',method:'posthoc-source-only-agent-patch-with-identical-dataset-test-patch',originalPatchHash,oraclePatchHash,runtimeHash,originalManifestUnchanged:true,officialSwebenchEvaluation:false};
 try{
  const diagnostic=join(attempt,'diagnostic');mustGit(attempt,['clone','--quiet','--shared',join(directory,'checkout'),diagnostic]);mustGit(diagnostic,['checkout','--quiet',task.base_commit]);
  const oracleFile=join(attempt,'oracle.patch'),agentFile=join(attempt,'agent.patch');await writeFile(oracleFile,oracle.test_patch,{mode:0o600});await writeFile(agentFile,originalPatch,{mode:0o600});
  const clean=git(diagnostic,['apply','--check',oracleFile]);if(clean.code!==0)throw Error('Oracle patch does not apply to clean original; not an agent-test conflict');
  mustGit(diagnostic,['apply','--check',agentFile]);mustGit(diagnostic,['apply',agentFile]);
  const conflict=git(diagnostic,['apply','--check',oracleFile]);await writeFile(join(attempt,'conflict.log'),conflict.stderr,{mode:0o600});
  const failedPaths=[...conflict.stderr.matchAll(/^error: (?:patch failed: (.+):\d+|(.+): patch does not apply)$/gm)].map(m=>m[1]||m[2]);
  if(conflict.code===0||!failedPaths.length||failedPaths.some(path=>!oraclePaths.has(path)))throw Error('Failure not verified as overlap with dataset test paths');
  row.verifiedConflictPaths=[...new Set(failedPaths)];
  mustGit(diagnostic,['add','-A']);const changed=mustGit(diagnostic,['diff','--cached','--name-only','-z',task.base_commit]).split('\0').filter(Boolean);
  const included=changed.filter(path=>!testPath(path)&&!oraclePaths.has(path)),excluded=changed.filter(path=>!included.includes(path));
  row.excludedAgentTestPaths=excluded;row.includedAgentPaths=included;
  // Read retained paths directly from the original applied agent diff. Test-only
  // changes are omitted; clean clones therefore retain the original tests until
  // the same dataset oracle patch is applied by the frozen evaluator.
  const sourcePatch=included.length?mustGit(diagnostic,['diff','--cached','--binary',task.base_commit,'--',...included]):'';
  row.sourcePatchHash=hash(sourcePatch);await writeFile(join(attempt,'source-only-agent.patch'),sourcePatch,{mode:0o600});
  row.oracle=await evaluateDatasetOracle({sourceRepo:join(directory,'checkout'),baseCommit:task.base_commit,agentPatch:sourcePatch,oracle,python:join(directory,'task-venv','bin','python'),outputDir:join(attempt,'evaluation')});
  row.status='supplemental_evaluated';row.supplementalPassed=row.oracle.passed;
 }catch(error){row.status='supplemental_rejected';row.error=error.message;}
 await writeFile(join(supplemental,'report.json'),JSON.stringify(row,null,2),{mode:0o600});records.push(row);
 console.log(JSON.stringify({run:name,status:row.status,passed:row.supplementalPassed,error:row.error}));
}
const report={kind:'posthoc-evaluation-repair-not-primary',createdAt:new Date().toISOString(),runtimeHash,strictIssues:[...strict],method:['Only terminal runs with clean inference and original git-apply oracle failure are considered.','Verify dataset test patch applies to pristine base, original agent patch applies, and dataset patch then conflicts on oracle test paths.','Exclude every agent-modified test path; retain exact non-test diff. Apply identical dataset tests to original and source-only-patched clean clones.','Use frozen assertion-failure-before and all-pass-after oracle, without gold source patch or further model calls.','Report separately from primary: this evaluates the retained non-test fix, not the complete original submission; omitted test helpers may affect behavior.'],summary:{originalOraclePasses:records.filter(r=>r.originalOraclePassed).length,supplementalEvaluated:records.filter(r=>r.status==='supplemental_evaluated').length,supplementalPasses:records.filter(r=>r.supplementalPassed).length,supplementalRejected:records.filter(r=>r.status==='supplemental_rejected').length,pending:records.filter(r=>r.status==='pending_original_run').length},records};
await writeFile(join(root,'supplemental-oracle-report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report.summary));
