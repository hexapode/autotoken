"""Download public mini-SWE artifacts with recorded usage; never execute their content."""
import argparse, concurrent.futures, hashlib, json, os, pathlib, re, shutil, time
import urllib.parse, urllib.request, xml.etree.ElementTree as ET

REVISION = '40f164d5b8f1d249bf95a6df8b74b577fd8e519d'
SOURCES = [
 ('sonnet45', '20260217_mini-v2.0.0_claude-4-5-sonnet-high'),
 ('gpt52', '20260217_mini-v2.0.0_gpt-5-2-high'),
 ('deepseek32', '20260217_mini-v2.0.0_deepseek-3-2-high'),
 ('gemini3flash', '20260217_mini-v2.0.0_gemini-3-flash-high'),
 ('opus45', '20260217_mini-v2.0.0_claude-4-5-opus-high'),
]
ROOT = 'https://swe-bench-submissions.s3.amazonaws.com/'
NS = {'s':'http://s3.amazonaws.com/doc/2006-03-01/'}

def fetch(url):
 for attempt in range(4):
  try:
   with urllib.request.urlopen(url, timeout=90) as response:
    return response.read(), dict(response.headers)
  except Exception:
   if attempt==3: raise
   time.sleep(2 ** attempt)

def atom_json(path, value):
 temp=path.with_suffix(path.suffix+'.tmp')
 temp.write_text(json.dumps(value,indent=2)+'\n');os.replace(temp,path)

def usage_summary(trajectory):
 if not isinstance(trajectory,dict) or not isinstance(trajectory.get('messages'),list):raise ValueError('Missing trajectory messages')
 calls=[m for m in trajectory['messages'] if isinstance(m,dict) and (m.get('role')=='assistant' or m.get('object')=='response')]
 if not calls:raise ValueError('No recognizable model responses')
 counts={'modelCalls':len(calls),'callsWithUsage':0,'inputTokens':0,'outputTokens':0,'cachedInputTokens':0,'cacheCreationInputTokens':0,'reasoningOutputTokens':0,'recordedCostUsd':0,'callsWithCost':0}
 for call in calls:
  response=call if call.get('object')=='response' else call.get('extra',{}).get('response',{})
  usage=response.get('usage') or {}
  inp=usage.get('prompt_tokens',usage.get('input_tokens'));out=usage.get('completion_tokens',usage.get('output_tokens'))
  if isinstance(inp,int) and not isinstance(inp,bool) and inp>=0 and isinstance(out,int) and not isinstance(out,bool) and out>=0:
   counts['callsWithUsage']+=1;counts['inputTokens']+=inp;counts['outputTokens']+=out
  details=usage.get('prompt_tokens_details') or usage.get('input_tokens_details') or {}
  counts['cachedInputTokens']+=details.get('cached_tokens') or usage.get('cache_read_input_tokens') or 0
  counts['cacheCreationInputTokens']+=usage.get('cache_creation_input_tokens') or 0
  counts['reasoningOutputTokens']+=(usage.get('completion_tokens_details') or usage.get('output_tokens_details') or {}).get('reasoning_tokens') or 0
  cost=call.get('extra',{}).get('cost')
  if isinstance(cost,(float,int)) and cost>=0:counts['recordedCostUsd']+=cost;counts['callsWithCost']+=1
 counts['reportedApiCalls']=trajectory.get('info',{}).get('model_stats',{}).get('api_calls')
 counts['usageComplete']=counts['callsWithUsage']==counts['modelCalls']
 return counts

