"""Inert state machine: write reproduction, run, classify, read failure context."""
import argparse, collections, hashlib, importlib.util, json, pathlib, re
from trace_batch_core import normalize
ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
w=load('repro_write','candidate-write-run-v2.py');t=load('repro_traceback','candidate-traceback-context-v4.py');u=w.usage
PROGRAM='workflow_repro_v6';TITLE='Run a fresh reproduction and classify its failure'
POLICY={'states':['fresh-write','run-known-script','classify-result','read-application-frame-or-stop'],'namePrefixes':['repro','test_','debug_','check_','verify'],'interpreter':'python','maxWriteBytes':65536,'maxObservationBytes':65536,'maxOutputBytes':16000,'timeoutSeconds':10,'contextRadius':50,'maxFollowupReads':1,'noInstallation':True,'noSourceModification':True,'runtimeRequires':['explicit reproduction-workflow execution opt-in','unchanged script SHA256 before run','known interpreter and cwd','sandbox execution with time/output limits','no symlinks and unchanged repository file before read']}
def partition(instance):return 'discovery' if int(hashlib.sha256(('autotoken-v6:'+instance).encode()).hexdigest(),16)%5==0 else 'validation'
def start(command,result):
 p=w.plan(command,result)
 if not p or not pathlib.PurePosixPath(p['argv'][1]).name.startswith(tuple(POLICY['namePrefixes'])):return None
 return {**p,'state':'run-known-script'}
def classify(result):
 if not isinstance(result,str) or len(result.encode())>65536:return 'unusable'
 m=re.fullmatch(r'<returncode>([0-9]+)</returncode>\n<output>\n?(.*?)\n?</output>',result,re.S)
 if not m or re.search(r'truncat|output too long',m[2],re.I):return 'unusable'
 if m[1]=='0':return 'completed'
 if re.search(r'ImportError|ModuleNotFoundError|ERROR collecting|ERROR at setup|fixture .* not found|command not found',m[2]):return 'environment-or-import-failure'
 if 'Traceback (most recent call last):' in m[2]:return 'application-traceback'
 return 'nonzero-without-traceback'
def advance(state,command,result):
 """Transition only after the exact planned script ran; never inspect next action."""
 if w.parse_run(command)!={k:state[k] for k in ['argv','cwd']}:return None
 kind=classify(result);context=t.plan(command,result) if kind=='application-traceback' else None
 return {'state':'read-application-frame' if context else 'stop','classification':kind,'context':context,'scriptSha256':state['sha256']}
def analyze(raw,label):
 turns=normalize(raw);ps=[];es=[];ds=collections.Counter()
 for i,turn in enumerate(turns):
  a=t.singleton(turn)
  if not a:continue
  state=start(a['command'],a['results'][0])
  if not state:continue
  wid=hashlib.sha256(f"{label}:{raw['instance_id']}:{i}:{state['sha256']}".encode()).hexdigest()[:24]
  base={'cohort':label,'instance':raw['instance_id'],'partition':partition(raw['instance_id']),'workflowId':wid,'workflowStartOrdinal':i,'scriptSha256':state['sha256']}
  p={**base,'sourceOrdinal':i,'targetOrdinal':i+1,'workflowStep':1,'matched':False};ps.append(p)
  if i+1>=len(turns):continue
  n=t.singleton(turns[i+1])
  if not n:continue
  outcome=advance(state,n['command'],n['results'][0])
  if not outcome or outcome['classification']=='unusable':continue
  p['matched']=True;ds[outcome['classification']]+=1
  es.append({**p,'matchType':'exact','usage':turns[i+1]['usage'],'reportedCost':turns[i+1]['reportedCost'],'classification':outcome['classification'],'dependencyTargetOrdinal':None,'overlapsWriteRunV2':True,'plan':state,'reasoningOrProse':t.observed_reasoning(raw,turns[i+1])})
  context=outcome['context']
  if not context:continue
  q={**base,'sourceOrdinal':i+1,'targetOrdinal':i+2,'workflowStep':2,'dependencyTargetOrdinal':i+1,'matched':False};ps.append(q)
  ds['contextProposals']+=1
  if i+2>=len(turns):continue
  nxt=t.singleton(turns[i+2])
  if not nxt:continue
  kind=t.reader.classify(context,t.reader.read(nxt['command'],nxt['results'][0]))
  if not kind:continue
  q['matched']=kind=='exact'
  es.append({**q,'matchType':kind,'usage':turns[i+2]['usage'],'reportedCost':turns[i+2]['reportedCost'],'plan':context,'reasoningOrProse':t.observed_reasoning(raw,turns[i+2]),'overlapsTracebackContextV4':True})
 return turns,ps,es,dict(ds)
