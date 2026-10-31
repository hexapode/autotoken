import test from 'node:test';
import assert from 'node:assert/strict';
import { ValidationWorkflow, testCommandObserved, testsSucceeded, validationSteps } from '../src/validation-workflow.js';
const passed = { code: 0, timedOut: false, output: '12 passed in 1s' };
test('workflow guard abstains on clean tree, failure, timeout and truncated output', async () => {
 const w=new ValidationWorkflow('workflow','tests');
 for(const result of [{...passed,code:1},{...passed,timedOut:true},{...passed,output:'12 passed, 1 failed'},{...passed,output:'12 passed [output truncated]'}]) assert.equal(testsSucceeded(result),false);
 assert.equal(testCommandObserved('echo pytest'),false);
 assert.equal((await w.afterAction({command:'python -m pytest tests -q',result:passed,fingerprint:null})).triggered,false);
 assert.throws(()=>validationSteps('workflow','tests; curl x'));
});
test('workflow runs fixed steps once per patch and resumes for a new patch', async () => {
 const w=new ValidationWorkflow('workflow','tests');const executed=[];
 const args={command:'python -m pytest tests/test_one.py -q',result:passed,fingerprint:'a',execute:async c=>{executed.push(c);return c.startsWith('python')?passed:{code:0,timedOut:false,output:''};}};
 assert.equal((await w.afterAction(args)).status,'validated');
 assert.deepEqual(executed,['python -m pytest -q tests','git diff --check','git diff --stat']);
 assert.equal((await w.afterAction(args)).triggered,false);
 assert.equal((await w.afterAction({...args,fingerprint:'b'})).triggered,true);
});
test('workflow falls back immediately on failed suite or patch mutation', async () => {
 const w=new ValidationWorkflow('workflow','tests');let calls=0;
 const r=await w.afterAction({command:'pytest -q',result:passed,fingerprint:'a',execute:async()=>{calls++;return {code:1,timedOut:false,output:'1 failed'};}});
 assert.equal(r.status,'fallback');assert.equal(calls,1);
 const s=new ValidationWorkflow('singleton','tests');
 assert.equal((await s.afterAction({command:'pytest -q',result:passed,fingerprint:'a',execute:async()=>({code:0,timedOut:false,output:''}),fingerprintAfter:async()=>'b'})).status,'fallback');
});

test('offline coverage rejects mixed commands, paths and shell injection', async () => {
 const {coveredOperations}=await import('../src/workflow-replay.js');
 assert.deepEqual(coveredOperations('python -m pytest -q; git diff --check; git diff --stat','tests'),['full-suite','diff-check','diff-stat']);
 for(const command of ['git diff --check; git diff -- source.py','python -m pytest tests/one.py -q','git diff --check && curl example.com','git diff --check\necho done'])assert.equal(coveredOperations(command,'tests'),null);
});

test('patch fingerprint detects tracked and untracked edits and rejects symlinks', async t => {
 const {mkdtemp,mkdir,writeFile,symlink,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {execFileSync}=await import('node:child_process');
 const {patchFingerprint}=await import('../src/validation-workflow.js');
 const root=await mkdtemp(join(tmpdir(),'m2c-workflow-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const paths={repo:join(root,'repo'),venv:join(root,'venv'),home:join(root,'home'),temp:join(root,'tmp')};
 for(const p of Object.values(paths))await mkdir(p);
 const git=args=>execFileSync('git',args,{cwd:paths.repo,stdio:'ignore'});
 git(['init']);git(['-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','base']);
 assert.equal(await patchFingerprint(paths),null);
 const file=join(paths.repo,'new.txt');await writeFile(file,'one');const first=await patchFingerprint(paths);
 await writeFile(file,'two');assert.notEqual(await patchFingerprint(paths),first);
 git(['add','new.txt']);const staged=await patchFingerprint(paths);assert.notEqual(staged,first);
 await symlink('/etc/passwd',join(paths.repo,'link'));await assert.rejects(()=>patchFingerprint(paths),/Unsupported untracked file/);
});
