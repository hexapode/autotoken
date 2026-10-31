import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {summarizePytest,runPytest} from './structured-test.mjs';
assert.equal(summarizePytest('FAILED test_a.py::test_a\n1 failed in 0.01s').outcome,'unknown');
assert.equal(summarizePytest('1 passed in 0.01s').statusKnown,false);
assert.equal(summarizePytest('1 failed in 0.01s',{exitCode:0}).outcome,'inconsistent');
assert.equal(summarizePytest('nonsense',{exitCode:0}).outcome,'unknown');
assert.equal(summarizePytest('1 passed in 0.01s',{exitCode:0,timedOut:true}).outcome,'timed_out');
assert.equal(summarizePytest('1 passed in 0.01s',{exitCode:0,outputLimited:true}).outcome,'output_limit');
const bounded=summarizePytest(Array.from({length:1000},(_,i)=>`FAILED test_a.py::test_${i} - ${'x'.repeat(50)}`).join('\n'));
assert.equal(bounded.failureIds.length,10);assert.ok(bounded.excerpt.length<=3000);
if(!process.argv[2])throw Error('Usage: node scripts/structured-test-check.mjs /path/to/python-with-pytest');
const python=resolve(process.argv[2]);
const cwd=await mkdtemp(join(tmpdir(),'autotoken-pytest-'));
try{
 await writeFile(join(cwd,'test_fixture.py'),'def test_pass():\n    assert True\n\ndef test_fail():\n    assert False\n\ndef test_sleep():\n    import time\n    time.sleep(5)\n');
 const passed=await runPytest({python,cwd,targets:['test_fixture.py::test_pass']});assert.equal(passed.outcome,'passed');assert.equal(passed.pytestExitCode,0);
 const failed=await runPytest({python,cwd,targets:['test_fixture.py::test_fail']});assert.equal(failed.outcome,'failed');assert.equal(failed.pytestExitCode,1);assert.ok(failed.failureIds.includes('test_fixture.py::test_fail'));
 const limited=await runPytest({python,cwd,targets:['test_fixture.py::test_fail'],maxOutputBytes:100});assert.equal(limited.outcome,'output_limit');
 const timeout=await runPytest({python,cwd,targets:['test_fixture.py::test_sleep'],timeoutMs:300});assert.equal(timeout.outcome,'timed_out');
 const spawnError=await runPytest({python:join(cwd,'missing-python'),cwd,targets:['test_fixture.py']});assert.equal(spawnError.outcome,'spawn_error');assert.equal(spawnError.statusKnown,false);
 const absent=await runPytest({python,cwd,targets:['missing.py']});assert.equal(absent.outcome,'usage_error');
 await assert.rejects(runPytest({python,cwd,targets:['--help']}));
 await assert.rejects(runPytest({python,cwd,targets:['../test.py']}));
 console.log('Parser uncertainty/bounds checks and actual pytest pass, failure, output-limit, timeout, spawn-error, missing-target, argument checks passed');
}finally{await rm(cwd,{recursive:true,force:true});}
