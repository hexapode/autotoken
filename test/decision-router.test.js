import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PATCH_REVIEW,contextBefore,features,newPolicy,observe,score,reviewLabel,validateDecision,compileDecision,apiDecision,calibrate} from '../src/decision-router.js';
import {splitIssues,makeRows} from '../src/router-experiment.js';
import {makeDecisionServer} from '../src/decision-server.js';
const context={ordinal:2,history:[{valid:true,actions:[{command:"python -c \"p.write_text('fix')\"; python -m pytest -q tests",result:'Exit code: 0; timed out: false\n10 passed'}]}]};
const turn=command=>({valid:true,actions:[{name:'local_bash',command,result:'Exit code: 0; timed out: false\n'}]});
test('replay router cannot see target actions, output, or future turns',()=>{
 const run={turns:[turn('pwd'),turn('git diff'),turn('SECRET FUTURE')]};
 const before=contextBefore(run,1);run.turns[1]=turn('DO NOT LEAK');run.turns[2]=turn('DIFFERENT FUTURE');
 assert.deepEqual(contextBefore(run,1),before);assert.ok(!JSON.stringify(before).includes('LEAK'));
});
test('whole-turn coverage excludes tests, edits, shell expansion and unknown options',()=>{
 assert.equal(reviewLabel(turn('git diff --check; git diff --stat; git diff -- src/file.py; git status --short')),true);
 for(const command of ['git diff; pytest','git diff; rm file','git diff $(touch x)','git diff | cat','git diff --output=file','git diff --ext-diff','git diff; python -c "print(1)"'])assert.equal(reviewLabel(turn(command)),false,command);
});
test('decision compiler only allows the registered program and fixed arguments',()=>{
 const valid={route:'program',program:PATCH_REVIEW.id,arguments:{scope:'current_patch'}};
 assert.equal(compileDecision(valid).arguments.command,PATCH_REVIEW.commands.join('; '));
 assert.equal(compileDecision({route:'model'}),null);
 for(const raw of [{...valid,program:'shell'}, {...valid,arguments:{scope:'current_patch',command:'rm -rf /'}},{...valid,command:'pwd'},{route:'model',program:'oops'}])assert.throws(()=>validateDecision(raw));
});
test('online feedback updates candidate and calibration refuses insufficient support',()=>{
 const policy=newPolicy(),before=score(policy,context);observe(policy,context,true);assert.ok(score(policy,context)>before);
 assert.equal(calibrate([{context,label:true}],policy).qualified,false);
});
test('issue partition is stable, disjoint and independent of target labels',()=>{
 const runs=Array.from({length:20},(_,i)=>({instanceId:`issue${i}`,turns:[turn('pwd')]}));
 const a=splitIssues(runs);runs.reverse();runs[0].turns=[turn('git diff')];const b=splitIssues(runs);
 for(const key of ['train','calibration','test'])assert.deepEqual(a[key].issues,b[key].issues);
 const ids=Object.values(a).flatMap(p=>p.issues);assert.equal(new Set(ids).size,20);
 assert.equal(makeRows(runs).length,20);
});
test('model API adapter supports Anthropic and compatible JSON decisions',async()=>{
 for(const provider of ['anthropic','compatible']){
  let seen;
  const result=await apiDecision(context,PATCH_REVIEW,{provider,key:'private-test',model:'mock',fetchImpl:async(url,opts)=>{seen={url,body:JSON.parse(opts.body)};return {ok:true,json:async()=>provider==='anthropic'?{content:[{type:'text',text:'{"route":"model"}'}]}:{choices:[{message:{content:'{"route":"model"}'}}]}};}});
  assert.equal(result.decision.route,'model');assert.ok(seen.url.endsWith(provider==='anthropic'?'/messages':'/chat/completions'));
  assert.ok(!JSON.stringify(seen.body).includes('private-test'));
 }
});
test('decision API authenticates, logs shadow decisions, and learns without changing serving weights',async t=>{
 const root=await mkdtemp(join(tmpdir(),'autotoken-decision-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const artifact={version:1,program:PATCH_REVIEW,policy:newPolicy(),threshold:.1,evaluationIssues:['heldout']};
 const server=makeDecisionServer(artifact,{token:'test-token-at-least-16',directory:root});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 const url=`http://127.0.0.1:${server.address().port}`;
 const post=async(path,body)=>fetch(url+path,{method:'POST',headers:{authorization:'Bearer test-token-at-least-16','content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await fetch(url+'/health')).status,401);
 const first=await (await post('/decision',{issueId:'train',context})).json();assert.equal(first.route,'model');assert.equal(first.shadowDecision.route,'program');
 const outcome={requestId:first.requestId,evidence:'replay-action-match',compatible:true};
 assert.equal((await post('/outcomes',outcome)).status,200);assert.equal((await post('/outcomes',outcome)).status,400);
 const candidate=JSON.parse(await readFile(join(root,'candidate.json')));assert.equal(candidate.policy.updates,1);assert.equal(artifact.policy.updates,0);
 const heldout=await(await post('/decision',{issueId:'heldout',context})).json();assert.equal((await post('/outcomes',{...outcome,requestId:heldout.requestId})).status,400);
 const next=await(await post('/decision',{issueId:'train',context})).json();assert.deepEqual(next.shadowDecision,first.shadowDecision);
 const log=await readFile(join(root,'events.jsonl'),'utf8');assert.ok(!log.includes('test-token-at-least-16'));
});
test('invalid API decision falls back without forwarding raw provider errors',async t=>{
 const root=await mkdtemp(join(tmpdir(),'autotoken-decision-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const server=makeDecisionServer({version:1,program:PATCH_REVIEW,policy:newPolicy(),threshold:1},{token:'test-token-at-least-16',directory:root,backend:'api',decide:async()=>{throw Error('secret upstream detail');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/decision`,{method:'POST',headers:{authorization:'Bearer test-token-at-least-16','content-type':'application/json'},body:JSON.stringify({context,issueId:'test'})});
 const result=await response.json();assert.equal(result.shadowDecision.route,'model');assert.ok(!JSON.stringify(result).includes('secret'));
});
