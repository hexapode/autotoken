"""Inert bounded continuation of an apparently cut-off Python source window."""
import argparse,collections,hashlib,importlib.util,json,pathlib,re
from trace_batch_core import normalize
ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
readers=load('continuation_reads','candidate-search-read-v2.py');u=load('continuation_usage','estimate-recorded-usage.py')
PROGRAM='bounded_read_continuation_v4';TITLE='Continue an apparently cut-off Python source read'
POLICY={'minSourceLines':10,'maxSourceLines':250,'nextAdditionalLines':100,'overlapLines':1,'maxOutputBytes':16000,'maxContinuations':1,'requiresRegisteredRepository':True,'requiresRegularUnchangedFileNoSymlinks':True,'requiresContentBeyondPriorWindow':True}
def group(issue):return 'discovery' if int(hashlib.sha256(('autotoken-v4:'+issue).encode()).hexdigest(),16)%5==0 else 'validation'
def plan(command,result,continuations=0):
 if continuations:return None
 r=readers.read(command,result)
 if not r or r['catToEOF'] or not r['path'].endswith('.py') or any(x.startswith('.') for x in r['path'].split('/') if x):return None
 span=r['end']-r['start']+1
 if not POLICY['minSourceLines']<=span<=POLICY['maxSourceLines'] or r['observedLines']!=span or r['end']>1000000:return None
 text=readers.output(result);lines=[x for x in text.splitlines() if x.strip()]
 if not lines or not lines[-1].startswith((' ','\t')):return None
 # A filled window ending inside indentation is a trigger heuristic, not proof
 # that the definition/file continues. Runtime checks must establish more data.
 return {'path':r['path'],'start':r['end'],'end':r['end']+100,'maxOutputBytes':16000,'continuations':1,'requiresUnchangedFileAndMoreLines':True,'argv':['sed','-n',f"{r['end']},{r['end']+100}p",r['path']]}
def singleton(t):
 if len(t['actions'])!=1:return None
 a=t['actions'][0]
 return a if a['name']=='bash' and isinstance(a['command'],str) and len(a['results'])==1 else None

def reasoning(raw,t):
 m=raw['messages'][t['sourceMessageIndex']]
 if m.get('object')=='response':return any(x.get('type')!='function_call' for x in m.get('output',[]))
 return bool(m.get('content')) or bool(m.get('reasoning_content')) or ((t['usage'] or {}).get('reasoningOutputTokens') or 0)>0

def analyze(raw,label):
 turns=normalize(raw);ps=[];es=[];diagnostics=collections.Counter();targets=set()
 for i,t in enumerate(turns[:-1]):
  a=singleton(t)
  if not a:continue
  p=plan(a['command'],a['results'][0])
  if not p:continue
  row={'cohort':label,'instance':raw['instance_id'],'partition':group(raw['instance_id']),'sourceOrdinal':i,'targetOrdinal':i+1,'matched':False};ps.append(row)
  n=singleton(turns[i+1])
  if not n:diagnostics['nextNotSingletonObservedBash']+=1;continue
  actual=readers.read(n['command'],n['results'][0]);kind=readers.classify(p,actual)
  if not kind:diagnostics['nextReadDiffers']+=1;continue
  if i in targets or i+1 in targets:diagnostics['adjacentChainExcluded']+=1;continue
  targets.add(i+1);row['matched']=kind=='exact'
  es.append({**row,'matchType':kind,'usage':turns[i+1]['usage'],'reportedCost':turns[i+1]['reportedCost'],'reasoningOrProse':reasoning(raw,turns[i+1]),'extraContextCostUnmeasured':kind=='coverage_only'})
 return turns,ps,es,dict(diagnostics)

