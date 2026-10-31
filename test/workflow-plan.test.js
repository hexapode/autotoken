import test from 'node:test';
import assert from 'node:assert/strict';
import { expandPlan } from '../src/workflow-plan.js';

const issues = ['pylint-dev__astroid-1903', 'pylint-dev__astroid-1959', 'pylint-dev__astroid-1978', 'pydicom__pydicom-1413', 'pydicom__pydicom-1633', 'pydicom__pydicom-1674'];
const inventory = { dataset: 'princeton-nlp/SWE-bench', revision: 'a'.repeat(40), split: 'dev', tasks: issues.map(instance_id => ({ instance_id })) };
const plan = { version: 1, issues, repeats: 2 };

test('expanded trial gives each issue two distinct three-arm blocks with stable resume keys', () => {
 const runs=expandPlan(plan,inventory);
 assert.equal(runs.length,36);
 assert.equal(new Set(runs.map(r=>r.key)).size,36);
 assert.deepEqual(expandPlan(plan,inventory),runs);
 for(const instance of issues)for(const repeat of [1,2]) {
  const block=runs.filter(r=>r.instance===instance&&r.repeat===repeat);
  assert.deepEqual(block.map(r=>r.arm).sort(),['baseline','singleton','workflow']);
  for(const r of block)assert.equal(r.key,`${instance}-r${repeat}-${r.arm}`);
 }
});

test('six-arm-order rotation balances every arm across positions without mixing block identities', () => {
 const runs=expandPlan(plan,inventory);
 const blocks=[];
 for(let i=0;i<runs.length;i+=3) {
  const block=runs.slice(i,i+3);
  assert.ok(block.every(r=>r.instance===block[0].instance&&r.repeat===block[0].repeat));
  blocks.push(block.map(r=>r.arm));
 }
 for(let offset=0;offset<blocks.length;offset+=6) {
  const cycle=blocks.slice(offset,offset+6);
  assert.equal(new Set(cycle.map(b=>b.join(','))).size,6);
  for(let position=0;position<3;position++)for(const arm of ['baseline','singleton','workflow'])assert.equal(cycle.filter(b=>b[position]===arm).length,2);
 }
});

test('plan rejects duplicate, unknown or empty issues and nondevelopment inventory', () => {
 for(const selected of [[],[issues[0],issues[0]],['unknown__repo-123'],['']])assert.throws(()=>expandPlan({...plan,issues:selected},inventory));
 assert.throws(()=>expandPlan(plan,{...inventory,split:'test'}));
 assert.throws(()=>expandPlan(plan,{...inventory,split:'train'}));
});

test('plan repeat limits cannot silently undercount or create unbounded paid work', () => {
 for(const repeats of [0,-1,6,1.5,Infinity,NaN,'2',null,undefined])assert.throws(()=>expandPlan({...plan,repeats},inventory));
 assert.equal(expandPlan({...plan,repeats:1},inventory).length,18);
 assert.equal(expandPlan({...plan,repeats:5},inventory).length,90);
});

test('malformed inventory cannot authorize an empty issue ID or unsupported plan version', () => {
 assert.throws(()=>expandPlan({...plan,issues:['']},{...inventory,tasks:[{instance_id:''}]}));
 assert.throws(()=>expandPlan({...plan,version:2},inventory));
 assert.throws(()=>expandPlan({...plan,version:undefined},inventory));
});
