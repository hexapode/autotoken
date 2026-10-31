import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {issueFolds,evaluateCorpus,snapshotCorpus} from '../src/router-corpus.js';
const turn={id:'trace',valid:true,actions:[{name:'local_bash',command:'git diff',result:null}]};
test('all models and arms of one issue share a fold; only baseline trains',()=>{
 const runs=Array.from({length:30},(_,i)=>['baseline','workflow'].map((arm,j)=>({instanceId:`issue${i}`,model:j?'opus':'gpt',arm,turns:[{...turn,id:`${i}-${j}`}]}))).flat();
 const assignments=issueFolds(runs);assert.equal(Object.keys(assignments).length,30);
 assert.deepEqual(assignments,issueFolds([...runs].reverse()));
 const report=evaluateCorpus({runs,sources:[],excluded:[],createdAt:'test'});
 assert.equal(report.summary.batch.primary.examples,30);assert.equal(report.summary.batch.treatmentDiagnostic.examples,30);
 const testIssues=[];
 for(const fold of report.folds){
  testIssues.push(...fold.issues.test);assert.equal(fold.trainingExamples,18);
  for(const id of fold.issues.test)assert.ok(!fold.issues.train.includes(id)&&!fold.issues.calibration.includes(id));
 }
 assert.equal(new Set(testIssues).size,30);assert.equal(testIssues.length,30);
});
test('snapshot deduplicates trace IDs and audits unfinished runs',async t=>{
 const root=await mkdtemp(join(tmpdir(),'autotoken-corpus-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const [name,id,state] of [['a','same','complete'],['b','same','complete'],['c','pending','inference']]){
  const dir=join(root,name);await mkdir(join(dir,'traces',id),{recursive:true});
  await writeFile(join(dir,'manifest.json'),JSON.stringify({state,startedAt:'2026-01-01',options:{instance:'test__repo-1',split:'dev'},model:'mock'}));
  await writeFile(join(dir,'traces',id,'metadata.json'),JSON.stringify({id,state:'complete',startedAt:'2026-01-01',upstreamStatus:200,response:{status:'completed',output:[]}}));
  await writeFile(join(dir,'traces',id,'request.json'),'{}');
 }
 const snapshot=await snapshotCorpus([root]);assert.equal(snapshot.runs.length,1);assert.equal(snapshot.sources[0].records,3);assert.equal(snapshot.sources[0].duplicateRecords,1);assert.equal(snapshot.excluded.length,1);
 assert.equal(snapshot.excluded[0].traceId,'pending');
});
