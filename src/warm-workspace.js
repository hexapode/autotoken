import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {createHash} from 'node:crypto';

// Copy only public fixtures whose bytes match the freshly checked-out commit.
// No source tree, learned patch, environment, or home configuration is reused.
export async function seedPydicomFixtures(repo,home,sourceHome){
 let hashes;try{hashes=JSON.parse(await readFile(join(repo,'pydicom/data/hashes.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return {copied:0,bytes:0};throw e;}
 const destination=join(home,'.pydicom','data');let copied=0,bytes=0;
 for(const [name,hash] of Object.entries(hashes)){
  if(basename(name)!==name||name==='.'||name==='..'||! /^[a-f0-9]{64}$/i.test(hash))continue;
  let data;try{data=await readFile(join(sourceHome,'.pydicom','data',name));}catch(e){if(e.code==='ENOENT')continue;throw e;}
  if(createHash('sha256').update(data).digest('hex')!==hash.toLowerCase())continue;
  await mkdir(destination,{recursive:true});await writeFile(join(destination,name),data,{mode:0o600});copied++;bytes+=data.length;
 }
 return {copied,bytes};
}
export function publicInventoryTask(task,options){
 if(options.execution!=='local'||task.instance_id!==options.instance||! /^[a-f0-9]{40}$/.test(task.base_commit)||! /^[a-f0-9]{40}$/.test(options.revision||''))throw Error('Invalid pinned local task');
 if(!['marshmallow-code/marshmallow','pydicom/pydicom','pylint-dev/astroid','asottile/pyupgrade'].includes(task.repo)||typeof task.problem_statement!=='string')throw Error('Unsupported public task');
 return {instance_id:task.instance_id,repo:task.repo,base_commit:task.base_commit,problem_statement:task.problem_statement,version:task.version,dataset:options.dataset,split:options.split,revision:options.revision};
}
