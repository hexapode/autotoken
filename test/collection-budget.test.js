import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollectionBudget, requestReservation } from '../src/collection-budget.js';
const body = Buffer.from(JSON.stringify({model:'gpt-6.1-sol', max_output_tokens:8192, input:'test'}));
test('budget reserves before dispatch, persists across resumes, rejects overspend', t => {
 const root=mkdtempSync(join(tmpdir(),'m2c-budget-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const file=join(root,'ledger.json');const reservation=requestReservation(body);
 const b=new CollectionBudget(file,{requests:{},budgetUsd:reservation*1.5,targetQueries:10});
 b.reserve({traceId:'a',body});assert.equal(JSON.parse(readFileSync(file)).requests.a.state,'reserved');
 const resumed=new CollectionBudget(file,JSON.parse(readFileSync(file)));
 assert.throws(()=>resumed.reserve({traceId:'b',body}),/dollar budget/);
 resumed.settle({id:'a',state:'complete',response:{status:'completed',usage:{input_tokens:100,output_tokens:10}}});
 resumed.reserve({traceId:'b',body});assert.equal(resumed.attempts,2);
 resumed.settle({id:'b',state:'failed'});assert.equal(resumed.state.requests.b.charged,reservation);
});
test('budget enforces query cap and rejects non-text/context/tier bypasses', t => {
 const root=mkdtempSync(join(tmpdir(),'m2c-budget-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const b=new CollectionBudget(join(root,'ledger'),{requests:{},budgetUsd:10,targetQueries:1});
 b.reserve({traceId:'a',body});assert.throws(()=>b.reserve({traceId:'b',body}),/query limit/);
 for(const extra of [{service_tier:'priority'},{previous_response_id:'abc'},{input:[{type:'input_image',image_url:'x'}]},{max_output_tokens:100000}]) {
 assert.throws(()=>requestReservation(Buffer.from(JSON.stringify({...JSON.parse(body),...extra}))));
 }
 assert.throws(()=>requestReservation(Buffer.from(JSON.stringify({...JSON.parse(body),input:'x'.repeat(130000)}))));
});
test('external experiment allocations reduce collection budget without inflating query counts', t => {
 const root=mkdtempSync(join(tmpdir(),'m2c-budget-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const b=new CollectionBudget(join(root,'ledger'),{requests:{},budgetUsd:1,targetQueries:10,externalCosts:[{charged:.99,source:'paired-trial'}]});
 assert.equal(b.attempts,0);assert.equal(b.charged,.99);
 assert.throws(()=>b.reserve({traceId:'a',body}),/dollar budget/);
});