def list_source(label,submission,revision,out):
 metadata_url=f'https://raw.githubusercontent.com/SWE-bench/experiments/{revision}/evaluation/verified/{submission}/metadata.yaml'
 metadata,_=fetch(metadata_url);(out/(label+'-metadata.yaml')).write_bytes(metadata)
 match=re.search(r'^\s+trajs: s3://swe-bench-submissions/(\S+)\s*$',metadata.decode(),re.M)
 if not match:raise ValueError('Unsupported source metadata')
 prefix=match[1].rstrip('/')+'/';files=[];token=None;page=0
 while True:
  query={'list-type':'2','prefix':prefix,'max-keys':'1000'}
  if token:query['continuation-token']=token
  data,_=fetch(ROOT+'?'+urllib.parse.urlencode(query));(out/f'{label}-listing-{page}.xml').write_bytes(data);page+=1;tree=ET.fromstring(data)
  for item in tree.findall('s:Contents',NS):
   key=item.find('s:Key',NS).text
   if not key.endswith('.traj.json'):continue
   ident=pathlib.PurePosixPath(key).name.removesuffix('.traj.json')
   if not re.fullmatch(r'[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+-\d+',ident):raise ValueError('Unexpected instance ID')
   files.append({'key':key,'instanceId':ident,'label':label,'bytes':int(item.find('s:Size',NS).text),'etag':item.find('s:ETag',NS).text})
  if tree.find('s:IsTruncated',NS).text=='false':break
  token=tree.find('s:NextContinuationToken',NS).text
 if len({f['instanceId'] for f in files})!=len(files):raise ValueError('Duplicate issue-model trajectory')
 return {'label':label,'submission':submission,'githubRevision':revision,'metadataURL':metadata_url,'metadataSha256':hashlib.sha256(metadata).hexdigest(),'trajectoryPrefix':ROOT+prefix,'availableTrajectories':len(files),'availableBytes':sum(f['bytes'] for f in files)},sorted(files,key=lambda f:f['key'])

