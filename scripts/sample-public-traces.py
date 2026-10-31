"""Pinned public trajectory sampler. Downloads are data only, never executed.

Requires requests and pyarrow. All downloaded/raw/normalized data stays in the
explicit external output directory. Source metadata is recorded for attribution.
"""
import argparse,concurrent.futures,hashlib,json,os,pathlib,time
import requests
SOURCES=[
 {'id':'nebius/SWE-agent-trajectories','harness':'swe-agent','revision':'68195a1450865274106246d0d0296a1d6807b88e','license':'cc-by-4.0','shards':[0,6,11]},
 {'id':'nebius/SWE-rebench-openhands-trajectories','harness':'openhands','revision':'35455389ab51bf5e2306bfd436ef72d0f98bf882','license':'cc-by-4.0','shards':[0]},
 {'id':'Kwai-Klear/SWE-smith-mini_swe_agent_plus-trajectories-66k','harness':'mini-swe-agent-plus','revision':'750b2c11239fd5e32f97e6cfb9bf80fb9a9a2983','license':'mit','shards':[0,11,23,35,46]},
]
def fetch_json(url):
 r=requests.get(url,timeout=60);r.raise_for_status();return r.json()
def download(item):
 path=pathlib.Path(item['local']);expected=item['bytes'];path.parent.mkdir(parents=True,exist_ok=True)
 if path.exists() and path.stat().st_size==expected:
  digest=file_hash(path)
  if not item.get('sha256') or digest==item['sha256']:return {**item,'actualSha256':digest,'cached':True}
 temp=path.with_suffix('.partial');digest=hashlib.sha256();written=0
 with requests.get(item['url'],stream=True,timeout=(20,120)) as response:
  response.raise_for_status()
  with temp.open('wb') as stream:
   for chunk in response.iter_content(4*1024*1024):
    if not chunk:continue
    written+=len(chunk)
    if written>expected:raise ValueError('Download exceeds manifest size')
    stream.write(chunk);digest.update(chunk)
 if written!=expected:raise ValueError('Incomplete download')
 if item.get('sha256') and digest.hexdigest()!=item['sha256']:raise ValueError('Checksum mismatch')
 temp.replace(path);print(json.dumps({'downloaded':item['harness'],'file':path.name,'bytes':written}),flush=True)
 return {**item,'actualSha256':digest.hexdigest(),'cached':False}
def file_hash(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(4*1024*1024),b''):h.update(block)
 return h.hexdigest()
def prepare(root):
 items=[]
 for source in SOURCES:
  base='https://huggingface.co/datasets/'+source['id']+'/resolve/'+source['revision']+'/'
  metadata=fetch_json('https://huggingface.co/api/datasets/'+source['id']+'/tree/'+source['revision']+'?recursive=true&expand=true')
  files=sorted([f for f in metadata if f['path'].endswith('.parquet')],key=lambda f:f['path'])
  directory=root/source['harness'];directory.mkdir(parents=True,exist_ok=True)
  for name in ['README.md']+(['LICENSE'] if source['harness']=='openhands' else []):
   response=requests.get(base+name,timeout=60);response.raise_for_status();(directory/name).write_bytes(response.content)
  for index in source['shards']:
   f=files[index];items.append({'harness':source['harness'],'dataset':source['id'],'revision':source['revision'],'license':source['license'],'remotePath':f['path'],'url':base+f['path'],'local':str(directory/pathlib.Path(f['path']).name),'bytes':f['size'],'sha256':f.get('lfs',{}).get('oid')})
 if sum(x['bytes'] for x in items)>3_000_000_000:raise ValueError('Planned downloads exceed 3 GB bound')
 (root/'download-plan.json').write_text(json.dumps({'sources':SOURCES,'files':items,'totalBytes':sum(x['bytes'] for x in items)},indent=2))
 return items
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args();root=pathlib.Path(args.output).resolve();root.mkdir(parents=True,exist_ok=True)
 items=prepare(root);print(json.dumps({'plannedBytes':sum(x['bytes'] for x in items),'files':len(items)}),flush=True)
 results=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  for result in pool.map(download,items):results.append(result)
 (root/'downloads.json').write_text(json.dumps({'sources':SOURCES,'files':results},indent=2));print('Downloads complete',flush=True)
