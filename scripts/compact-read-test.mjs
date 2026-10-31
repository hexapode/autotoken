import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {parseCompactReads,compactArguments,readMany,LIMITS} from './compact-read.mjs';
const root=await mkdtemp(join(tmpdir(),'autotoken-compact-read-'));const checks=[];
try{
 await mkdir(join(root,'tests'));await writeFile(join(root,'a.py'),'alpha\n\ngamma\ndelta\n');await writeFile(join(root,'tests/b.py'),'one\ntwo');
 const ranges=parseCompactReads("sed -n '2,3p' a.py; head -1 tests/b.py; nl -ba a.py | sed -n '4p'");assert.deepEqual(ranges,[['a.py',2,3],['tests/b.py',1,1],['a.py',4,4]]);
 const packet=await readMany(root,compactArguments(ranges));assert.deepEqual(packet.results.map(r=>r.rows),[[{line:2,text:''},{line:3,text:'gamma'}],[{line:1,text:'one'}],[{line:4,text:'delta'}]]);checks.push('ordered multi-file reads preserve blank lines and original line numbers');
 const duplicate=await readMany(root,{r:[['a.py',1,1],[null,3,3]]});assert.equal(duplicate.results[1].rows[0].text,'gamma');checks.push('null path reuses previous file without expanding ranges');
 assert.deepEqual(parseCompactReads('cat a.py | head -2'),[['a.py',1,2]]);assert.equal(parseCompactReads('sed -n 1,2p a.py; rm a.py'),null);assert.equal(parseCompactReads('cat ../escape'),null);assert.equal(parseCompactReads('cat $(pwd)'),null);checks.push('mixed commands and shell expansion abstain');
 const eof=await readMany(root,{r:[['tests/b.py',1,null]]});assert.equal(eof.results[0].rows.length,2);checks.push('EOF handling avoids phantom final line');
 await writeFile(join(root,'long.py'),('x\n').repeat(1000));const limited=await readMany(root,{r:[['long.py',1,1000]]});assert.equal(limited.linesEmitted,LIMITS.maxLines);assert.equal(limited.truncated,true);checks.push('line budget marks truncation');
 await writeFile(join(root,'escaped.py'),('\t'.repeat(200)+'\n').repeat(100));const escaped=await readMany(root,{r:[['escaped.py',1,null]]});assert(Buffer.byteLength(JSON.stringify(escaped))<=LIMITS.maxOutputBytes);assert(escaped.truncated);checks.push('serialized JSON byte cap includes escaped content and metadata');
 await symlink('/etc/hosts',join(root,'link'));await assert.rejects(readMany(root,{r:[['link',1,3]]}),/Symlink/);await assert.rejects(readMany(root,{r:[['../escape',1,3]]}),/Invalid range/);checks.push('symlink and traversal rejection');
 execFileSync('/usr/bin/mkfifo',[join(root,'pipe')]);await assert.rejects(readMany(root,{r:[['pipe',1,3]]}),/File budget/);checks.push('FIFO rejected without blocking');
 await writeFile(join(root,'large.py'),'x'.repeat(LIMITS.maxFileBytes+1));await assert.rejects(readMany(root,{r:[['large.py',1,2]]}),/File budget/);checks.push('file byte cap enforced before reading');
 const out='data/analysis/compact-read-v1';await mkdir(out,{recursive:true});await writeFile(`${out}/fixture.json`,JSON.stringify({checks,limits:LIMITS},null,2),{mode:0o600});console.log(JSON.stringify({passed:checks.length,checks},null,2));
}finally{await rm(root,{recursive:true,force:true});}
