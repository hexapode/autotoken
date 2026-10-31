import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {READ_RANGE_POLICY,readRangeTool,planReadRangeRepair,runReadRangeTool} from '../src/read-range-tool.js';
async function fixture(t,count=189){const root=await mkdtemp(join(tmpdir(),'autotoken-range-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(join(root,'source.py'),Array.from({length:count},(_,i)=>`line ${i+1}`).join('\n')+'\n');return root;}
const args=(range,path='/workspace/source.py')=>({command:'view',path,...(range?{view_range:range}:{})});
test('baseline manual retry and treatment automatic retry return identical real source',async t=>{
 const root=await fixture(t),before=await readFile(join(root,'source.py'),'utf8'),request=args([152,200]),events=[];
 const baseline=await runReadRangeTool({root,args:request});
 assert.equal(baseline.metadata.code,'end_out_of_range');assert.equal(baseline.metadata.repairAttempted,false);
 assert.equal(baseline.text,'ERROR:\nInvalid `view_range` parameter: [152, 200]. Its second element `200` should be smaller than the number of lines in the file: `189`.');
 const planned=planReadRangeRepair(request,baseline.text);assert.deepEqual(planned,args([152,189]));
 const manual=await readRangeTool({root,args:planned});
 const automatic=await runReadRangeTool({root,args:request,repair:true,onRetry:event=>events.push(event)});
 assert.equal(automatic.text,manual.text);assert.equal(automatic.metadata.repairSucceeded,true);assert.equal(automatic.metadata.returnedLines,38);assert.equal(events.length,1);assert.deepEqual(events[0].retryArgs,planned);
 assert.match(automatic.text,/189\tline 189/);assert.equal(await readFile(join(root,'source.py'),'utf8'),before);
});
test('same valid requests have identical text in both arms and never retry',async t=>{
 const root=await fixture(t),events=[];
 const baseline=await runReadRangeTool({root,args:args([1,10])});const treatment=await runReadRangeTool({root,args:args([1,10]),repair:true,onRetry:e=>events.push(e)});
 assert.equal(baseline.text,treatment.text);assert.deepEqual(baseline.metadata,treatment.metadata);assert.deepEqual(events,[]);
});
test('planner abstains on unsupported ranges, changed evidence, extra fields and retries',async t=>{
 const root=await fixture(t),request=args([152,200]),{text}=await readRangeTool({root,args:request});
 assert.equal(planReadRangeRepair(request,text,{retries:1}),null);
 assert.equal(planReadRangeRepair(request,text.replace('`189`','`100`')),null);
 assert.equal(planReadRangeRepair(request,text.replace('[152, 200]','[151, 200]')),null);
 assert.equal(planReadRangeRepair({...request,new_str:'unexpected'},text),null);
 assert.equal(planReadRangeRepair(args([1,1000]),text),null);
 assert.equal(planReadRangeRepair(args([152,-1]),text),null);
 assert.equal(planReadRangeRepair(request,'ERROR: unrelated'),null);
});
test('lower-bound errors and request caps fall back without retry',async t=>{
 const root=await fixture(t);let attempts=0;
 for(const range of [[190,200],[1,251],[0,10],[5,3],[1,'2']]){
  const result=await runReadRangeTool({root,args:args(range),repair:true,onRetry:()=>attempts++});assert.equal(result.metadata.status,'error');assert.equal(result.metadata.repairAttempted,false);
 }
 assert.equal(attempts,0);
});
test('default and EOF views are bounded and expose total line count',async t=>{
 const root=await fixture(t,400);
 const value=await readRangeTool({root,args:args()});assert.equal(value.metadata.returnedLines,200);assert.equal(value.metadata.totalLines,400);assert.equal(value.metadata.truncated,true);assert.match(value.text,/Total lines: 400/);
 const eof=await readRangeTool({root,args:args([100,-1])});assert.equal(eof.metadata.returnedLines,250);assert.equal(eof.metadata.end,349);assert.equal(eof.metadata.truncated,true);
});
test('file bytes, output bytes, binary and invalid UTF-8 are bounded',async t=>{
 const root=await fixture(t);
 await writeFile(join(root,'large.py'),Buffer.alloc(READ_RANGE_POLICY.maxFileBytes+1,65));assert.equal((await readRangeTool({root,args:args(null,'/workspace/large.py')})).metadata.code,'file_limit');
 await writeFile(join(root,'wide.py'),'🙂'.repeat(20000));const wide=await readRangeTool({root,args:args(null,'/workspace/wide.py')});assert.ok(Buffer.byteLength(wide.text)<=READ_RANGE_POLICY.maxOutputBytes);assert.equal(wide.metadata.truncated,true);
 await writeFile(join(root,'binary.py'),Buffer.from([65,0,66]));assert.equal((await readRangeTool({root,args:args(null,'/workspace/binary.py')})).metadata.code,'binary_file');
 await writeFile(join(root,'invalid.py'),Buffer.from([255]));assert.equal((await readRangeTool({root,args:args(null,'/workspace/invalid.py')})).metadata.code,'invalid_encoding');
});
test('traversal, symlinks, FIFO, directories and unsupported commands are rejected',async t=>{
 const root=await fixture(t);await mkdir(join(root,'folder'));await symlink(join(root,'source.py'),join(root,'link.py'));await symlink(join(root,'folder'),join(root,'dir-link'));execFileSync('mkfifo',[join(root,'fifo')]);
 for(const path of ['/workspace/../source.py','/workspace/./source.py','/etc/passwd','/workspace//source.py','/workspace/link.py','/workspace/dir-link/source.py','/workspace/fifo','/workspace/folder']){
  const result=await readRangeTool({root,args:args(null,path)});assert.equal(result.metadata.status,'error',path);
 }
 assert.equal((await readRangeTool({root,args:{command:'str_replace',path:'/workspace/source.py'}})).metadata.status,'error');
});
test('empty files and terminal newline counts remain consistent',async t=>{
 const root=await fixture(t);await writeFile(join(root,'empty.py'),'');await writeFile(join(root,'one.py'),'one\n');
 const empty=await readRangeTool({root,args:args(null,'/workspace/empty.py')});assert.equal(empty.metadata.totalLines,0);assert.equal(empty.metadata.returnedLines,0);
 assert.equal((await readRangeTool({root,args:args([1,1],'/workspace/empty.py')})).metadata.code,'start_out_of_range');
 assert.equal((await readRangeTool({root,args:args([1,1],'/workspace/one.py')})).metadata.totalLines,1);
});
