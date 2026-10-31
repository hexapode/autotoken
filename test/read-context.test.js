import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {planReadContext,runReadContext,evaluateReadContext} from '../src/read-context.js';
test('fixed read context preserves requested lines and abstains on oversized or unsafe ranges',()=>{
 const p=planReadContext([{file:'a.py',start:50,end:70}]);assert.deepEqual(p.ranges,[{file:'a.py',start:10,end:110}]);assert.equal(p.extraLines,80);
 assert.equal(planReadContext([{file:'a.py',start:100,end:300}]),null);
 for(const file of ['../key','/etc/passwd','.git/config','.env','.autotoken.env','id_rsa','secrets.pem'])assert.equal(planReadContext([{file,start:1,end:5}]),null);
 assert.equal(planReadContext([{file:'a.py',start:1,end:null}]),null);
});
test('overlapping requested ranges merge without dropping original contents',()=>{
 const p=planReadContext([{file:'a.py',start:60,end:80},{file:'a.py',start:70,end:90}]);assert.deepEqual(p.requested,[{file:'a.py',start:60,end:90}]);assert.equal(p.proposedLines,111);
});
test('program reads bounded repository files and refuses escaping symlinks or binary files',async t=>{
 const repo=await mkdtemp(join(tmpdir(),'autotoken-read-'));t.after(()=>rm(repo,{recursive:true,force:true}));
 await writeFile(join(repo,'a.py'),Array.from({length:150},(_,i)=>`line${i+1}`).join('\n'));
 const output=await runReadContext(repo,[{file:'a.py',start:50,end:70}]);assert.equal(output.status,'ok');assert.equal(output.returnedLines,101);assert.ok(output.text.includes('50: line50'));assert.ok(output.text.includes('110: line110'));
 await symlink('/etc/passwd',join(repo,'escape.py'));assert.equal((await runReadContext(repo,[{file:'escape.py',start:1,end:2}])).status,'abstain');
 await writeFile(join(repo,'binary.py'),Buffer.from([0,1,2]));assert.equal((await runReadContext(repo,[{file:'binary.py',start:1,end:2}])).status,'abstain');
});
test('evaluation target changes coverage but cannot change source-only program plan',()=>{
 const turn=(id,command)=>({id,valid:true,actions:[{name:'local_bash',command}]});
 const snapshot={runs:[{instanceId:'issue',arm:'baseline',model:'mock',turns:[turn('a','sed -n 50,70p a.py'),turn('b','sed -n 80,90p a.py')]}]};
 const a=evaluateReadContext(snapshot,{issue:0});assert.equal(a.partitions.heldout.wholeReadTurnsCovered,1);
 snapshot.runs[0].turns[1]=turn('b','sed -n 200,220p a.py');const b=evaluateReadContext(snapshot,{issue:0});assert.equal(b.partitions.heldout.wholeReadTurnsCovered,0);assert.deepEqual(a.events[0].proposal,b.events[0].proposal);
});
