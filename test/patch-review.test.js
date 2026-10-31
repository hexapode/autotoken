import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {patchReview} from '../src/patch-review.js';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'autotoken-review-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
 git('init','-q');git('config','user.email','test@example.invalid');git('config','user.name','Test');await writeFile(join(root,'file.txt'),'before\n');git('add','file.txt');git('commit','-qm','base');return {root,git};
}
test('patch packet reports changes, whitespace failures and status without modifying files',async t=>{
 const {root,git}=await fixture(t);await writeFile(join(root,'file.txt'),'after  \n');await writeFile(join(root,'new.txt'),'new\n');const before=git('status','--porcelain');
 const result=await patchReview(root);assert.equal(result.status,'checks-failed');assert.deepEqual(result.results.map(r=>r.name),['whitespace','statistics','patch','status']);assert.match(result.results[2].output,/\+after/);assert.match(result.results[3].output,/new.txt/);assert.equal(git('status','--porcelain'),before);assert.equal(await readFile(join(root,'file.txt'),'utf8'),'after  \n');
});
test('output is bounded and incomplete packets are explicit',async t=>{
 const {root}=await fixture(t);await writeFile(join(root,'file.txt'),'big line\n'.repeat(10000));const result=await patchReview(root,{maxBytes:256});assert.equal(result.status,'truncated');assert.ok(result.bytes<=256);
});
test('subdirectories and nonrepositories abstain; relative paths and invalid limits reject',async t=>{
 const {root}=await fixture(t);await mkdir(join(root,'sub'));assert.equal((await patchReview(join(root,'sub'))).status,'abstained');
 const empty=await mkdtemp(join(tmpdir(),'autotoken-no-git-'));t.after(()=>rm(empty,{recursive:true,force:true}));assert.equal((await patchReview(empty)).status,'abstained');await assert.rejects(patchReview('.'));await assert.rejects(patchReview(root,{maxBytes:0}));
});
test('repository external diff and fsmonitor commands are not executed',async t=>{
 const {root,git}=await fixture(t);const marker=join(root,'marker');git('config','diff.external',`touch ${marker}`);git('config','core.fsmonitor',`touch ${marker}`);await writeFile(join(root,'file.txt'),'changed\n');const result=await patchReview(root);assert.equal(result.status,'ok');await assert.rejects(readFile(marker));
});
