"""Inert missing pytest executable -> registered Python module retry planner."""
import argparse,collections,hashlib,importlib.util,json,pathlib,posixpath,re,shlex
from trace_batch_core import normalize
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('pytest_usage',ROOT/'scripts/estimate-recorded-usage.py');usage=importlib.util.module_from_spec(spec);spec.loader.exec_module(usage)
PROGRAM='missing_pytest_module_retry_v5';TITLE='Retry a missing pytest command through registered Python'
POLICY={'registeredInterpreter':'python3','maxCommandBytes':4096,'maxTargets':8,'maxRetries':1,'maxOutputBytes':32768,'timeoutSeconds':120,'requiresWorkingRegisteredPytestModule':True,'requiresSameEnvironmentAndRepository':True,'requiresExplicitRetryPolicy':True}
def partition(issue):return 'discovery' if int(hashlib.sha256(('autotoken-v5:'+issue).encode()).hexdigest(),16)%5==0 else 'validation'
def parse(command,module=False):
 if not isinstance(command,str) or len(command.encode())>4096:return None
 command=command.strip()
 if any(x in command for x in ['\n','\r',';','|','`','$','\\','>','<']):return None
 cwd='/testbed';m=re.match(r'\Acd (/testbed(?:/[A-Za-z0-9_.-]+)*) && ',command)
 if m:cwd=m[1];command=command[m.end():]
 if '&' in command or '..' in cwd.split('/') or any(x.startswith('.') for x in cwd.split('/') if x):return None
 try:a=shlex.split(command)
 except ValueError:return None
 prefix=['python3','-m','pytest'] if module else ['pytest']
 if a[:len(prefix)]!=prefix:return None
 args=a[len(prefix):];normalized=[];targets=0;i=0
 while i<len(args):
  x=args[i]
  if re.fullmatch(r'-[qvxsr]+',x) or x in ['--disable-warnings','--tb=short','--tb=long','--tb=no','--maxfail=1','--collect-only']:
   normalized.append(x)
  elif x=='-k':
   i+=1
   if i>=len(args) or not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_ ()]{0,199}',args[i]):return None
   normalized.extend(['-k',args[i]])
  else:
   if x.startswith('-') or not re.fullmatch(r'[A-Za-z0-9_./:-]{1,240}',x):return None
   parts=x.split('::');path=parts[0]
   if not path.endswith('.py') or '..' in path.split('/') or any(p.startswith('.') for p in path.split('/') if p and p!='.'):return None
   if any(not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',p) for p in parts[1:]):return None
   path=posixpath.normpath(posixpath.join(cwd,path))
   if not path.startswith('/testbed/'):return None
   normalized.append('::'.join([path]+parts[1:]));targets+=1
  i+=1
 if not 1<=targets<=POLICY['maxTargets']:return None
 return {'cwd':cwd,'args':normalized}
def missing_pytest(result):
 return isinstance(result,str) and re.fullmatch(r'<returncode>127</returncode>\n<output>\n(?:bash|/bin/bash): (?:line \d+: )?pytest: command not found\n</output>',result) is not None
def plan(command,result,retries=0):
 if retries or not missing_pytest(result):return None
 invocation=parse(command)
 if not invocation:return None
 return {**invocation,'argv':['python3','-m','pytest']+invocation['args'],**POLICY}
def singleton(t):
 if len(t['actions'])!=1:return None
 a=t['actions'][0]
 return a if a['name']=='bash' and isinstance(a['command'],str) and len(a['results'])==1 else None
def observed_retry(result):
 return isinstance(result,str) and len(result.encode())<=POLICY['maxOutputBytes'] and re.fullmatch(r'<returncode>[0-5]</returncode>\n<output>.*</output>',result,re.S) is not None and not re.search(r'(?i)No module named [\'\"]?pytest\b|output truncated',result)
def reasoning(raw,t):
 m=raw['messages'][t['sourceMessageIndex']]
 return any(x.get('type')!='function_call' for x in m.get('output',[])) if m.get('object')=='response' else bool(m.get('content')) or bool(m.get('reasoning_content')) or ((t['usage'] or {}).get('reasoningOutputTokens') or 0)>0

def analyze(raw,label):
 turns=normalize(raw);proposals=[];events=[];diagnostics=collections.Counter();used=set()
 for i,t in enumerate(turns[:-1]):
  a=singleton(t)
  if not a:continue
  if missing_pytest(a['results'][0]):diagnostics['nativeMissingPytestErrors']+=1
  p=plan(a['command'],a['results'][0])
  if not p:continue
  row={'cohort':label,'instance':raw['instance_id'],'sourceOrdinal':i,'targetOrdinal':i+1,'partition':partition(raw['instance_id']),'matched':False};proposals.append(row)
  nxt=turns[i+1];n=singleton(nxt)
  if not n:diagnostics['nextNotSingletonBashWithResult']+=1;continue
  if parse(n['command'],module=True)!={k:p[k] for k in ['cwd','args']}:diagnostics['nextCommandDiffers']+=1;continue
  if not observed_retry(n['results'][0]):
   diagnostics['nextRetryUnavailableOrUnbounded']+=1
   if re.search(r'(?i)No module named [\'\"]?pytest\b',n['results'][0]):diagnostics['matchingCommandButPytestModuleMissing']+=1
   elif len(n['results'][0].encode())>POLICY['maxOutputBytes']:diagnostics['matchingCommandOutputTooLarge']+=1
   else:diagnostics['matchingCommandUnsupportedResult']+=1
   continue
  if i in used or i+1 in used:diagnostics['overlapExcluded']+=1;continue
  used.add(i+1);row['matched']=True
  events.append({**row,'matchType':'exact','usage':nxt['usage'],'reportedCost':nxt['reportedCost'],'reasoningOrProse':reasoning(raw,nxt),'retryExitCode':int(re.match(r'<returncode>(\d+)</returncode>',n['results'][0])[1])})
 return turns,proposals,events,dict(diagnostics)

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest',type=pathlib.Path,required=True);p.add_argument('--public',type=pathlib.Path,required=True);p.add_argument('--private',type=pathlib.Path,required=True);a=p.parse_args();manifest=json.loads(a.manifest.read_text());rows=[];events=[]
 for f in manifest['files']:
  data=pathlib.Path(f['local']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Source checksum mismatch')
  raw=json.loads(data);ts,ps,es,ds=analyze(raw,f['label']);rows.append({'cohort':f['label'],'instance':raw['instance_id'],'partition':partition(raw['instance_id']),'turns':ts,'proposals':ps,'events':es,'diagnostics':ds});events.extend(es)
 def summary(rs):
  ts=[t for r in rs for t in r['turns']];ps=[p for r in rs for p in r['proposals']];es=[e for r in rs for e in r['events']];d=usage.sums(ts);g=usage.sums(es)
  return {'trajectories':len(rs),'issues':len({r['instance'] for r in rs}),'denominator':d,'proposals':len(ps),'matchedCalls':len(es),'matchedIssues':len({e['instance'] for e in es}),'matchedUsage':g,'matchPercent':100*len(es)/len(ps) if ps else 0,'callPercent':100*len(es)/d['calls'] if d['calls'] else 0,'tokenPercent':100*g['totalTokens']/d['totalTokens'] if d['totalTokens'] else 0,'matchesWithReasoningOrProse':sum(e['reasoningOrProse'] for e in es),'retryExitCodes':dict(collections.Counter(e['retryExitCode'] for e in es)),'diagnostics':dict(sum((collections.Counter(r['diagnostics']) for r in rs),collections.Counter()))}
 report={'version':5,'program':PROGRAM,'title':TITLE,'kind':'conditional-gross-recorded-usage-replay-estimate','policy':POLICY,**summary(rows),'cohorts':{c:summary([r for r in rows if r['cohort']==c]) for c in sorted({r['cohort'] for r in rows})},'byPartition':{g:summary([r for r in rows if r['partition']==g]) for g in ['discovery','validation']},'split':{'method':"SHA256('autotoken-v5:'+issue_id)%5==0 discovery; all other issues validation, grouped across models",'policyFrozenBeforeValidation':True,'notUntouchedExternalValidation':True},'sourceManifestSha256':hashlib.sha256(a.manifest.read_bytes()).hexdigest(),'plannerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'limitations':['Frozen after discovery-only inspection; validation never used to choose interpreter, arguments or trigger.','Exact match means same canonical cwd/arguments for python3 -m pytest; python and python3 are not treated as interchangeable.','Only standalone bounded invocations on explicit repository Python targets are supported. No install, shell bundle, pipeline, redirect, configuration edits or target guessing.','Runtime must register a working Python3/pytest environment and unchanged repository, and enforce explicit retry/output/runtime bounds. Historical runtime registration is unverified.','Missing pytest module results are excluded. A matched retry can still fail tests or collection; process success is not bug-fix quality.','A matching response may contain needed reasoning. Recorded usage is a conditional gross opportunity, not demonstrated savings.','Input includes cache subsets; output includes reasoning. No double counting.','Routing/execution/false-positive costs and subsequent context/cache changes are not modeled.','No recorded commands executed or paid inference used.']}
 a.public.write_text(json.dumps(report,indent=2)+'\n');a.private.parent.mkdir(parents=True,exist_ok=True);a.private.write_text(json.dumps(events,indent=2)+'\n');a.private.chmod(0o600);print(json.dumps({k:report[k] for k in ['proposals','matchedCalls','matchedUsage','callPercent','tokenPercent','diagnostics']},indent=2))
if __name__=='__main__':main()
