import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorkflowPool} from '../src/workflow-pool.js';
import {CollectionBudget,requestReservation} from '../src/collection-budget.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const schedule=Array.from({length:4},(_,i)=>['baseline','singleton','workflow'].map(arm=>({instance:`issue${i}`,repeat:1,arm}))).flat();
test('workers overlap blocks, preserve arm order, and run each job once',async()=>{
 let active=0,peak=0;const seen=new Map();
 await runWorkflowPool(schedule,3,async s=>{
  active++;peak=Math.max(active,peak);
  const list=seen.get(s.instance)||[];list.push(s.arm);seen.set(s.instance,list);
  await new Promise(r=>setTimeout(r,5));active--;
 });
 assert.equal(peak,3);assert.equal(seen.size,4);
 for(const arms of seen.values())assert.deepEqual(arms,['baseline','singleton','workflow']);
});
test('concurrent workers cannot overbook one shared durable budget',async t=>{
 const root=mkdtempSync(join(tmpdir(),'autotoken-pool-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const body=Buffer.from(JSON.stringify({model:'claude-opus-5-5',max_tokens:8192,messages:[]}));
 const reservation=requestReservation(body,'claude-opus-5-5');
 const b=new CollectionBudget(join(root,'ledger'),{model:'claude-opus-5-5',budgetUsd:reservation*2.5,targetQueries:99,requests:{}});
 let stopped=false,accepted=0;
 await runWorkflowPool(schedule,3,async s=>{
  try{b.reserve({traceId:`${s.instance}-${s.arm}`,body});accepted++;}catch{stopped=true;}
  await new Promise(r=>setTimeout(r,5));
 },()=>stopped);
 assert.equal(accepted,2);assert.ok(b.charged<=b.state.budgetUsd);
});
test('draining finishes active work without starting more arms',async()=>{
 let stop=false,finished=0;
 await runWorkflowPool(schedule,3,async()=>{stop=true;await new Promise(r=>setTimeout(r,5));finished++;},()=>stop);
 assert.equal(finished,1);
});
