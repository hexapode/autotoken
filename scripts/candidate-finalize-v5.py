"""Inert, explicit-opt-in finish-after-verification conditional scenario.

Historical opt-in and required-test registration are absent: deployment credit
is always zero. This module never executes tests or submits a task.
"""
import argparse,collections,hashlib,importlib.util,json,pathlib,re,shlex
from trace_batch_core import normalize
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('finalize_usage',ROOT/'scripts/estimate-recorded-usage.py');usage=importlib.util.module_from_spec(spec);spec.loader.exec_module(usage)
PROGRAM='explicit_finish_after_verification_v5';TITLE='Finish only under an explicit registered verification policy'
FINISH='COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT'
POLICY={'root':'/testbed','maxCommandBytes':4096,'maxOutputBytes':32768,'maxVerificationHistoryTurns':4,'requiredEvidence':['registered exact pytest argv succeeds with positive passed-count summary','subsequent successful full-tree git diff --check','no intervening unknown or mutating action'],'requiresExplicitRegisteredCompletionPolicy':True,'requiresRegisteredRequiredTestCommand':True,'requiresUnchangedTreeAndEnvironment':True,'requiresNoUnverifiedStagedOrUntrackedChanges':True,'historicalOptInPresent':False,'deploymentCreditCalls':0,'terminalCommand':FINISH,'allowFinalProseInstead':False}
def partition(issue):return 'discovery' if int(hashlib.sha256(('autotoken-v5:'+issue).encode()).hexdigest(),16)%5==0 else 'validation'
def singleton(turn,observed=True):
 if len(turn['actions'])!=1:return None
 a=turn['actions'][0]
 return a if a['name']=='bash' and isinstance(a.get('command'),str) and (not observed or len(a['results'])==1) else None

def successful_output(result):
 if not isinstance(result,str) or len(result.encode())>POLICY['maxOutputBytes']:return None
 m=re.fullmatch(r'<returncode>0</returncode>\n<output>\n?(.*?)\n?</output>',result,re.S)
 if not m or re.search(r'(?i)truncated|timed out|timeout exceeded',m[1]):return None
 return m[1]

def parse_operations(command):
 if not isinstance(command,str) or len(command.encode())>4096:return None
 command=command.strip()
 if command.startswith('cd /testbed && '):command=command[len('cd /testbed && '):]
 pieces=command.split(' && ')
 if not 1<=len(pieces)<=4:return None
 operations=[]
 for piece in pieces:
  if piece.endswith(' 2>&1'):piece=piece[:-5]
  if any(c in piece for c in ['\n','\r',';','|','&','>','<','`','$','\\']):return None
  try:argv=shlex.split(piece)
  except ValueError:return None
  if argv in [['git','diff','--check'],['git','diff','--check','HEAD']]:operations.append({'kind':'check'});continue
  if argv in [['git','diff'],['git','diff','--stat'],['git','status','--short'],['git','status','--porcelain']]:operations.append({'kind':'review'});continue
  prefix=3 if argv[:3] in [['python','-m','pytest'],['python3','-m','pytest']] else 1 if argv[:1]==['pytest'] else 0
  if not prefix:return None
  args=argv[prefix:];i=0
  while i<len(args):
   x=args[i]
   if re.fullmatch(r'-[qvxrs]+',x) or x in ['--disable-warnings','--tb=short','--tb=long','--tb=no','--maxfail=1']:pass
   elif x=='-k':
    i+=1
    if i>=len(args) or not re.fullmatch(r'[A-Za-z0-9_ ()]{1,200}',args[i]):return None
   elif not re.fullmatch(r'[A-Za-z0-9_./:\[\],=-]{1,240}',x) or x.startswith('-') or '..' in x.split('/') or x.startswith('/'):return None
   i+=1
  operations.append({'kind':'test','argv':argv})
 if sum(o['kind']=='test' for o in operations)>1:return None
 return operations

def test_passed(output):
 return bool(re.search(r'\b[1-9]\d* passed\b',output)) and not re.search(r'\b[1-9]\d* (?:failed|errors?)\b|^FAILED |^ERROR ',output,re.M)

def advance(state,command,result,ordinal):
 """Prior-only state update. No next command enters this predicate."""
 ops=parse_operations(command);output=successful_output(result)
 if ops is None or output is None:return None,None
 test=state
 if test is not None and ordinal-test['ordinal']>POLICY['maxVerificationHistoryTurns']:test=None
 proposal=None
 for op in ops:
  if op['kind']=='test':
   proposal=None
   if not test_passed(output):return None,None
   test={'ordinal':ordinal,'argv':op['argv']}
  elif op['kind']=='check' and test is not None:
   proposal={'registeredTestArgvScenario':test['argv'],'testOrdinal':test['ordinal'],'sourceOrdinal':ordinal,'argv':[FINISH],'requiresExplicitRegisteredCompletionPolicy':True,'historicalOptInVerified':False}
 return test,proposal

def reasoning(raw,t):
 m=raw['messages'][t['sourceMessageIndex']]
 return any(x.get('type')!='function_call' for x in m.get('output',[])) if m.get('object')=='response' else bool(m.get('content')) or bool(m.get('reasoning_content')) or ((t['usage'] or {}).get('reasoningOutputTokens') or 0)>0

