import {createServer} from 'node:http';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync,renameSync,appendFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PATCH_REVIEW,features,localDecision,validateDecision,compileDecision,apiDecision,observe} from './decision-router.js';

export function makeDecisionServer(artifact,{token,directory,backend='local',api={},decide=apiDecision}={}){
 if(typeof token!=='string'||token.length<16)throw Error('PROXY_TOKEN must be at least 16 characters');
 if(artifact?.version!==1||artifact.program?.id!==PATCH_REVIEW.id||!['local','api'].includes(backend))throw Error('Invalid router configuration');
 // No serving-policy promotion based on replay labels. The saved candidate may learn,
 // but the loaded serving snapshot remains immutable for reproducible evaluation.
 const serving=structuredClone(artifact),candidate=structuredClone(artifact.policy),pending=new Map(),observed=new Set();
 const root=resolve(directory);mkdirSync(root,{recursive:true,mode:0o700});
 const emit=value=>appendFileSync(join(root,'events.jsonl'),JSON.stringify(value)+'\n',{mode:0o600});
 const persist=()=>{const file=join(root,'candidate.json');writeFileSync(file+'.tmp',JSON.stringify({...serving,policy:candidate,status:'shadow',deploymentEligible:false},null,2),{mode:0o600});renameSync(file+'.tmp',file);};
 const server=createServer(async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  const actual=Buffer.from(req.headers.authorization||''),expected=Buffer.from(`Bearer ${token}`);
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return send(401,{error:'Unauthorized'});
  if(req.headers.origin)return send(403,{error:'Browser-origin requests are not supported'});
  try{
   if(req.method==='GET'&&req.url==='/health')return send(200,{mode:'shadow-decision',backend,program:PATCH_REVIEW.id,updates:candidate.updates});
   if(req.method!=='POST'||!['/decision','/outcomes'].includes(req.url))return send(404,{error:'Not found'});
   if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'Use application/json'});
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>100000)throw Error('Request exceeds 100 KB');}
   const body=JSON.parse(raw);
   if(req.url==='/decision'){
    features(body.context);
    if(typeof body.issueId!=='string'||!body.issueId||body.issueId.length>200)throw Error('issueId is required for split-safe feedback');
    let decision,usage=null,error=null;
    try{
     if(backend==='api'){const result=await decide(body.context,PATCH_REVIEW,api);decision=validateDecision(result.decision);usage=result.usage;}
     else {const result=localDecision(serving.policy,body.context,serving.threshold);const {score,...choice}=result;decision=validateDecision(choice);}
    }catch{decision={route:'model'};error='Decision unavailable; fell back to model';}
    const id=randomUUID();pending.set(id,{context:body.context,issueId:body.issueId});if(pending.size>1000)pending.delete(pending.keys().next().value);
    const result={requestId:id,route:'model',mode:'shadow',shadowDecision:decision,proposedAction:compileDecision(decision),usage,error};
    emit({kind:'decision',at:new Date().toISOString(),...result,issueId:body.issueId,context:body.context});return send(200,result);
   }
   const previous=pending.get(body.requestId);
   if(!previous||observed.has(body.requestId))throw Error('Unknown, expired, or already labeled decision');
   if(serving.evaluationIssues?.includes(previous.issueId))throw Error('Held-out issue feedback cannot train the candidate');
   if(body.evidence!=='replay-action-match'||typeof body.compatible!=='boolean')throw Error('Expected explicit replay-action-match feedback; task success is not inferred');
   const probability=observe(candidate,previous.context,body.compatible);observed.add(body.requestId);pending.delete(body.requestId);
   emit({kind:'outcome',at:new Date().toISOString(),requestId:body.requestId,issueId:previous.issueId,evidence:body.evidence,compatible:body.compatible,priorScore:probability});persist();
   return send(200,{updated:'candidate-only',updates:candidate.updates,servingPolicyChanged:false});
  }catch(e){send(400,{error:e.message});}
 });
 server.requestTimeout=35000;return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [file,directory='.autotoken/router',portArg='3002']=process.argv.slice(2);if(!file)throw Error('Usage: decision-server ROUTER_JSON [STATE_DIRECTORY] [PORT]');
  const port=Number(portArg);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
  const provider=process.env.ROUTER_PROVIDER||'anthropic';
  const server=makeDecisionServer(JSON.parse(readFileSync(file,'utf8')),{token:process.env.PROXY_TOKEN,directory,backend:process.env.ROUTER_BACKEND||'local',api:{provider,base:process.env.ROUTER_BASE_URL,model:process.env.ROUTER_MODEL,key:provider==='anthropic'?process.env.ANTHROPIC_API_KEY:(process.env.LLM_API_KEY||process.env.OPENAI_API_KEY)}});
  server.listen(port,'127.0.0.1',()=>console.log(`Autotoken shadow decision API: http://127.0.0.1:${port}`));
  const stop=()=>{server.closeAllConnections();server.close();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 }catch(e){console.error(e.message);process.exitCode=1;}
}
