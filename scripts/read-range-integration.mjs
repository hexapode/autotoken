// Real Pi + real read tool + recording proxy; scripted LOCAL provider, no paid calls.
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRecordingServer} from '../src/recording-proxy.js';
const listen=s=>new Promise((ok,no)=>{s.once('error',no);s.listen(0,'127.0.0.1',()=>ok(s.address().port));});
const close=s=>new Promise(ok=>{s.closeAllConnections();s.close(ok);});
const event=x=>`event: ${x.type}\ndata: ${JSON.stringify(x)}\n\n`;
const root=await mkdtemp(join(tmpdir(),'autotoken-read-repair-integration-'));const results=[];let tools;
try{
 for(const arm of ['read-range-baseline','read-range-repair']){
  const directory=join(root,arm),repo=join(directory,'checkout'),agent=join(directory,'agent'),work=join(directory,'work');
  for(const p of [repo,agent,work,join(directory,'venv'),join(directory,'home'),join(directory,'temp')])await mkdir(p,{recursive:true});
  await writeFile(join(repo,'fixture.py'),'one\ntwo\nCONFIRMED_READ_RANGE_SOURCE\n');
  let requests=0,error,upstream,proxy;const prompts=[];
  try{
   upstream=http.createServer(async(req,res)=>{
    try{
     const chunks=[];for await(const c of req)chunks.push(c);const b=JSON.parse(Buffer.concat(chunks));requests++;
     assert.ok(requests<=3);assert.equal(b.model,'claude-opus-5-5');assert.equal(b.stream,true);
     if(!tools)tools=b.tools;else assert.deepEqual(b.tools,tools,'Tool schema/description drift');
     const all=b.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(c=>c.type==='tool_result');
     const last=all.at(-1),text=last?JSON.stringify(last.content):'';
     let args;
     if(!last)args={command:'view',path:'/workspace/fixture.py',view_range:[1,10]};
     else if(text.includes('Invalid `view_range`'))args={command:'view',path:'/workspace/fixture.py',view_range:[1,3]};
     else assert.ok(text.includes('CONFIRMED_READ_RANGE_SOURCE'));
     if(requests===1)prompts.push(b.messages.at(-1));
     res.writeHead(200,{'content-type':'text/event-stream'});
     res.write(event({type:'message_start',message:{id:`msg-${requests}`,type:'message',role:'assistant',model:b.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}}));
     res.write(event({type:'content_block_start',index:0,content_block:args?{type:'tool_use',id:`read-${requests}`,name:'str_replace_editor',input:{}}:{type:'text',text:''}}));
     res.write(event({type:'content_block_delta',index:0,delta:args?{type:'input_json_delta',partial_json:JSON.stringify(args)}:{type:'text_delta',text:'Source confirmed.'}}));
     res.write(event({type:'content_block_stop',index:0}));res.write(event({type:'message_delta',delta:{stop_reason:args?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:5}}));res.end(event({type:'message_stop'}));
    }catch(e){error=e;res.writeHead(500);res.end(JSON.stringify({error:{message:e.message}}));}
   });
   const upstreamPort=await listen(upstream);proxy=createRecordingServer({upstreamBase:`http://127.0.0.1:${upstreamPort}/v1`,upstreamKey:'fixture',upstreamAuth:'x-api-key',proxyToken:'fixture-local',directory:join(directory,'traces')});
   const port=await listen(proxy);
   await writeFile(join(agent,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${port}`,api:'anthropic-messages',apiKey:'fixture-local',models:[{id:'claude-opus-5-5',name:'Local fixture',reasoning:true,compat:{forceAdaptiveThinking:true},input:['text'],contextWindow:32000,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}));
   const output=await new Promise((ok,no)=>{
    const child=spawn(process.execPath,[resolve('node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'),'--offline','--no-extensions','-e',resolve('eval/swebench/read-range-extension.ts'),'--no-skills','--no-context-files','--no-prompt-templates','--no-mcp','--no-session','--no-approve','--tools','local_bash,str_replace_editor','--provider','fixture','--model','claude-opus-5-5','--thinking','medium','--print','Read /workspace/fixture.py and confirm its contents.'],{cwd:work,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:tmpdir(),PI_CODING_AGENT_DIR:agent,PI_TELEMETRY:'0',M2C_LOCAL_REPO:repo,M2C_LOCAL_VENV:join(directory,'venv'),M2C_LOCAL_HOME:join(directory,'home'),M2C_LOCAL_TEMP:join(directory,'temp'),M2C_READ_RANGE_ARM:arm,M2C_READ_RANGE_LOG:join(directory,'events.jsonl')},stdio:['ignore','pipe','pipe']});
    let text='';child.stdout.on('data',c=>text+=c);child.stderr.on('data',c=>text+=c);const timer=setTimeout(()=>child.kill('SIGKILL'),30000);child.on('error',no);child.on('close',code=>{clearTimeout(timer);code===0?ok(text):no(Error(`Pi failed: ${text}`));});
   });
   if(error)throw error;assert.match(output,/Source confirmed/);
   const events=(await readFile(join(directory,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
   const retries=events.filter(e=>e.type==='retry');assert.equal(retries.length,arm==='read-range-repair'?1:0);
   assert.equal(requests,arm==='read-range-repair'?2:3);
   results.push({arm,scriptedProviderRequests:requests,readCalls:events.filter(e=>e.type==='read').length,automaticRetries:retries.length,sourceConfirmed:true,prompt:prompts[0]});
  }finally{if(proxy)await close(proxy);if(upstream)await close(upstream);}
 }
 assert.deepEqual(results[0].prompt,results[1].prompt);for(const r of results)delete r.prompt;
 await mkdir('data/experiments',{recursive:true});await writeFile('data/experiments/read-range-integration-v1.json',JSON.stringify({kind:'scripted-local-provider-integration-not-real-model-savings',results},null,2),{mode:0o600});
 console.log(JSON.stringify({kind:'Real Pi/tool/proxy, scripted local provider: integration evidence only',results},null,2));
}finally{await rm(root,{recursive:true,force:true});}
