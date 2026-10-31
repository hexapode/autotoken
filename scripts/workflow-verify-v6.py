"""Guarded edit -> compile -> registered focused-test verification workflow.

Planner/state machine only. No recorded command is executed. Replay registration,
file hashes and environment identity are counterfactual, so deployment credit is 0.
"""
import argparse,collections,hashlib,importlib.util,json,pathlib,re,shlex
from trace_batch_core import normalize
ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
base=load('verify_base','candidate-rerun-v2.py');u=load('verify_usage','estimate-recorded-usage.py')
PROGRAM='guarded_edit_compile_focused_test_v6';TITLE='Compile an edited file, then rerun a registered focused test'
POLICY={'root':'/testbed','compileInterpreter':'python','maxHistoryTurns':12,'maxFocusedTargets':4,'maxCompileOutputBytes':16384,'maxTestOutputBytes':32000,'compileTimeoutSeconds':10,'testTimeoutSeconds':120,'maxSteps':2,'requiresExplicitRegisteredWorkflow':True,'requiresSourceTestHashesAndTreeEpoch':True,'requiresSameCwdAndEnvironment':True,'historicalRegistrationVerified':False,'deploymentCreditCalls':0,'bytecodeWrites':'py_compile can write __pycache__; this expected side effect must be permitted separately from source/test hashes'}
def partition(issue):return 'discovery' if int(hashlib.sha256(('autotoken-v6:'+issue).encode()).hexdigest(),16)%5==0 else 'validation'
def bounded_result(text,limit):
 if not isinstance(text,str) or len(text.encode())>limit or re.search(r'(?i)truncated|timed out|timeout exceeded',text):return None
 m=re.fullmatch(r'<returncode>(-?\d+)</returncode>\n<output>.*</output>',text,re.S)
 return int(m[1]) if m else None

def focused_test(command):
 p=base.test_command(command)
 if not p or p.get('requiresScriptHashRegistration'):return None
 argv=p['argv'];offset=3 if argv[:3] in [['python','-m','pytest'],['python3','-m','pytest']] else 1 if argv[:1]==['pytest'] else None
 if offset is not None:
  targets=[x for x in argv[offset:] if not x.startswith('-')]
  if not 1<=len(targets)<=POLICY['maxFocusedTargets'] or any(not t.split('::')[0].endswith('.py') for t in targets):return None
 elif not (len(argv)==2 and argv[0] in ['python','python3'] and argv[1].endswith('.py')):return None
 return {'cwd':p['cwd'],'argv':argv}

def compile_command(command):
 if not isinstance(command,str) or len(command)>2048 or any(c in command for c in ['\n',';','|','>','<','`','$','\\']):return None
 cwd,body=base.strip_cd(command)
 if '&' in body:return None
 try:argv=shlex.split(body)
 except ValueError:return None
 if len(argv)!=4 or argv[:3]!=['python','-m','py_compile']:return None
 path=base.source_path(argv[3],cwd)
 return {'cwd':cwd,'argv':argv[:3]+[path]} if path else None

def recipe(test,path,cwd):
 if not test or test['cwd']!=cwd or not base.source_path(path,cwd):return None
 return {'cwd':cwd,'compile':['python','-m','py_compile',path],'test':test['argv'],'editedPath':path,'requiresRegisteredSourceAndTestHashes':True}

class VerificationWorkflow:
 """Executor-facing transition model; caller supplies verified snapshot guards.

No filesystem reads or process execution occur here. Guards must come from a
trusted runner, not from the model. Missing guards cannot activate a stage.
"""
 def __init__(self,test,*,explicit_opt_in,environment_id,test_hash):
  if not explicit_opt_in or not isinstance(environment_id,str) or not environment_id or not re.fullmatch('[0-9a-f]{64}',test_hash or ''):raise ValueError('Explicit registration and verified test hash required')
  if not test or not re.fullmatch(r'/testbed(?:/[A-Za-z0-9_-]+)*',test.get('cwd','')) or focused_test(shlex.join(test['argv'])) is None:raise ValueError('Focused test and confined cwd required')
  self.test=test;self.environment_id=environment_id;self.test_hash=test_hash;self.state='registered';self.plan=None
 def on_edit(self,path,*,edit_result,cwd,source_hash,tree_epoch,environment_id,test_hash):
  if self.state!='registered':return None
  if bounded_result(edit_result,16384)!=0 or environment_id!=self.environment_id or test_hash!=self.test_hash or not re.fullmatch('[0-9a-f]{64}',source_hash or '') or not isinstance(tree_epoch,str) or not tree_epoch:self.state='abstained';return None
  self.plan=recipe(self.test,path,cwd)
  if not self.plan:self.state='abstained';return None
  self.source_hash=source_hash;self.tree_epoch=tree_epoch;self.state='awaiting_compile'
  return {'step':'compile','cwd':cwd,'argv':self.plan['compile'],'timeoutSeconds':10,'maxOutputBytes':16384}
 def observe_compile(self,result,*,cwd,source_hash,test_hash,tree_epoch,environment_id):
  if self.state!='awaiting_compile':return None
  guards=(cwd==self.plan['cwd'] and source_hash==self.source_hash and test_hash==self.test_hash and tree_epoch==self.tree_epoch and environment_id==self.environment_id)
  if not guards or bounded_result(result,16384)!=0:self.state='abstained';return None
  self.state='awaiting_test';return {'step':'focused_test','cwd':cwd,'argv':self.plan['test'],'timeoutSeconds':120,'maxOutputBytes':32000}
 def observe_test(self,result):
  if self.state!='awaiting_test':return None
  code=bounded_result(result,32000);self.state='passed' if code==0 else 'failed' if code is not None else 'abstained';return self.state