def main():
 ap=argparse.ArgumentParser(description=__doc__)
 for name in ['manifest','public','private']:ap.add_argument('--'+name,required=True,type=pathlib.Path)
 args=ap.parse_args();manifest=json.loads(args.manifest.read_text());rows=[];events=[]
 for f in manifest['files']:
  data=pathlib.Path(f['local']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Checksum mismatch')
  raw=json.loads(data);ts,ps,es,ds=analyze(raw,f['label']);rows.append({'cohort':f['label'],'instance':raw['instance_id'],'partition':partition(raw['instance_id']),'turns':ts,'proposals':ps,'events':es,'diagnostics':ds});events.extend(es)
 def summary(rs):
  ts=[t for r in rs for t in r['turns']];ps=[p for r in rs for p in r['proposals']];es=[e for r in rs for e in r['events'] if e['matchType']=='exact'];cs=[e for r in rs for e in r['events'] if e['matchType']=='coverage_only'];den=u.sums(ts);gain=u.sums(es);second=[e for e in es if e['workflowStep']==2]
  return {'trajectories':len(rs),'issues':len({r['instance'] for r in rs}),'denominator':den,'proposals':len(ps),'matchedCalls':len(es),'uniqueMatchedCalls':len({(e['cohort'],e['instance'],e['targetOrdinal']) for e in es}),'matchedIssues':len({e['instance'] for e in es}),'matchedUsage':gain,'callPercent':100*len(es)/den['calls'] if den['calls'] else 0,'tokenPercent':100*gain['totalTokens']/den['totalTokens'] if den['totalTokens'] else 0,'completeTwoStepChains':len(second),'secondStageMatches':len(second),'secondStageUsage':u.sums(second),'coverageOnly':{'calls':len(cs),'usage':u.sums(cs)},'diagnostics':dict(sum((collections.Counter(r['diagnostics']) for r in rs),collections.Counter()))}
 report={'program':PROGRAM,'title':TITLE,'version':6,'kind':'conditional-gross-recorded-usage-replay-estimate','policy':POLICY,**summary(rows),'cohorts':{c:summary([r for r in rows if r['cohort']==c]) for c in sorted({r['cohort'] for r in rows})},'byPartition':{p:summary([r for r in rows if r['partition']==p]) for p in ['discovery','validation']},'split':{'method':"SHA256('autotoken-v6:'+instance_id)%5==0 discovery; others validation",'policyFrozenBeforeValidation':True,'caveat':'Previously studied corpus, not external validation'},'plannerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'dependencyHashes':{pathlib.Path(m.__file__).name:hashlib.sha256(pathlib.Path(m.__file__).read_bytes()).hexdigest() for m in [w,t,t.reader]},'incrementalComparedWithExistingPrograms':{'calls':0,'reason':'Run stage is a strict subset of write-run v2, context stage a strict subset of traceback-context v4; this tests composition rather than a new matching grammar.'},'extraWork':{'matchedStepsExtraToolInvocations':0,'unmatchedRunProposalMaximumExtraInvocations':1,'afterEligibleTracebackMaximumExtraReads':1,'maximumExtraReadBytes':16000,'classifierMaximumOutputBytes':256,'netCostMeasured':False,'note':'Matched stages perform the same tool operation; unmatched routes can add a script execution/read and subsequent tokens. Classification needs no tool invocation.'},'conservativeDeploymentCredit':{'calls':0,'tokens':0},'limitations':['Inert planner and offline replay, not a live executor. No recorded commands executed and no paid calls.','Fresh-script execution still requires explicit opt-in; filenames do not establish intent or safety. Runtime hashes, sandbox, interpreter, cwd and symlink checks are not observed in traces.','Completion means exit zero, not correct reproduction or solved issue. Import/setup failures stop without installing or changing code.','Step 2 is causally dependent on step 1 and uses only its observed output; adjacent chain events must not be naively added to an independent union.','First-stage matches overlap old write-run v2; context policy overlaps traceback-context v4. New program complexity does not imply new savings.','Coverage-only reads are excluded from exact savings. Wider output and cache/router/fallback costs are not measured.','A matching singleton response may contain useful reasoning; task quality and actual token savings are untested.','Reported usage is historical gross exposure, not net savings; cached/reasoning tokens are subsets.']}
 args.public.write_text(json.dumps(report,indent=2)+'\n');args.private.parent.mkdir(parents=True,exist_ok=True)
 for suffix,ev in [('',[e for e in events if e['matchType']=='exact']),('-coverage',[e for e in events if e['matchType']=='coverage_only'])]:
  path=args.private.with_name(args.private.stem+suffix+'.json');path.write_text(json.dumps(ev,indent=2)+'\n');path.chmod(0o600)
 print(json.dumps({k:report[k] for k in ['proposals','matchedCalls','matchedUsage','callPercent','tokenPercent','completeTwoStepChains','coverageOnly','diagnostics']},indent=2))
if __name__=='__main__':main()
