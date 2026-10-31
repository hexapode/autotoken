"""Inert history-bound missing-path repair for bounded standalone source reads."""
import argparse,collections,hashlib,importlib.util,json,pathlib,posixpath,re,shlex
from trace_batch_core import normalize
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('path_usage',ROOT/'scripts/estimate-recorded-usage.py');u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
PROGRAM='known_path_read_repair_v5';TITLE='Repair a read using a uniquely known file path'
POLICY={'historyResponses':12,'roots':['/testbed','/tmp'],'maxCommandBytes':4096,'maxOutputBytes':16000,'maxLines':250,'maxListingPaths':500,'maxRetries':1,'requiresRegisteredRoots':True,'requiresRegularFileNoSymlink':True,'requiresUnchangedFile':True,'timeoutSeconds':5}
def partition(issue):return 'discovery' if int(hashlib.sha256(('autotoken-v5:'+issue).encode()).hexdigest(),16)%5==0 else 'validation'
def absolute(path,cwd):
 if not isinstance(path,str) or len(path)>240 or not re.fullmatch(r'[A-Za-z0-9_./-]+',path) or path.startswith('-') or '..' in path.split('/') or any(x.startswith('.') and x!='.' for x in path.split('/') if x):return None
 p=posixpath.normpath(posixpath.join(cwd,path))
 return p if p.startswith(('/testbed/','/tmp/')) else None

def words(command):
 if not isinstance(command,str) or len(command.encode())>4096 or any(c in command for c in ['\n',';','|','`','$','\\','>','<']):return None
 cwd='/testbed';m=re.match(r'\Acd (/testbed(?:/[A-Za-z0-9_./-]+)?|/tmp(?:/[A-Za-z0-9_./-]+)?) && ',command)
 if m:
  cwd=m[1];command=command[m.end():]
  if '..' in cwd.split('/') or any(x.startswith('.') for x in cwd.split('/') if x):return None
 if '&' in command:return None
 try:a=shlex.split(command)
 except ValueError:return None
 return cwd,a

def parse_read(command):
 parsed=words(command)
 if not parsed:return None
 cwd,a=parsed;selector=[];path=None
 if len(a)==2 and a[0]=='cat':path=a[1]
 elif len(a)==3 and a[0]=='head' and re.fullmatch(r'-[1-9][0-9]*',a[1]):selector=['-n',str(int(a[1][1:]))];path=a[2]
 elif len(a)==4 and a[:2]==['head','-n'] and re.fullmatch(r'[1-9][0-9]*',a[2]):selector=['-n',str(int(a[2]))];path=a[3]
 elif len(a)==4 and a[:2]==['sed','-n'] and re.fullmatch(r'[1-9][0-9]*,[1-9][0-9]*p',a[2]):
  lo,hi=map(int,a[2][:-1].split(','))
  if lo>hi or hi-lo+1>250 or hi>1000000:return None
  selector=['-n',f'{lo},{hi}p'];path=a[3]
 else:return None
 if a[0]=='head' and int(selector[1])>250:return None
 resolved=absolute(path,cwd)
 return {'cwd':cwd,'verb':a[0],'selector':selector,'path':resolved,'rawPath':path} if resolved else None

def output(result,success=True):
 if not isinstance(result,str) or len(result.encode())>16000 or result.count('<returncode>')!=1 or '\0' in result:return None
 m=re.fullmatch(r'<returncode>(-?\d+)</returncode>\n<output>\n?(.*?)\n?</output>',result,re.S)
 if not m or (success and m[1]!='0') or re.search('truncated',m[2],re.I):return None
 return m[2]

def missing(parsed,result):
 body=output(result,False)
 if body is None or not re.match(r'<returncode>[12]</returncode>',result):return False
 q=re.escape(parsed['rawPath'])
 patterns={'cat':rf'cat: {q}: No such file or directory','head':rf"head: cannot open '{q}' for reading: No such file or directory",'sed':rf'sed: can\x27t read {q}: No such file or directory'}
 return re.fullmatch(patterns[parsed['verb']],body.strip()) is not None

def singleton(turn):
 if len(turn['actions'])!=1:return None
 a=turn['actions'][0]
 return a if a['name']=='bash' and isinstance(a['command'],str) and len(a['results'])==1 else None

def known_paths(history):
 paths=set()
 for t in history[-12:]:
  a=singleton(t)
  if not a:continue
  body=output(a['results'][0])
  if body is None:continue
  read=parse_read(a['command'])
  if read and len(body.splitlines())<=250:paths.add(read['path']);continue
  parsed=words(a['command'])
  if not parsed:continue
  cwd,args=parsed
  # Pure file-name outputs only. No ls headers, recursive listings, pipelines,
  # content searches or arbitrary file-name extraction from source text.
  listing=False
  if len(args)==6 and args[0]=='find' and args[2:5]==['-type','f','-name'] and len(args[5])<=80:
   root=args[1]
   if root=='.' or root in ['/testbed','/tmp'] or absolute(root,cwd):listing=True
  if args==['rg','--files']:listing=True
  if not listing:continue
  lines=body.splitlines()
  if not 1<=len(lines)<=500:continue
  resolved=[absolute(line,cwd) for line in lines]
  if all(resolved):paths.update(resolved)
 return paths