def public_summary(manifest):
 files=manifest['files'];sources=[]
 metrics=['modelCalls','callsWithUsage','inputTokens','outputTokens','cachedInputTokens','cacheCreationInputTokens','reasoningOutputTokens','recordedCostUsd','callsWithCost']
 for source in manifest['sources']:
  subset=[f for f in files if f['label']==source['label']]
  sources.append({**source,'downloadedTrajectories':len(subset),'totals':{k:sum(f.get(k,0) for f in subset) for k in metrics}})
 mismatches=[{'label':f['label'],'instanceId':f['instanceId'],'reportedApiCalls':f.get('reportedApiCalls'),'recordedResponses':f['modelCalls']} for f in files if f.get('reportedApiCalls')!=f['modelCalls']]
 return {'version':1,'kind':'official-public-trajectories-recorded-usage','status':manifest['status'],'trajectories':len(files),'uniqueIssues':len({f['instanceId'] for f in files}),'repositories':len({f['instanceId'].rsplit('-',1)[0] for f in files}),'downloadBytes':sum(f['bytes'] for f in files),'selection':manifest['selection'],'sources':sources,'totals':{k:sum(f.get(k,0) for f in files) for k in metrics},'reportedApiCalls':sum(f.get('reportedApiCalls') or 0 for f in files),'unrepresentedReportedCalls':sum((f.get('reportedApiCalls') or f['modelCalls'])-f['modelCalls'] for f in files),'reportedCallMismatches':mismatches,'excludedArtifacts':len(manifest['failures']),'caveats':['Same benchmark issues recur across models; trajectory count is not the number of independent issues.','Input totals already include cached input and cache creation; those fields are subsets, not additional tokens.','Reasoning tokens are included in output totals.','Recorded cost is historical source-harness accounting, not our spending or an independently reconciled invoice.','Each native response is one model call even when it contains multiple tool actions.','Reported API-call counters can exceed stored response records (for example failed attempts); their missing usage is not imputed.','This corpus was not screened for overlap with previous discovery data; it is not held-out evaluation.','Only aggregate counts and source links are published; raw trajectories remain private.']}

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',required=True);parser.add_argument('--reuse-manifest');parser.add_argument('--revision',default=REVISION);parser.add_argument('--workers',type=int,default=16);parser.add_argument('--max-bytes',type=int,default=2000000000);args=parser.parse_args()
 if not re.fullmatch('[a-f0-9]{40}',args.revision) or not 1<=args.workers<=32:raise ValueError('Invalid revision/workers')
 out=pathlib.Path(args.out).absolute();out.mkdir(parents=True,exist_ok=True)
 reuse={}
 for path in [args.reuse_manifest,str(out/'manifest.json')]:
  if path and pathlib.Path(path).exists():
   old=json.loads(pathlib.Path(path).read_text())
   for f in old.get('files',[]):
    if f.get('local') and f.get('sha256'):reuse[(f['label'],f['instanceId'])]=f
 sources=[];jobs=[]
 for label,submission in SOURCES:
  source,files=list_source(label,submission,args.revision,out);sources.append(source);jobs.extend(files)
 planned=sum(f['bytes'] for f in jobs)
 if planned>args.max_bytes:raise ValueError(f'Planned {planned} bytes exceeds cap {args.max_bytes}')
 if shutil.disk_usage(out).free<planned:raise ValueError('Insufficient free disk space')
 manifest={'version':1,'kind':'official-full-trajectories-recorded-usage','status':'downloading','selection':'All trajectory files in five official mini-SWE-agent v2 model submissions; source availability, not outcome. Same benchmark issues recur across models.','plannedTrajectories':len(jobs),'plannedBytes':planned,'maxBytes':args.max_bytes,'sources':sources,'files':[],'failures':[]}
 atom_json(out/'manifest.json',manifest);print(json.dumps({'plannedTrajectories':len(jobs),'plannedBytes':planned}),flush=True)
 def download(f):
  target=out/f['label']/(f['instanceId']+'.traj.json');target.parent.mkdir(exist_ok=True);prior=reuse.get((f['label'],f['instanceId']));data=None;cached=False;headers={}
  if prior and pathlib.Path(prior['local']).is_file():
   candidate=pathlib.Path(prior['local']).read_bytes()
   if len(candidate)==f['bytes'] and hashlib.sha256(candidate).hexdigest()==prior['sha256'] and prior.get('etag')==f['etag']:data=candidate;cached=True
  if data is None and target.exists():
   # A file completed just before a crash can be revalidated against the current source.
   candidate=target.read_bytes();etag=f['etag'].strip('"')
   if len(candidate)==f['bytes'] and re.fullmatch('[a-f0-9]{32}',etag) and hashlib.md5(candidate).hexdigest()==etag:data=candidate;cached=True
  url=ROOT+urllib.parse.quote(f['key'])
  if data is None:data,headers=fetch(url)
  if len(data)!=f['bytes']:raise ValueError('Source size changed')
  response_etag=headers.get('ETag') or headers.get('Etag') or headers.get('etag')
  if response_etag and response_etag!=f['etag']:raise ValueError('Source ETag changed')
  summary=usage_summary(json.loads(data));temp=target.with_suffix('.part');temp.write_bytes(data);os.replace(temp,target)
  return {**f,'local':str(target),'url':url,'sha256':hashlib.sha256(data).hexdigest(),'responseEtag':response_etag or f['etag'],'cached':cached,**summary}
 with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
  futures={pool.submit(download,f):f for f in jobs}
  for future in concurrent.futures.as_completed(futures):
   f=futures[future]
   try:manifest['files'].append(future.result())
   except Exception as error:manifest['failures'].append({'label':f['label'],'instanceId':f['instanceId'],'error':str(error)[:300]})
   completed=len(manifest['files'])+len(manifest['failures'])
   if completed%25==0:
    atom_json(out/'manifest.json',manifest);print(json.dumps({'completed':completed,'valid':len(manifest['files']),'failures':len(manifest['failures'])}),flush=True)
 manifest['files'].sort(key=lambda f:(f['label'],f['instanceId']));manifest['status']='complete' if not manifest['failures'] else 'partial';manifest['totals']={k:sum(f.get(k,0) for f in manifest['files']) for k in ['bytes','modelCalls','callsWithUsage','inputTokens','outputTokens','cachedInputTokens','cacheCreationInputTokens','reasoningOutputTokens','recordedCostUsd','callsWithCost']};atom_json(out/'manifest.json',manifest);print(json.dumps({'status':manifest['status'],'trajectories':len(manifest['files']),**manifest['totals']}),flush=True)
if __name__=='__main__':main()