def reasoning(raw,t):
 m=raw['messages'][t['sourceMessageIndex']]
 return any(x.get('type')!='function_call' for x in m.get('output',[])) if m.get('object')=='response' else bool(m.get('content')) or bool(m.get('reasoning_content')) or ((t['usage'] or {}).get('reasoningOutputTokens') or 0)>0

def analyze(raw,label):
 turns=normalize(raw);proposals=[];events=[];diag=collections.Counter();registered=None
 for i,t in enumerate(turns):
  a=base.singleton(t)
  if not a:continue
  # Prior test is a counterfactual registration scenario, never deployed opt-in.
  test=focused_test(a['command'])
  if test:
   registered={'test':test,'ordinal':i} if bounded_result(a['results'][0],32000)==0 else None
   continue
  path=base.edited_source(a['command'])
  if not path or bounded_result(a['results'][0],16384)!=0:continue
  diag['recognizedSuccessfulSourceEdits']+=1
  if not registered or i-registered['ordinal']>POLICY['maxHistoryTurns']:diag['noRecentSuccessfulFocusedRegistrationScenario']+=1;continue
  cwd,_=base.strip_cd(a['command']);p=recipe(registered['test'],path,cwd)
  if not p:diag['registrationCwdMismatch']+=1;continue
  workflow_id=f"{label}:{raw['instance_id']}:{i}";common={'cohort':label,'instance':raw['instance_id'],'sourceOrdinal':i,'partition':partition(raw['instance_id']),'workflowId':workflow_id,'workflowStartOrdinal':i,'conditionalRegistrationScenarioOnly':True,'deploymentCreditCalls':0}
  first={**common,'targetOrdinal':i+1,'step':'compile','stepIndex':1,'workflowStep':1,'dependencyTargetOrdinal':None,'matched':False};proposals.append(first)
  if i+1>=len(turns):diag['noNextTurnForCompile']+=1;continue
  nextturn=turns[i+1];n=base.singleton(nextturn)
  if not n or compile_command(n['command'])!={'cwd':cwd,'argv':p['compile']}:diag['nextNotExactCompile']+=1;continue
  if bounded_result(n['results'][0],16384) is None:diag['compileResultUnboundedOrMissing']+=1;continue
  first['matched']=True
  compile_event={**first,'matchType':'exact','usage':nextturn['usage'],'reportedCost':nextturn['reportedCost'],'reasoningOrProse':reasoning(raw,nextturn),'overlapsExistingEditCompileCandidate':True,'completeChain':False}
  events.append(compile_event)
  if bounded_result(n['results'][0],16384)!=0:diag['compileFailedWorkflowStopped']+=1;continue
  # Second stage was fixed in p before the compile/next-test label was observed.
  second={**common,'sourceOrdinal':i+1,'targetOrdinal':i+2,'step':'focused_test','stepIndex':2,'workflowStep':2,'dependencyTargetOrdinal':i+1,'matched':False};proposals.append(second)
  if i+2>=len(turns):diag['noNextTurnForFocusedTest']+=1;continue
  target=turns[i+2];ta=base.singleton(target)
  if not ta or focused_test(ta['command'])!={'cwd':cwd,'argv':p['test']}:diag['nextAfterCompileNotRegisteredTest']+=1;continue
  code=bounded_result(ta['results'][0],32000)
  if code is None:diag['testResultUnboundedOrMissing']+=1;continue
  second['matched']=True;compile_event['completeChain']=True
  events.append({**second,'matchType':'exact','usage':target['usage'],'reportedCost':target['reportedCost'],'reasoningOrProse':reasoning(raw,target),'overlapsExistingEditCompileCandidate':False,'completeChain':True,'testExitCode':code})
 return turns,proposals,events,dict(diag)

