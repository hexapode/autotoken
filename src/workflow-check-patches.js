import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { command } from './swe-runner.js';
import { runLocalCommand } from './local-tool.js';
import { ValidationWorkflow, patchFingerprint } from './validation-workflow.js';

const [collectionArg,outArg]=process.argv.slice(2);
const collection=resolve(collectionArg),out=resolve(outArg);
const protocol=JSON.parse(await readFile(join(out,'protocol.json'),'utf8'));
const ids=['pylint-dev__astroid-1417','pydicom__pydicom-1139'];
if(ids.some(id=>!protocol.replayIssues.includes(id)))throw new Error('Execution cases must be frozen held-out issues');
const results=[];
for(const id of ids) {
 const source=join(collection,id),dir=join(out,'patch-checks',id),repo=join(dir,'checkout');
 await mkdir(dir,{recursive:true});
 const task=JSON.parse(await readFile(join(source,'task.json'),'utf8'));
 await command('git',['clone','--no-local','--no-checkout',join(source,'checkout'),repo],{timeoutMs:60000});
 await command('git',['-C',repo,'checkout','--detach',task.base_commit]);
 await command('git',['-C',repo,'apply','--binary',join(source,'patch.diff')]);
 const paths={repo,venv:join(source,'task-venv'),home:join(dir,'home'),temp:join(dir,'tmp')};
 await mkdir(paths.home);await mkdir(paths.temp);
 const before=await patchFingerprint(paths);
 const workflow=new ValidationWorkflow('workflow',id.startsWith('pydicom__')?'pydicom/tests':'tests');
 // Force only the entry condition; actual suite/diff commands run on this fresh
 // final-patch checkout. This is execution validation, not chronological replay.
 const report=await workflow.afterAction({command:'python -m pytest tests/target.py -q',result:{code:0,timedOut:false,output:'1 passed'},fingerprint:before,execute:c=>runLocalCommand(paths,c,120),fingerprintAfter:()=>patchFingerprint(paths)});
 await writeFile(join(dir,'workflow.json'),JSON.stringify(report,null,2),{mode:0o600});
 results.push({instanceId:id,status:report.status,steps:report.steps.map(s=>({command:s.command,code:s.code,timedOut:s.timedOut,summary:s.output.split('\n').filter(l=>/\d+ passed/.test(l)).at(-1)}))});
 console.log(JSON.stringify(results.at(-1)));
}
await writeFile(join(out,'patch-checks.json'),JSON.stringify({kind:'workflow-execution-on-fresh-final-patches',results,limitations:['Entry condition injected; no claim this was the chronological agent state.','No model calls, no measured query savings.','Repository suites only; not official SWE-bench evaluation.']},null,2),{mode:0o600});