def summary(rows):
 turns=[t for r in rows for t in r['turns']];ps=[p for r in rows for p in r['proposals']];es=[e for r in rows for e in r['events']];exact=[e for e in es if e['matchType']=='exact'];coverage=[e for e in es if e['matchType']=='coverage_only'];den=u.sums(turns);gain=u.sums(exact)
 return {'trajectories':len(rows),'issues':len({r['instance'] for r in rows}),'denominator':den,'proposals':len(ps),'matchedCalls':len(exact),'unmatchedExactProposals':len(ps)-len(exact),'matchedIssues':len({e['instance'] for e in exact}),'matchedUsage':gain,'matchPercent':100*len(exact)/len(ps) if ps else 0,'callPercent':100*len(exact)/den['calls'] if den['calls'] else 0,'tokenPercent':100*gain['totalTokens']/den['totalTokens'] if den['totalTokens'] else 0,'matchesWithReasoningOrProse':sum(e['reasoningOrProse'] for e in exact),'coverageOnly':{'matchedCalls':len(coverage),'matchedIssues':len({e['instance'] for e in coverage}),'matchedUsage':u.sums(coverage),'excludedFromExactTotal':True},'diagnostics':dict(sum((collections.Counter(r['diagnostics']) for r in rows),collections.Counter()))}

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--manifest',type=pathlib.Path,required=True);ap.add_argument('--public',type=pathlib.Path,required=True);ap.add_argument('--private',type=pathlib.Path,required=True);args=ap.parse_args();manifest=json.loads(args.manifest.read_text());rows=[]
 for f in manifest['files']:
  data=pathlib.Path(f['local']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Source checksum mismatch')
  raw=json.loads(data);ts,ps,es,ds=analyze(raw,f['label']);rows.append({'cohort':f['label'],'instance':raw['instance_id'],'partition':group(raw['instance_id']),'turns':ts,'proposals':ps,'events':es,'diagnostics':ds})
 report={'version':4,'program':PROGRAM,'title':TITLE,'kind':'conditional-gross-replay-estimate-not-measured-savings','policy':POLICY,**summary(rows),'cohorts':{c:summary([r for r in rows if r['cohort']==c]) for c in sorted({r['cohort'] for r in rows})},'byPartition':{g:summary([r for r in rows if r['partition']==g]) for g in ['discovery','validation']},'partitionMethod':"SHA256('autotoken-v4:'+instance_id)%5==0 discovery; others validation; same issue grouped across models",'selectionNote':'Discovery-only scan favored one-line-overlap and fixed100-line continuation over adjacent or repeated-window rules. Policy frozen before validation. Earlier project use means this is not untouched external validation.','limitations':['Filled source window ending in indentation is evidence of a possible cut-off, not proof of incomplete code or file continuation.','Runtime must verify registered repository, regular file/no symlinks, unchanged state and content beyond prior end. Historical filesystem state is not reconstructed.','One continuation only; overlapping/dependent adjacent substitutions are excluded.','Only whole singleton next model responses with one aligned successful bounded read result count. Bundles and multitool responses excluded.','Exact means same file/start/end; canonical quoting and absolute/relative file spelling are normalized.','Coverage-only reads may fit a larger returned window but added-context token cost and output-cap feasibility are unknown, so excluded from exact totals.','Recorded usage belongs to original calls; saved usage is a conditional gross estimate before routing, program, false-positive and downstream cache costs.','Removing a response may discard needed reasoning. Task quality and net savings untested.','Cache and reasoning counts are subsets of input/output totals, never added again.','No recorded command executed and no paid inference.'],'sourceManifestSha256':hashlib.sha256(args.manifest.read_bytes()).hexdigest(),'plannerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}
 args.public.write_text(json.dumps(report,indent=2)+'\n');args.private.parent.mkdir(parents=True,exist_ok=True);events=[e for r in rows for e in r['events']];args.private.write_text(json.dumps([e for e in events if e['matchType']=='exact'],indent=2)+'\n');args.private.chmod(0o600);coverage=args.private.with_name(args.private.name.replace('-events.json','-coverage-events.json'));coverage.write_text(json.dumps([e for e in events if e['matchType']=='coverage_only'],indent=2)+'\n');coverage.chmod(0o600)
 print(json.dumps({k:report[k] for k in ['proposals','matchedCalls','matchedIssues','matchedUsage','matchPercent','callPercent','tokenPercent','coverageOnly']},indent=2))
if __name__=='__main__':main()
