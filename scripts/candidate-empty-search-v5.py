"""Inert empty literal file-search -> bounded immediate-parent scope fallback."""
import argparse,collections,hashlib,importlib.util,json,pathlib,posixpath,re,shlex
from trace_batch_core import normalize
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('empty_search_usage',ROOT/'scripts/estimate-recorded-usage.py');usage=importlib.util.module_from_spec(spec);spec.loader.exec_module(usage)
PROGRAM='empty_search_parent_scope_v5';TITLE='Broaden an empty file search to its parent directory'
POLICY={'root':'/testbed','maxCommandBytes':4096,'maxPatternBytes':200,'maxOutputBytes':16000,'maxFiles':1000,'maxFileBytes':1000000,'maxTotalBytes':8000000,'timeoutSeconds':5,'maxFallbacks':1,'literalPatternsOnly':True,'recursiveTargetLineNumbers':False,'requiresBoundedRegisteredGrep':True,'requiresRegularSourceFileAndNoSymlinks':True,'requiresUnchangedTree':True}

def partition(issue):return 'discovery' if int(hashlib.sha256(('autotoken-v5:'+issue).encode()).hexdigest(),16)%5==0 else 'validation'
def parse(command):
 if not isinstance(command,str) or len(command.encode())>4096:return None
 command=command.strip()
 if any(x in command for x in ['\n',';','|','`','$','\\','>','<']):return None
 cwd='/testbed';m=re.match(r'\Acd (/testbed(?:/[A-Za-z0-9_.-]+)*) && ',command)
 if m:cwd=m[1];command=command[m.end():]
 if '&' in command or '..' in cwd.split('/') or any(x.startswith('.') for x in cwd.split('/') if x):return None
 try:args=shlex.split(command)
 except ValueError:return None
 if not args or args[0]!='grep':return None
 recursive=False;numbered=False;ended=False;pos=[]
 for x in args[1:]:
  if x=='--' and not ended:ended=True;continue
  if not ended and x.startswith('-'):
   if x not in ['-n','-r','-rn','-nr']:return None
   recursive|='r' in x;numbered|='n' in x;continue
  pos.append(x)
 if len(pos)!=2:return None
 pattern,path=pos
 if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_ ]{0,199}',pattern):return None
 if not re.fullmatch(r'[A-Za-z0-9_./-]{1,240}',path) or '..' in path.split('/') or any(x.startswith('.') and x!='.' for x in path.split('/') if x):return None
 path=posixpath.normpath(posixpath.join(cwd,path))
 if not path.startswith('/testbed/'):return None
 return {'cwd':cwd,'pattern':pattern,'path':path,'recursive':recursive,'numbered':numbered}
def empty_result(result):return isinstance(result,str) and re.fullmatch(r'<returncode>1</returncode>\n<output>\s*</output>',result) is not None

def plan(command,result,fallbacks=0):
 if fallbacks or not empty_result(result):return None
 query=parse(command)
 if not query or not re.search(r'\.(?:py|txt|rst|md|cfg|ini|toml|yaml|yml|json|html|css|js)$',query['path']):return None
 parent=posixpath.dirname(query['path'])
 if parent=='/testbed':return None
 return {'cwd':query['cwd'],'pattern':query['pattern'],'path':parent,'recursive':True,'numbered':False,'argv':['grep','-r','--',query['pattern'],parent],'requiresBoundedTreeEnumerationAndUnchangedState':True,'maxOutputBytes':POLICY['maxOutputBytes'],'timeoutSeconds':5}
def observed_result(result):return isinstance(result,str) and len(result.encode())<=16000 and re.fullmatch(r'<returncode>[01]</returncode>\n<output>.*</output>',result,re.S) is not None and not re.search(r'(?i)truncated|binary file .*matches',result)
def singleton(turn):
 if len(turn['actions'])!=1:return None
 a=turn['actions'][0]
 return a if a['name']=='bash' and isinstance(a['command'],str) and len(a['results'])==1 else None

