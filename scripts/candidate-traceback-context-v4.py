"""Inert failed traceback -> bounded deepest repository-frame context planner."""
import argparse,collections,hashlib,importlib.util,json,pathlib,re
from trace_batch_core import normalize
ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
u=load('traceback_usage','estimate-recorded-usage.py');reader=load('traceback_read','candidate-search-read-v2.py')
PROGRAM='traceback_context_v4';TITLE='Read context at the deepest repository traceback frame'
POLICY={'lineRadius':50,'maxOutputBytes':16000,'maxObservationBytes':65536,'maxPathLength':240,'maxLine':1000000,'root':'/testbed','requiresRegularFileNoSymlinks':True,'requiresUnchangedFile':True,'oneTracebackOnly':True,'excludeImportSetupFailures':True,'excludeTestAndReproductionPaths':True}

def partition(instance):return 'discovery' if int(hashlib.sha256(('autotoken-v4:'+instance).encode()).hexdigest(),16)%5==0 else 'validation'
def repository_source(value):
 if not isinstance(value,str) or len(value)>240 or not re.fullmatch(r'/testbed/[A-Za-z0-9_./-]+\.py',value):return None
 parts=value[9:].split('/')
 if any(not x or x in ['.','..'] or x.startswith('.') for x in parts):return None
 if any(x in ['test','tests','testing'] or x.startswith(('test_','repro','verify','debug','check_')) or x.endswith('_test.py') for x in parts):return None
 return value

def plan(command,observation):
 if not isinstance(command,str) or len(command.encode())>65536 or not re.match(r'\A(?:cd /testbed && )?(?:python3?(?:\s|$)|pytest(?:\s|$))',command):return None
 if not isinstance(observation,str) or len(observation.encode())>65536 or observation.count('<returncode>')!=1:return None
 m=re.fullmatch(r'<returncode>1</returncode>\n<output>\n?(.*?)\n?</output>',observation,re.S)
 if not m:return None
 text=m[1]
 if text.count('Traceback (most recent call last):')!=1 or re.search(r'ImportError|ModuleNotFoundError|ERROR collecting|ERROR at setup|fixture .* not found|command not found|No module named|[Oo]utput (?:truncated|too long)|\[.*truncated.*\]',text):return None
 tail=text.split('Traceback (most recent call last):',1)[1]
 frames=[(repository_source(p),int(n)) for p,n in re.findall(r'^\s*File "([^"\n]+)", line ([1-9][0-9]*)(?:, in [^\n]*)?\s*$',tail,re.M)]
 frames=[(p,n) for p,n in frames if p and n<=POLICY['maxLine']]
 if not frames:return None
 path,line=frames[-1]
 return {'path':path,'start':max(1,line-50),'end':line+50,'frameLine':line,'maxOutputBytes':16000,'requiresRegularFileNoSymlinks':True,'requiresUnchangedFile':True}

def singleton(t):
 if len(t['actions'])!=1:return None
 a=t['actions'][0]
 return a if a['name']=='bash' and isinstance(a['command'],str) and len(a['results'])==1 else None

def observed_reasoning(raw,t):
 m=raw['messages'][t['sourceMessageIndex']]
 if m.get('object')=='response':return any(x.get('type')!='function_call' for x in m.get('output',[]))
 return bool(m.get('content')) or bool(m.get('reasoning_content')) or ((t['usage'] or {}).get('reasoningOutputTokens') or 0)>0

