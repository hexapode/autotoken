import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {seedPydicomFixtures,publicInventoryTask} from '../src/warm-workspace.js';
test('warm public task excludes gold patches and requires pinned local identity',()=>{
 const task={instance_id:'pydicom__pydicom-1',repo:'pydicom/pydicom',base_commit:'a'.repeat(40),problem_statement:'bug',patch:'GOLD',test_patch:'GOLD',hints_text:'HINT'};
 const options={execution:'local',instance:task.instance_id,revision:'b'.repeat(40),split:'dev'};
 const clean=publicInventoryTask(task,options);assert.ok(!JSON.stringify(clean).includes('GOLD'));assert.ok(!JSON.stringify(clean).includes('HINT'));
 assert.throws(()=>publicInventoryTask(task,{...options,instance:'other'}));assert.throws(()=>publicInventoryTask(task,{...options,execution:'docker'}));
});
test('fixture seeding copies only bytes matching pristine public checksums',async t=>{
 const root=await mkdtemp(join(tmpdir(),'autotoken-warm-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const repo=join(root,'repo'),source=join(root,'source'),home=join(root,'home');await mkdir(join(repo,'pydicom/data'),{recursive:true});await mkdir(join(source,'.pydicom/data'),{recursive:true});
 const bytes=Buffer.from('public fixture'),hash=createHash('sha256').update(bytes).digest('hex');
 await writeFile(join(repo,'pydicom/data/hashes.json'),JSON.stringify({'ok.dcm':hash,'bad.dcm':hash,'../escape':hash}));
 await writeFile(join(source,'.pydicom/data/ok.dcm'),bytes);await writeFile(join(source,'.pydicom/data/bad.dcm'),'modified');
 const result=await seedPydicomFixtures(repo,home,source);assert.equal(result.copied,1);assert.deepEqual(await readFile(join(home,'.pydicom/data/ok.dcm')),bytes);assert.deepEqual(await readdir(join(home,'.pydicom/data')),['ok.dcm']);
});
