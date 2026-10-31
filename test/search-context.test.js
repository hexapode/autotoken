import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {searchContext,expandMatchRanges} from '../src/search-context.js';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'autotoken-context-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('search returns deterministic merged bounded context without modifying files',async t=>{
 const root=await fixture(t);await mkdir(join(root,'src'));
 const source='header\ndef target():\n    first = 1\n    target_value = first\n    return target_value\nfooter\n';await writeFile(join(root,'src/a.py'),source);
 const result=await searchContext({root,query:'target',paths:['src'],before:1,after:1});
 assert.equal(result.status,'ok');assert.equal(result.truncated,false);
 assert.deepEqual(result.matches,[{path:'src/a.py',line:2},{path:'src/a.py',line:4},{path:'src/a.py',line:5}]);
 assert.deepEqual(result.ranges.map(({path,start,end})=>({path,start,end})),[{path:'src/a.py',start:1,end:6}]);
 assert.equal(result.ranges[0].lines[1].text,'def target():');assert.equal(await readFile(join(root,'src/a.py'),'utf8'),source);
 assert.deepEqual(await searchContext({root,query:'target',paths:['src'],before:1,after:1}),result);
});
test('pure expansion merges ranges and caps files and total lines without target actions',()=>{
 const result=expandMatchRanges([{path:'b.py',line:100},{path:'a.py',line:2},{path:'a.py',line:7}],{before:2,after:3,maxFiles:1,maxLines:8});
 assert.deepEqual(result.ranges,[{path:'a.py',start:1,end:8}]);assert.equal(result.truncated,true);assert.ok(result.reasons.includes('line_limit'));assert.ok(result.reasons.includes('file_limit'));
 assert.throws(()=>expandMatchRanges([{path:'../outside',line:1}]));assert.throws(()=>expandMatchRanges([{path:'x',line:0}]));
});
test('explicit traversal, hidden files and symlink paths abstain; directory search skips links',async t=>{
 const root=await fixture(t),outside=await fixture(t);await writeFile(join(outside,'secret'),'SENSITIVE');await writeFile(join(root,'safe.py'),'SENSITIVE safe');
 await writeFile(join(root,'.env'),'SENSITIVE credential');await symlink(outside,join(root,'linked'));await symlink(join(outside,'secret'),join(root,'direct'));
 for(const path of ['../secret',join(outside,'secret'),'.env','linked/secret','direct']){
  const result=await searchContext({root,query:'SENSITIVE',paths:[path]});assert.equal(result.status,'abstained',path);assert.ok(!JSON.stringify(result).includes('credential'));
 }
 const result=await searchContext({root,query:'SENSITIVE',paths:['.']});assert.equal(result.status,'ok');assert.deepEqual(result.matches,[{path:'safe.py',line:1}]);assert.equal(result.skipped.symlink,2);
});
test('restricted regex supports literal alternatives and anchors, rejects unbounded regex features',async t=>{
 const root=await fixture(t);await writeFile(join(root,'sample.py'),'def target():\nclass Example:\nnot def target\na.b\nA|B\n');
 const selected=await searchContext({root,query:'^def target|^class Example',paths:['sample.py'],mode:'regex',before:0,after:0});assert.deepEqual(selected.matches.map(m=>m.line),[1,2]);
 assert.deepEqual((await searchContext({root,query:'a\\.b$',paths:['sample.py'],mode:'regex'})).matches.map(m=>m.line),[4]);
 assert.deepEqual((await searchContext({root,query:'A|B',paths:['sample.py'],mode:'literal'})).matches.map(m=>m.line),[5]);
 for(const query of ['(a+)+','.*','[a-z]','foo\\1','foo|'])assert.equal((await searchContext({root,query,paths:['sample.py'],mode:'regex'})).reason,'unsupported_regex');
});
test('match, file, byte and output limits are explicit; binary files are skipped',async t=>{
 const root=await fixture(t);await writeFile(join(root,'a.py'),'match '.repeat(1000)+'\nmatch\nmatch\n');await writeFile(join(root,'b.py'),'match\n');await writeFile(join(root,'binary'),Buffer.from([0,109,97,116,99,104]));
 const output=await searchContext({root,query:'match',paths:['a.py'],limits:{maxOutputBytes:2048}});assert.equal(output.status,'ok');assert.ok(output.truncated);assert.ok(output.reasons.includes('output_bytes'));assert.ok(Buffer.byteLength(JSON.stringify(output))<=2048);
 const capped=await searchContext({root,query:'match',paths:['a.py'],limits:{maxMatches:1}});assert.equal(capped.matches.length,1);assert.ok(capped.reasons.includes('match_limit'));
 const fileLimit=await searchContext({root,query:'match',paths:['.'],limits:{maxFiles:1}});assert.ok(fileLimit.reasons.includes('file_limit'));
 const large=await searchContext({root,query:'match',paths:['a.py'],limits:{maxFileBytes:5}});assert.equal(large.filesRead,0);assert.ok(large.reasons.includes('file_bytes'));
 const binary=await searchContext({root,query:'match',paths:['binary']});assert.equal(binary.matches.length,0);assert.equal(binary.skipped.binary,1);
});
test('invalid and unsupported inputs abstain rather than executing arbitrary expressions',async t=>{
 const root=await fixture(t);await writeFile(join(root,'x.py'),'hello');
 for(const input of [{query:''},{query:'hello',mode:'shell'},{query:'hello',paths:['*.py']},{query:'hello',limits:{maxOutputBytes:1}},{query:'hello',before:10000}])assert.equal((await searchContext({root,...input})).status,'abstained');
 const literal=await searchContext({root,query:'$(touch pwned)',paths:['x.py']});assert.equal(literal.status,'ok');assert.equal(literal.matches.length,0);
});
