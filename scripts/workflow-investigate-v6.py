"""Inert bounded Python investigation state machine; never executes recorded commands."""
import argparse,collections,hashlib,importlib.util,io,json,pathlib,re,textwrap,tokenize
from trace_batch_core import normalize
ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
sr=load('investigate_sr','candidate-search-read-v2.py');usage=load('investigate_usage','estimate-recorded-usage.py')
continuation=load('investigate_continuation','candidate-read-continuation-v4.py')
PROGRAM='workflow_investigate_v6';TITLE='Investigate a unique Python definition and expand proven cutoffs'
POLICY={'initialRange':'unique definition line through next strictly greater multiple of 100','expansionRange':'previous end through previous end+100','cutoffEvidence':'Python tokenize EOF in multi-line string or statement','maxReads':2,'maxFanout':1,'maxOutputBytesPerRead':16000,'maxFileBytes':1000000,'timeoutSecondsPerRead':5,'requiresUnchangedRegularFileWithoutSymlinks':True}
def partition(issue):return 'discovery' if int(hashlib.sha256(('autotoken-v6:'+issue).encode()).hexdigest(),16)%5==0 else 'validation'
def singleton(t):
 if len(t['actions'])!=1:return None
 a=t['actions'][0];return a if a['name']=='bash' and len(a['results'])==1 else None