def analyze(raw,label):
 turns=normalize(raw);proposals=[];events=[];diagnostics=collections.Counter();used=set()
 for i,t in enumerate(turns[:-1]):
  a=singleton(t)
  if not a:continue
  if empty_result(a['results'][0]) and 'grep' in a['command']:diagnostics['emptyGrepLikeResponses']+=1
  p=plan(a['command'],a['results'][0])
  if not p:continue
  row={'cohort':label,'instance':raw['instance_id'],'sourceOrdinal':i,'targetOrdinal':i+1,'partition':partition(raw['instance_id']),'matched':False};proposals.append(row)
  nexta=singleton(turns[i+1])
  if not nexta:diagnostics['nextNotSingletonObservedBash']+=1;continue
  q=parse(nexta['command'])
  if q!={k:p[k] for k in ['cwd','pattern','path','recursive','numbered']}:diagnostics['nextCommandDiffers']+=1;continue
  if not observed_result(nexta['results'][0]):diagnostics['nextResultOutsideBounds']+=1;continue
  if i in used or i+1 in used:diagnostics['overlapExcluded']+=1;continue
  used.add(i+1);row['matched']=True
  target=turns[i+1];m=raw['messages'][target['sourceMessageIndex']]
  reason=any(x.get('type')!='function_call' for x in m.get('output',[])) if m.get('object')=='response' else bool(m.get('content')) or bool(m.get('reasoning_content')) or ((target['usage'] or {}).get('reasoningOutputTokens') or 0)>0
  events.append({**row,'matchType':'exact','usage':target['usage'],'reportedCost':target['reportedCost'],'reasoningOrProse':reason,'requiresRuntimeTreeGuards':True})
 return turns,proposals,events,dict(diagnostics)

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest',type=pathlib.Path,required=True);p.add_argument('--public',type=pathlib.Path,required=True);p.add_argument('--private',type=pathlib.Path,required=True);a=p.parse_args();manifest=json.loads(a.manifest.read_text());rows=[];events=[]
 for f in manifest['files']:
  data=pathlib.Path(f['local']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Source checksum mismatch')
  raw=json.loads(data);ts,ps,es,d=analyze(raw,f['label']);rows.append({'cohort':f['label'],'instance':raw['instance_id'],'partition':partition(raw['instance_id']),'turns':ts,'proposals':ps,'events':es,'diagnostics':d});events.extend(es)
 def summary(rs):
  ts=[t for r in rs for t in r['turns']];ps=[p for r in rs for p in r['proposals']];es=[e for r in rs for e in r['events']];den=usage.sums(ts);gain=usage.sums(es)
  return {'trajectories':len(rs),'issues':len({r['instance'] for r in rs}),'denominator':den,'proposals':len(ps),'matchedCalls':len(es),'matchedIssues':len({e['instance'] for e in es}),'matchedUsage':gain,'matchPercent':100*len(es)/len(ps) if ps else 0,'callPercent':100*len(es)/den['calls'] if den['calls'] else 0,'tokenPercent':100*gain['totalTokens']/den['totalTokens'] if den['totalTokens'] else 0,'matchesWithReasoningOrProse':sum(e['reasoningOrProse'] for e in es),'diagnostics':dict(sum((collections.Counter(r['diagnostics']) for r in rs),collections.Counter()))}
 report={'version':5,'program':PROGRAM,'title':TITLE,'kind':'conditional-gross-recorded-usage-replay-estimate','policy':POLICY,**summary(rows),'cohorts':{c:summary([r for r in rows if r['cohort']==c]) for c in sorted({r['cohort'] for r in rows})},'byPartition':{g:summary([r for r in rows if r['partition']==g]) for g in ['discovery','validation']},'split':{'method':"SHA256('autotoken-v5:'+instance_id)%5==0 discovery, other issues validation; all models for an issue grouped",'policyFrozenBeforeValidation':True,'notUntouchedExternalCorpus':True},'sourceManifestSha256':hashlib.sha256(a.manifest.read_bytes()).hexdigest(),'plannerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'limitations':['Plans derive immediate parent directory and unchanged literal query from the empty current search only; next calls are labels.','Fixed recursive no-line-number output is a new search operation, not an equivalent rendering of the failed source command. Exact match means same normalized target operation.','Only plain grep, simple literal patterns and one explicit repository file are supported; regex, pipes, redirects, bundles, multiple paths and root-wide fallback abstain.','A runtime executor must enumerate a symlink-free unchanged parent tree within file/count/byte bounds before a registered grep execution. Those historical filesystem conditions are not verified.','Whole singleton next response and bounded successful/no-match result are required. Removing accompanying reasoning may affect task quality.','Gross token usage belongs to matched original calls, not measured savings. Router, traversal/execution, false-positive, extra-output and future-cache costs are excluded.','Cache and reasoning counts are subsets of input/output totals; no double counting.','Discovery and validation are issue-grouped within an already reused corpus; no untouched external validation claim.','No recorded commands executed or paid inference used.']}
 a.public.write_text(json.dumps(report,indent=2)+'\n');a.private.parent.mkdir(parents=True,exist_ok=True);a.private.write_text(json.dumps(events,indent=2)+'\n');a.private.chmod(0o600);print(json.dumps({k:report[k] for k in ['proposals','matchedCalls','matchedIssues','matchedUsage','callPercent','tokenPercent','matchPercent']},indent=2))
if __name__=='__main__':main()
