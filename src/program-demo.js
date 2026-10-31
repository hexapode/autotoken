import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {searchContext} from './search-context.js';
import {runReadContext} from './read-context.js';
import {patchReview} from './patch-review.js';
import {PROGRAM_DEMO_HTML} from './program-demo-page.js';

export async function demoFixture(){
 const root=await mkdtemp(join(tmpdir(),'autotoken-programs-'));
 const source=['# Small public demo fixture: a checkout calculation.','','def validate_item(item):','    return item["quantity"] >= 0','','def calculate_total(items, discount=0):','    subtotal = sum(item["price"] * item["quantity"] for item in items)','    return subtotal','','def receipt_label(total):','    return f"Total: {total:.2f}"',''].join('\n');
 await writeFile(join(root,'checkout.py'),source);
 const git=args=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','user.name=Autotoken demo','-c','user.email=demo@example.invalid',...args],{cwd:root,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},stdio:'pipe'});
 git(['init','-q']);git(['add','checkout.py']);git(['commit','-qm','Demo fixture']);
 await writeFile(join(root,'checkout.py'),source.replace('return subtotal','return max(0, subtotal - discount)'));
 return root;
}
export async function runDemoProgram(root,id){
 let input,result,display,note;
 if(id==='search'||id==='fallback'){
  input={query:id==='search'?'calculate_total':'(?=secret)',paths:['checkout.py'],mode:id==='search'?'literal':'regex',before:2,after:4};
  result=await searchContext({root,...input,limits:{maxLines:30,maxOutputBytes:4096}});
  display=result.status==='ok'?result.ranges.map(r=>`${r.path}:${r.start}-${r.end}\n`+r.lines.map(l=>`${l.number}: ${l.text}`).join('\n')).join('\n\n'):JSON.stringify(result,null,2);
  note=id==='search'?'Actual bounded program output from the fixture; no claim that a model call was saved.':'Unsupported syntax returns abstention; an integrating caller would fall back to its model.';
 }else if(id==='read'){
  input={ranges:[{file:'checkout.py',start:6,end:8}]};result=await runReadContext(root,input.ranges);display=result.text||JSON.stringify(result);note='Fixed ±40-line expansion, capped at 200 lines. Extra context is not automatically useful.';
 }else if(id==='patch'){
  input={scope:'current fixture patch'};result=await patchReview(root);display=result.results.map(r=>`[${r.name}] exit ${r.exitCode}\n${r.output||'(no findings)'}`).join('\n\n');note='Fixed read-only Git operations with bounded output; no shell commands are supplied by the user.';
 }else throw Error('Unknown demo program');
 return {input,result,display,note};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const root=await demoFixture();
 if(process.argv.includes('--serve')){
  const server=createServer(async(req,res)=>{try{if(['/demo-app.js','/context-core.js'].includes(req.url)){res.writeHead(200,{'content-type':'text/javascript'});return res.end(await readFile(new URL(req.url==='/demo-app.js'?'./program-demo-app.js':'./context-core.js',import.meta.url)));}if(req.url==='/'){res.writeHead(200,{'content-type':'text/html'});return res.end(PROGRAM_DEMO_HTML);}const url=new URL(req.url,'http://localhost');if(req.method!=='GET'||url.pathname!=='/api/program-demo'){res.writeHead(404);return res.end();}const result=await runDemoProgram(root,url.searchParams.get('id'));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));}catch{res.writeHead(400);res.end('Unsupported demo request');}});
  server.listen(3003,'127.0.0.1',()=>console.log('Autotoken program demo: http://127.0.0.1:3003 (no model calls)'));
  const stop=()=>{server.closeAllConnections();server.close(()=>rm(root,{recursive:true,force:true}));};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 }else{try{for(const id of ['search','read','patch','fallback'])console.log(JSON.stringify({program:id,...await runDemoProgram(root,id)},null,2));}finally{await rm(root,{recursive:true,force:true});}}
}