def start(command,result):
 p=sr.plan(command,result);o=sr.output(result)
 if not p or p['kind']!='unique_line_context' or not p['path'].endswith('.py'):return None
 m=re.fullmatch(r'(?:(.+):)?([1-9][0-9]*):(\s*(?:async\s+)?(?:def|class)\s+[A-Za-z_]\w*.*)',o)
 if not m:return None
 n=int(m[2]);return {'path':p['path'],'start':n,'end':(n//100+1)*100,'step':1,'maxOutputBytes':16000}
def advance(state,command,result):
 """Only an exactly observed planned read can advance the finite state machine."""
 r=sr.read(command,result)
 if state['step']!=1 or sr.classify(state,r)!='exact' or r['observedLines']!=state['end']-state['start']+1:return None
 source=sr.output(result)
 try:list(tokenize.generate_tokens(io.StringIO(textwrap.dedent(source)).readline))
 except tokenize.TokenError as e:
  if e.args[0] not in ('EOF in multi-line string','EOF in multi-line statement'):return None
  return {'path':state['path'],'start':state['end'],'end':state['end']+100,'step':2,'maxOutputBytes':16000,'cutoffEvidence':e.args[0]}
 except (IndentationError,SyntaxError):return None
 return None
def analyze(raw,label):
 ts=normalize(raw);ps=[];es=[];diag=collections.Counter();covered=[]
 for i,t in enumerate(ts[:-1]):
  a=singleton(t)
  if not a:continue
  state=start(a['command'],a['results'][0])
  if not state:continue
  wid=f'{label}:{raw["instance_id"]}:{i}';j=i+1;steps=[]
  while state and j<len(ts):
   row={'cohort':label,'instance':raw['instance_id'],'partition':partition(raw['instance_id']),'sourceOrdinal':j-1,'targetOrdinal':j,'workflowId':wid,'workflowStartOrdinal':i,'workflowStep':state['step'],'dependencyTargetOrdinal':j-1 if state['step']==2 else None,'step':state['step'],'matched':False};ps.append(row);diag['stage'+str(state['step'])+'Proposals']+=1
   b=singleton(ts[j]);kind=sr.classify(state,sr.read(b['command'],b['results'][0])) if b else None
   if kind=='coverage_only':diag['coverageOnlyCalls']+=1;covered.append({'usage':ts[j]['usage'],'reportedCost':ts[j]['reportedCost']})
   if kind!='exact':break
   row['matched']=True;event={**row,'matchType':'exact','usage':ts[j]['usage'],'reportedCost':ts[j]['reportedCost'],'plan':state,'completeSequence':False,'reasoningOrProse':continuation.reasoning(raw,ts[j]),'overlapSearchReadV2':False,'overlapReadContinuationV4':False}
   if state['step']==1:event['overlapSearchReadV2']=sr.classify(sr.plan(a['command'],a['results'][0]),sr.read(b['command'],b['results'][0]))=='exact'
   else:
    prior=singleton(ts[j-1]);cp=continuation.plan(prior['command'],prior['results'][0]);event['overlapReadContinuationV4']=bool(cp and sr.classify(cp,sr.read(b['command'],b['results'][0]))=='exact')
   es.append(event);steps.append(event);diag['stage'+str(state['step'])+'Matches']+=1
   state=advance(state,b['command'],b['results'][0]);j+=1
  if len(steps)==2:
   diag['completeSequences']+=1
   for e in steps:e['completeSequence']=True
 diag['coverageOnlyTokens']=usage.sums(covered)['totalTokens']
 return ts,ps,es,dict(diag)
def main():
 p=argparse.ArgumentParser(description=__doc__)
 for x in ['manifest','public','private']:p.add_argument('--'+x,type=pathlib.Path,required=True)
 a=p.parse_args();rows=[];events=[]
 for f in json.loads(a.manifest.read_text())['files']:
  data=pathlib.Path(f['local']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Source checksum mismatch')
  raw=json.loads(data);ts,ps,es,d=analyze(raw,f['label']);rows.append({'cohort':f['label'],'instance':raw['instance_id'],'partition':partition(raw['instance_id']),'turns':ts,'proposals':ps,'events':es,'diagnostics':d});events.extend(es)
 def summary(rs):
  ts=[t for r in rs for t in r['turns']];ps=[p for r in rs for p in r['proposals']];es=[e for r in rs for e in r['events']];den=usage.sums(ts);gain=usage.sums(es);ds=dict(sum((collections.Counter(r['diagnostics']) for r in rs),collections.Counter()))
  return {'trajectories':len(rs),'issues':len({r['instance']for r in rs}),'denominator':den,'proposals':len(ps),'matchedCalls':len(es),'matchedIssues':len({e['instance']for e in es}),'matchedUsage':gain,'precision':len(es)/len(ps) if ps else 0,'callPercent':100*len(es)/den['calls'] if den['calls'] else 0,'tokenPercent':100*gain['totalTokens']/den['totalTokens'] if den['totalTokens'] else 0,'completeSequences':ds.get('completeSequences',0),'completeSequenceUsage':usage.sums([e for e in es if e['completeSequence']]),'diagnostics':ds,'overlap':{'searchReadV2':sum(e['overlapSearchReadV2']for e in es),'readContinuationV4':sum(e['overlapReadContinuationV4']for e in es)}}
 report={'version':6,'program':PROGRAM,'title':TITLE,'kind':'conditional-gross-recorded-usage-replay-estimate','policy':POLICY,**summary(rows),'cohorts':{c:summary([r for r in rows if r['cohort']==c])for c in sorted({r['cohort']for r in rows})},'byPartition':{g:summary([r for r in rows if r['partition']==g])for g in ['discovery','validation']},'split':{'method':"SHA256('autotoken-v6:'+instance_id)%5==0 discovery",'policyFrozenBeforeValidation':True},'plannerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'sourceManifestSha256':hashlib.sha256(a.manifest.read_bytes()).hexdigest(),'overhead':{'maxAdditionalToolCallsPerWorkflow':2,'maxAdditionalOutputBytesPerWorkflow':32000,'exactMatchExtraToolCalls':0,'exactMatchExtraOutputBytes':0,'unmatchedProposalToolAndOutputCost':'not observed; up to two reads and 32KB; excluded from savings'},'limitations':['Partial first-stage matches are not complete workflows. Complete sequences require both exact successive reads.','Search is an existing observed call, not claimed saved. Next commands only label the frozen plan.','Coverage-only calls are diagnostic opportunities, not exact savings. Their output overhead is unmeasured.','Lexical incompleteness is stronger than indentation but does not prove a further read helps resolve an issue.','Regular-file, unchanged-version, size and timeout guards require a runtime executor; historical filesystem is not reconstructed.','Observed reasoning accompanying tool calls is not reproduced; no causal saved calls demonstrated.','Reported precision is exact command agreement, not task correctness. Gross recorded tokens exclude routing, fallback, extra output and cache effects.','All models for each issue share partition; reused corpus is not untouched external validation.','No paid inference or recorded command execution.']}
 a.public.write_text(json.dumps(report,indent=2)+'\n');a.private.parent.mkdir(parents=True,exist_ok=True);a.private.write_text(json.dumps(events,indent=2)+'\n');a.private.chmod(0o600);print(json.dumps({k:report[k]for k in ['proposals','matchedCalls','matchedUsage','completeSequences','callPercent','tokenPercent','diagnostics']},indent=2))
if __name__=='__main__':main()
