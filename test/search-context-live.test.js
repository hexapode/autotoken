import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {searchContextAfterAction} from '../src/search-context-live.js';
import {readSourceRanges} from '../src/search-context.js';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'autotoken-live-context-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(join(root,'code.py'),Array.from({length:100},(_,i)=>i===49?'def target():':`line ${i+1}`).join('\n'));return root;}
test('live search enrichment uses fixed pre-result windows without reminders or writes',async t=>{
 const root=await fixture(t);const before=await readFile(join(root,'code.py'),'utf8');
 const report=await searchContextAfterAction({root,command:"grep -n 'def target' code.py",result:{code:0,timedOut:false,output:'50:def target():\n'}});
 assert.equal(report.triggered,true);assert.deepEqual(report.ranges,[{path:'code.py',start:30,end:70}]);assert.ok(report.appendedText.includes('50: def target():'));assert.equal(report.bytes,Buffer.byteLength(report.appendedText));assert.equal(await readFile(join(root,'code.py'),'utf8'),before);
});
test('failed, truncated, mixed, or unsafe search evidence returns unchanged-result suffix',async t=>{
 const root=await fixture(t);const base={root,command:'grep -n target code.py',result:{code:0,timedOut:false,output:'50:def target():\n'}};
 for(const input of [{...base,result:{...base.result,code:1}},{...base,result:{...base.result,output:'[output truncated]'}},{...base,command:'grep -n target code.py; rm x'},{...base,result:{...base.result,output:'../secret:2:target'}}]){
  const report=await searchContextAfterAction(input);assert.equal(report.triggered,false);assert.equal(report.appendedText,'');
 }
 await symlink('/etc/passwd',join(root,'link.py'));const linked=await searchContextAfterAction({...base,command:'grep -n target link.py',result:{...base.result,output:'2:target'}});assert.equal(linked.triggered,false);
});
test('explicit source reads do not re-expand ranges and enforce limits',async t=>{
 const root=await fixture(t);const value=await readSourceRanges({root,ranges:[{path:'code.py',start:49,end:51}],limits:{maxLines:3}});
 assert.equal(value.status,'ok');assert.deepEqual(value.ranges[0].lines.map(l=>l.number),[49,50,51]);
 assert.equal((await readSourceRanges({root,ranges:[{path:'code.py',start:1,end:10}],limits:{maxLines:3}})).status,'abstained');
});