def plan(history,current,retries=0):
 if retries:return None
 a=singleton(current)
 if not a:return None
 read=parse_read(a['command'])
 if not read or not missing(read,a['results'][0]):return None
 candidates={p for p in known_paths(history) if p!=read['path'] and posixpath.basename(p)==posixpath.basename(read['path'])}
 if len(candidates)!=1:return None
 target=next(iter(candidates))
 return {'cwd':read['cwd'],'verb':read['verb'],'selector':read['selector'],'path':target,'argv':[read['verb'],*read['selector'],target],'evidence':'unique same-basename path observed in prior successful read or file listing','requiresRuntimeRootFileStateChecks':True,'maxOutputBytes':16000,'maxLines':250,'timeoutSeconds':5}

def analyze(raw,label):
 turns=normalize(raw);proposals=[];events=[];diag=collections.Counter();used=set()
 for i,t in enumerate(turns[:-1]):
  a=singleton(t);read=parse_read(a['command']) if a else None
  if read and missing(read,a['results'][0]):diag['supportedNativeMissingReadErrors']+=1
  p=plan(turns[max(0,i-12):i],t)
  if not p:continue
  row={'cohort':label,'instance':raw['instance_id'],'sourceOrdinal':i,'targetOrdinal':i+1,'partition':partition(raw['instance_id']),'matched':False};proposals.append(row)
  nxt=singleton(turns[i+1]);target=parse_read(nxt['command']) if nxt else None
  if not target or {k:target[k] for k in ['verb','selector','path']}!={k:p[k] for k in ['verb','selector','path']}:diag['nextActionDiffers']+=1;continue
  body=output(nxt['results'][0])
  if body is None or len(body.splitlines())>250:diag['nextReadUnverifiedOrUnbounded']+=1;continue
  if i in used or i+1 in used:diag['overlapExcluded']+=1;continue
  used.add(i+1);row['matched']=True
  events.append({**row,'matchType':'exact','usage':turns[i+1]['usage'],'reportedCost':turns[i+1]['reportedCost'],'requiresRuntimeStateChecks':True})
 return turns,proposals,events,dict(diag)

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest',required=True,type=pathlib.Path);p.add_argument('--public',required=True,type=pathlib.Path);p.add_argument('--private',required=True,type=pathlib.Path);a=p.parse_args();manifest=json.loads(a.manifest.read_text());rows=[];events=[]
 for f in manifest['files']:
  data=pathlib.Path(f['local']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Source checksum mismatch')
  raw=json.loads(data);ts,ps,es,diag=analyze(raw,f['label']);rows.append({'cohort':f['label'],'instance':raw['instance_id'],'partition':partition(raw['instance_id']),'turns':ts,'proposals':ps,'events':es,'diagnostics':diag});events.extend(es)
 def summary(rs):
  ts=[t for r in rs for t in r['turns']];ps=[p for r in rs for p in r['proposals']];es=[e for r in rs for e in r['events']];den=u.sums(ts);gain=u.sums(es)
  return {'trajectories':len(rs),'issues':len({r['instance'] for r in rs}),'denominator':den,'proposals':len(ps),'matchedCalls':len(es),'matchedIssues':len({e['instance'] for e in es}),'matchedUsage':gain,'matchPercent':100*len(es)/len(ps) if ps else 0,'callPercent':100*len(es)/den['calls'] if den['calls'] else 0,'tokenPercent':100*gain['totalTokens']/den['totalTokens'] if den['totalTokens'] else 0,'diagnostics':dict(sum((collections.Counter(r['diagnostics']) for r in rs),collections.Counter()))}
 report={'version':5,'program':PROGRAM,'title':TITLE,'kind':'conditional-gross-recorded-usage-replay-estimate','policy':POLICY,**summary(rows),'cohorts':{c:summary([r for r in rows if r['cohort']==c]) for c in sorted({r['cohort'] for r in rows})},'byPartition':{g:summary([r for r in rows if r['partition']==g]) for g in ['discovery','validation']},'split':"SHA256('autotoken-v5:'+issue_id)%5==0 discovery; models grouped by issue; policy frozen before remaining issues",'sourceManifestSha256':hashlib.sha256(a.manifest.read_bytes()).hexdigest(),'plannerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'limitations':['A path is predicted only from prior successful reads or unambiguous pure file listings within 12 responses; no typo correction or future-file oracle.','Normalized read operation/range and absolute file path must match the complete next singleton model response; harmless quote/path/cwd spelling differences are canonicalized.','Historical file/root/symlink/unchanged-state checks are unverified; future executor must enforce them and bounded output.','A formerly observed path may no longer exist. File existence must be revalidated and repair attempted at most once.','Matching a read may discard useful model reasoning; task outcomes and causal savings are untested.','All token percentages are gross original-call usage before router/execution/false-positive costs and changed future context/cache effects.','Cached input and reasoning are subsets, not additional tokens.','Only file read operations supported; script execution, pipelines, writes, directories, ambiguous basename candidates and unobserved paths abstain.','Corpus reused for prior research; within-round validation is not untouched external task evaluation.','No recorded commands executed and no paid inference used.']}
 a.public.write_text(json.dumps(report,indent=2)+'\n');a.private.parent.mkdir(parents=True,exist_ok=True);a.private.write_text(json.dumps(events,indent=2)+'\n');a.private.chmod(0o600);print(json.dumps({k:report[k] for k in ['proposals','matchedCalls','matchedIssues','matchedUsage','diagnostics']},indent=2))
if __name__=='__main__':main()
