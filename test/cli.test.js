import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {proxyConfig} from '../src/cli-config.js';
test('CLI config supports native Anthropic, arbitrary compatible APIs and keyless local Ollama',()=>{
 const env={PROXY_TOKEN:'local',ANTHROPIC_API_KEY:'upstream'};
 assert.equal(proxyConfig(['--provider','anthropic'],env).upstreamAuth,'x-api-key');
 assert.equal(proxyConfig(['--provider','anthropic'],env).upstreamKey,'upstream');
 assert.equal(proxyConfig(['--provider','ollama'],env).upstreamAuth,'none');
 assert.equal(proxyConfig(['--provider','compatible','--upstream','https://example.com/custom/v1'],env).upstreamBase,'https://example.com/custom/v1');
 assert.throws(()=>proxyConfig(['--provider','compatible'],env),/require/);
 assert.throws(()=>proxyConfig(['--provider','ollama','--upstream','http://example.com/v1'],env),/local only/);
 assert.throws(()=>proxyConfig(['--port','-1'],env),/Port/);
});
test('init creates private random config, excludes traces, and refuses overwrites',async t=>{
 const cwd=await mkdtemp(join(tmpdir(),'autotoken-cli-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 const cli=resolve('bin/autotoken.js');execFileSync(process.execPath,[cli,'init'],{cwd,stdio:'pipe'});
 const original=await readFile(join(cwd,'.autotoken.env'),'utf8');assert.match(original,/PROXY_TOKEN=[a-f0-9]{48}/);
 assert.equal((await stat(join(cwd,'.autotoken.env'))).mode&0o777,0o600);
 assert.match(await readFile(join(cwd,'.gitignore'),'utf8'),/\.autotoken\//);
 assert.throws(()=>execFileSync(process.execPath,[cli,'init'],{cwd,stdio:'pipe'}));assert.equal(await readFile(join(cwd,'.autotoken.env'),'utf8'),original);
});
