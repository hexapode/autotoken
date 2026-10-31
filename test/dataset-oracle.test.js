import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDatasetOracle,scoreOracleResults} from '../src/dataset-oracle.js';
const patch='diff --git a/tests/test_a.py b/tests/test_a.py\n--- a/tests/test_a.py\n+++ b/tests/test_a.py\n@@ -1 +1 @@\n-old\n+new\n';
test('oracle accepts test-only patch and literal node IDs',()=>{assert.deepEqual(validateDatasetOracle({test_patch:patch,FAIL_TO_PASS:['tests/test_a.py::test_x[a b]']}).targets,['tests/test_a.py::test_x[a b]']);});
test('oracle rejects source edits, escaping targets and duplicate tests',()=>{for(const o of [{test_patch:patch.replaceAll('tests/test_a.py','src/a.py'),FAIL_TO_PASS:['tests/test_a.py']},{test_patch:patch,FAIL_TO_PASS:['../tests/test_a.py']},{test_patch:patch,FAIL_TO_PASS:['tests/test_a.py','tests/test_a.py']}])assert.throws(()=>validateDatasetOracle(o));});
const baseline={code:1,timedOut:false,cases:[{failed:true,assertionFailure:true,error:false,skipped:false}]},patched={code:0,timedOut:false,cases:[{failed:false,error:false,skipped:false}]};
test('oracle requires before assertion failure and after clean pass',()=>assert.equal(scoreOracleResults(baseline,patched,1).passed,true));
test('oracle rejects import errors, skips, nonassertion failures, missing cases and timeout',()=>{for(const bad of [{...baseline,cases:[{failed:true,assertionFailure:false}]},{...baseline,cases:[{error:true}]},{...baseline,cases:[{skipped:true}]},{...baseline,cases:[]},{...baseline,timedOut:true}])assert.equal(scoreOracleResults(bad,patched,1).passed,false);assert.equal(scoreOracleResults(baseline,{...patched,cases:[{skipped:true}]},1).passed,false);});
