import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,brotliCompressSync,deflateSync} from 'node:zlib';
import {inspectResponse} from '../src/trace.js';
test('compressed Anthropic SSE recovers complete usage and tools without changing raw bytes',()=>{
 const raw=Buffer.from([
  {type:'message_start',message:{usage:{input_tokens:10,output_tokens:0,cache_read_input_tokens:20}}},
  {type:'content_block_start',index:0,content_block:{type:'tool_use',id:'t1',name:'local_bash',input:{command:'pwd'}}},
  {type:'message_delta',usage:{output_tokens:5},delta:{stop_reason:'tool_use'}},
  {type:'message_stop'}
 ].map(x=>`data: ${JSON.stringify(x)}\n\n`).join(''));
 for(const [encoding,compress] of [['gzip',gzipSync],['br',brotliCompressSync],['deflate',deflateSync]]){
  const bytes=compress(raw),copy=Buffer.from(bytes);
  const p=inspectResponse(bytes,{'content-type':'text/event-stream','content-encoding':encoding},'/v1/messages');
  assert.equal(p.status,'completed');assert.equal(p.usage.total_tokens,35);assert.equal(p.output[0].input.command,'pwd');assert.deepEqual(bytes,copy);
 }
});
test('invalid or oversized compression leaves usage unknown',()=>{
 for(const b of [Buffer.from('broken'),gzipSync(Buffer.alloc(17*1024*1024))]){
  const p=inspectResponse(b,{'content-encoding':'gzip'},'/v1/messages');assert.equal(p.usage,null);assert.ok(p.parseError);
 }
});