def analyze(raw,label):
 turns=normalize(raw);proposals=[];events=[];diag=collections.Counter();state=None
 for i,t in enumerate(turns[:-1]):
  a=singleton(t)
  if not a:state=None;continue
  if 'git diff --check' in a['command']:diag['diffCheckLikeTurns']+=1
  ops=parse_operations(a['command'])
  if ops and any(o['kind']=='check' for o in ops) and successful_output(a['results'][0]) is not None:diag['supportedPassedFullTreeCheckTurns']+=1
  state,p=advance(state,a['command'],a['results'][0],i)
  if not p:continue
  row={'cohort':label,'instance':raw['instance_id'],'sourceOrdinal':i,'targetOrdinal':i+1,'partition':partition(raw['instance_id']),'matched':False,'historicalOptInVerified':False};proposals.append(row)
  nxt=turns[i+1];n=singleton(nxt,observed=False)
  if not n or n['command'].strip()!=FINISH:diag['nextNotExactNativeSubmission']+=1;continue
  row['matched']=True
  events.append({**row,'matchType':'exact','usage':nxt['usage'],'reportedCost':nxt['reportedCost'],'reasoningOrProse':reasoning(raw,nxt),'conditionalOptInScenarioOnly':True,'deploymentCreditCalls':0})
 return turns,proposals,events,dict(diag)

def summarize(rows):
 ts=[t for r in rows for t in r['turns']];ps=[p for r in rows for p in r['proposals']];es=[e for r in rows for e in r['events']];den=usage.sums(ts);gain=usage.sums(es)
 return {'trajectories':len(rows),'issues':len({r['instance'] for r in rows}),'denominator':den,'proposals':len(ps),'matchedCalls':len(es),'matchedIssues':len({e['instance'] for e in es}),'matchedUsage':gain,'matchPercent':100*len(es)/len(ps) if ps else None,'callPercent':100*len(es)/den['calls'] if den['calls'] else 0,'tokenPercent':100*gain['totalTokens']/den['totalTokens'] if den['totalTokens'] else 0,'deploymentCreditCalls':0,'deploymentCreditTokens':0,'matchesWithReasoningOrProse':sum(e['reasoningOrProse'] for e in es),'diagnostics':dict(sum((collections.Counter(r['diagnostics']) for r in rows),collections.Counter()))}
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--manifest',type=pathlib.Path,required=True);parser.add_argument('--public',type=pathlib.Path,required=True);parser.add_argument('--private',type=pathlib.Path,required=True);args=parser.parse_args();manifest=json.loads(args.manifest.read_text());rows=[];events=[]
 for f in manifest['files']:
  data=pathlib.Path(f['local']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Source checksum mismatch')
  raw=json.loads(data);turns,proposals,matched,diag=analyze(raw,f['label']);rows.append({'cohort':f['label'],'instance':raw['instance_id'],'partition':partition(raw['instance_id']),'turns':turns,'proposals':proposals,'events':matched,'diagnostics':diag});events.extend(matched)
 report={'version':5,'program':PROGRAM,'title':TITLE,'kind':'hypothetical-explicit-opt-in-completion-scenario','policy':POLICY,**summarize(rows),'byPartition':{p:summarize([r for r in rows if r['partition']==p]) for p in ['discovery','validation']},'cohorts':{c:summarize([r for r in rows if r['cohort']==c]) for c in sorted({r['cohort'] for r in rows})},'split':{'method':"SHA256('autotoken-v5:'+issue)%5==0 discovery; remaining validation; issue grouped across models",'policyFrozenBeforeValidation':True,'notUntouchedExternalCorpus':True},'sourceManifestSha256':hashlib.sha256(args.manifest.read_bytes()).hexdigest(),'plannerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'limitations':['Historical explicit completion opt-in and required-test registration are absent: deployment credit is zero even when a conditional syntax match exists.','The scenario treats the exact prior pytest argv as hypothetically registered required verification, never a registration inferred for deployment.','A positive pytest summary alone never proposes completion: a later successful full-tree diff check is required within four turns and only supported read-only operations can intervene.','Pipelines, partial-file checks, redirects other than stderr merge, unknown/mutating actions, failed tests, missing results and stale verification abstain.','Historical check does not prove staged/untracked changes are approved or that the test selection is sufficient. Runtime policy must register these conditions.','Exact singleton native submission is the primary label; final prose and submission bundles are not equivalent.','Submission may contain needed reasoning; removing it can prematurely finish an incomplete task.','Matched original usage is a conditional gross opportunity, not validated savings. Router, policy registration, reasoning loss and changed future context/cache costs are excluded.','Cache/reasoning counts are subsets of input/output totals; no double counting.','No recorded commands executed, tasks submitted or paid inference used.']}
 args.public.parent.mkdir(parents=True,exist_ok=True);args.public.write_text(json.dumps(report,indent=2)+'\n');args.private.parent.mkdir(parents=True,exist_ok=True);args.private.write_text(json.dumps(events,indent=2)+'\n');args.private.chmod(0o600);print(json.dumps({k:report[k] for k in ['proposals','matchedCalls','matchedUsage','callPercent','tokenPercent','matchPercent','diagnostics']},indent=2))
if __name__=='__main__':main()