def summary(rows):
 turns=[t for r in rows for t in r['turns']];ps=[p for r in rows for p in r['proposals']];es=[e for r in rows for e in r['events']];den=u.sums(turns);gain=u.sums(es);first=[e for e in es if e['stepIndex']==1];second=[e for e in es if e['stepIndex']==2];chain=[e for e in es if e['completeChain']]
 return {'trajectories':len(rows),'issues':len({r['instance'] for r in rows}),'denominator':den,'proposals':len(ps),'workflowStarts':sum(p['stepIndex']==1 for p in ps),'matchedCalls':len(es),'matchedIssues':len({e['instance'] for e in es}),'matchedUsage':gain,'proposalMatchPercent':100*len(es)/len(ps) if ps else None,'callPercent':100*len(es)/den['calls'] if den['calls'] else 0,'tokenPercent':100*gain['totalTokens']/den['totalTokens'] if den['totalTokens'] else 0,'firstStepOverlap':{'calls':len(first),'usage':u.sums(first)},'newSecondStage':{'calls':len(second),'usage':u.sums(second)},'completeSequentialChains':{'chains':len({e['workflowId'] for e in second}),'calls':len(chain),'usage':u.sums(chain),'testExitCodes':dict(collections.Counter(e['testExitCode'] for e in second))},'unmatchedProposedSteps':sum(not p['matched'] for p in ps),'maxHypotheticalToolCallsIfEveryStartCompilesSuccessfully':2*sum(p['stepIndex']==1 for p in ps),'deploymentCreditCalls':0,'deploymentCreditTokens':0,'matchesWithReasoningOrProse':sum(e['reasoningOrProse'] for e in es),'diagnostics':dict(sum((collections.Counter(r['diagnostics']) for r in rows),collections.Counter()))}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest',type=pathlib.Path,required=True);p.add_argument('--public',type=pathlib.Path,required=True);p.add_argument('--private',type=pathlib.Path,required=True);a=p.parse_args();manifest=json.loads(a.manifest.read_text());rows=[];events=[]
 for f in manifest['files']:
  data=pathlib.Path(f['local']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Source checksum mismatch')
  raw=json.loads(data);ts,ps,es,ds=analyze(raw,f['label']);rows.append({'cohort':f['label'],'instance':raw['instance_id'],'partition':partition(raw['instance_id']),'turns':ts,'proposals':ps,'events':es,'diagnostics':ds});events.extend(es)
 report={'version':6,'program':PROGRAM,'title':TITLE,'kind':'conditional-multistep-workflow-replay','policy':POLICY,**summary(rows),'cohorts':{c:summary([r for r in rows if r['cohort']==c]) for c in sorted({r['cohort'] for r in rows})},'byPartition':{g:summary([r for r in rows if r['partition']==g]) for g in ['discovery','validation']},'split':{'method':"SHA256('autotoken-v6:'+issue)%5==0 discovery, all others validation; issue grouped across models",'policyFrozenBeforeValidation':True,'notUntouchedExternalCorpus':True},'sourceManifestSha256':hashlib.sha256(a.manifest.read_bytes()).hexdigest(),'plannerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'editDetectorSha256':hashlib.sha256(pathlib.Path(base.__file__).read_bytes()).hexdigest(),'limitations':['Replay uses a prior successful focused test as hypothetical registration; explicit registration, source/test hashes, environment identity and tree epoch are unobserved. Actual state machine requires trusted guards; deployment credit is zero.','Only bounded static single-source edits, exact python py_compile and exact registered test argv/cwd are supported. No guessed tests or added unsolicited intermediate steps receive match credit.','All matched compile calls overlap the prior edit-compile candidate; only exact subsequent focused-test calls are a new stage. Deduplicate target call keys in any conservative union.','Complete-chain usage includes both stages and must not be added again to first/second-stage totals.','Failed compile stops the workflow; test failures remain failures, not successful fixes. Tests may mutate artifacts, so runner must define permitted cache/output writes separately.','At most two tool calls and 130 seconds per workflow, with 16KB compile and 32KB test output caps. Unmatched proposals and possible extra test executions add cost rather than savings.','Proposed max tool-call count assumes every compile succeeds, not an estimate of actual runtime calls. No runtime/output token costs were measured.','No historical filesystem state reconstructed, commands executed, model calls made or bug outcomes validated.','Matching responses may contain needed reasoning; gross recorded usage is not net savings. Router, guard-hash, execution, false-positive, downstream context/cache and reasoning-loss costs are excluded.','Cache and reasoning are subsets of input/output totals; no double counting.']}
 a.public.parent.mkdir(parents=True,exist_ok=True);a.public.write_text(json.dumps(report,indent=2)+'\n');a.private.parent.mkdir(parents=True,exist_ok=True);a.private.write_text(json.dumps(events,indent=2)+'\n');a.private.chmod(0o600);print(json.dumps({k:report[k] for k in ['workflowStarts','proposals','matchedCalls','matchedIssues','tokenPercent','firstStepOverlap','newSecondStage','completeSequentialChains','diagnostics']},indent=2))
if __name__=='__main__':main()
