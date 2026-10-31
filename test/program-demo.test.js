import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {demoFixture,runDemoProgram} from '../src/program-demo.js';
test('offline program demo executes real tools, rejects unsupported input, and preserves fixture',async t=>{
 const root=await demoFixture();t.after(()=>rm(root,{recursive:true,force:true}));const before=await readFile(join(root,'checkout.py'),'utf8');
 for(const id of ['search','read','patch']){const output=await runDemoProgram(root,id);assert.equal(output.result.status,'ok');assert.ok(output.display.length>0);}
 assert.equal((await runDemoProgram(root,'fallback')).result.status,'abstained');assert.equal(await readFile(join(root,'checkout.py'),'utf8'),before);
});