def analyze(raw,label):
 turns=normalize(raw);proposals=[];events=[];diagnostics=collections.Counter();targets=set()
 for i,t in enumerate(turns[:-1]):
  a=singleton(t)
  if not a:continue
  if 'Traceback (most recent call last):' in a['results'][0]:diagnostics['observationsWithTraceback']+=1
  p=plan(a['command'],a['results'][0])
  if not p:continue
  row={'cohort':label,'instance':raw['instance_id'],'partition':partition(raw['instance_id']),'sourceOrdinal':i,'targetOrdinal':i+1,'matched':False};proposals.append(row)
  n=turns[i+1];na=singleton(n)
  if not na:diagnostics['nextNotSingletonObservedBash']+=1;continue
  read=reader.read(na['command'],na['results'][0]);kind=reader.classify(p,read)
  if not kind:diagnostics['nextReadDiffersOrUnsupported']+=1;continue
  if i in targets or i+1 in targets:diagnostics['overlapExcluded']+=1;continue
  targets.add(i+1);row['matched']=kind=='exact'
  events.append({**row,'matchType':kind,'usage':n['usage'],'reportedCost':n['reportedCost'],'reasoningOrProse':observed_reasoning(raw,n),'plan':p,'extraContextCostNotMeasured':kind=='coverage_only'})
 return turns,proposals,events,dict(diagnostics)

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--manifest',required=True,type=pathlib.Path);ap.add_argument('--public',required=True,type=pathlib.Path);ap.add_argument('--private',required=True,type=pathlib.Path);args=ap.parse_args();manifest=json.loads(args.manifest.read_text());rows=[];events=[]
 for f in manifest['files']:
  data=pathlib.Path(f['local']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Source checksum mismatch')
  raw=json.loads(data);ts,ps,es,ds=analyze(raw,f['label']);rows.append({'instance':raw['instance_id'],'cohort':f['label'],'partition':partition(raw['instance_id']),'turns':ts,'proposals':ps,'events':es,'diagnostics':ds});events.extend(es)
 def summary(selected):
  ts=[t for r in selected for t in r['turns']];ps=[p for r in selected for p in r['proposals']];es=[e for r in selected for e in r['events'] if e['matchType']=='exact'];covered=[e for r in selected for e in r['events'] if e['matchType']=='coverage_only'];den=u.sums(ts);gain=u.sums(es)
  return {'trajectories':len(selected),'issues':len({r['instance'] for r in selected}),'denominator':den,'proposals':len(ps),'matchedCalls':len(es),'matchedIssues':len({e['instance'] for e in es}),'matchedUsage':gain,'matchPercent':100*len(es)/len(ps) if ps else 0,'callPercent':100*len(es)/den['calls'] if den['calls'] else 0,'tokenPercent':100*gain['totalTokens']/den['totalTokens'] if den['totalTokens'] else 0,'matchesWithReasoningOrProse':sum(e['reasoningOrProse'] for e in es),'coverageOnly':{'matchedCalls':len(covered),'matchedIssues':len({e['instance'] for e in covered}),'matchedUsage':u.sums(covered),'extraContextCostMeasured':False},'diagnostics':dict(sum((collections.Counter(r['diagnostics']) for r in selected),collections.Counter()))}
 report={'version':4,'program':PROGRAM,'title':TITLE,'kind':'conditional-gross-recorded-usage-replay-estimate','policy':POLICY,**summary(rows),'cohorts':{c:summary([r for r in rows if r['cohort']==c]) for c in sorted({r['cohort'] for r in rows})},'byPartition':{g:summary([r for r in rows if r['partition']==g]) for g in ['discovery','validation']},'split':{'method':"SHA256('autotoken-v4:'+instance_id)%5==0 discovery; remaining issues validation, grouped across models",'policyFrozenBeforeValidation':True,'caveat':'The larger corpus was previously used by the project; not untouched external validation.'},'sourceManifestSha256':hashlib.sha256(args.manifest.read_bytes()).hexdigest(),'plannerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'readerSha256':hashlib.sha256(pathlib.Path(reader.__file__).read_bytes()).hexdigest(),'limitations':['Plans use current failed command and completed output only; next calls are replay labels.','Exactly one traceback required; deepest eligible repository source frame is chosen without consulting future read arguments.','Runtime regular-file, no-symlink, unchanged-state and byte bounds are not reconstructed from historical traces.','Exact next range/path/read shape means a whole singleton response with an observed bounded successful read; multi-tool/bundled calls are excluded.','Broader coverage is reported separately: more context can cost tokens or hit the byte cap, so no net savings are credited.','Exception text and path selection may be unhelpful even when syntactically valid; proposal match rate is not task-quality validation.','Matched calls can include needed reasoning; removal is a conditional gross estimate before routing/execution/false-positive and future cache costs.','Recorded cache/creation and reasoning counts are subsets, not added again to totals.','No recorded commands executed or paid inference.']}
 args.public.write_text(json.dumps(report,indent=2)+'\n');args.private.parent.mkdir(parents=True,exist_ok=True);args.private.write_text(json.dumps([e for e in events if e['matchType']=='exact'],indent=2)+'\n');args.private.chmod(0o600);cov=args.private.with_name(args.private.stem+'-coverage.json');cov.write_text(json.dumps([e for e in events if e['matchType']=='coverage_only'],indent=2)+'\n');cov.chmod(0o600);print(json.dumps({k:report[k] for k in ['proposals','matchedCalls','matchedIssues','matchedUsage','callPercent','tokenPercent','coverageOnly']},indent=2))
if __name__=='__main__':main()
