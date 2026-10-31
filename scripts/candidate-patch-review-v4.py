"""Inert successful source edit -> exact edited-file diff planner and replay."""
import argparse,collections,hashlib,importlib.util,json,pathlib,shlex
ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
base=load('patch_base','candidate-rerun-v2.py');core=load('patch_core','trace_batch_core.py');u=load('patch_usage','estimate-recorded-usage.py')
PROGRAM='edited_file_patch_review_v4';TITLE='Review the diff of the just-edited file'
POLICY={'root':'/testbed','maxOutputBytes':32768,'timeoutSeconds':10,'sourceEditGrammar':'Unchanged bounded sed substitution or single literal pathlib write from rerun-v2','requiresRegisteredRepository':True,'requiresRegularFileAndUnchangedState':True,'requiresNoExternalDiffOrTextconv':True}
def group(issue):return 'discovery' if int(hashlib.sha256(('autotoken-v4:'+issue).encode()).hexdigest(),16)%5==0 else 'validation'
def plan(command,result):
 if not base.success(result):return None
 path=base.edited_source(command)
 if not path:return None
 cwd,_=base.strip_cd(command)
 return {'cwd':cwd,'argv':['git','diff','--',path],'requiresExplicitReviewAfterEditPolicy':True,**POLICY}
def parse_diff(command):
 if not isinstance(command,str) or len(command)>4096:return None
 command=command.strip()
 if any(x in command for x in ['\n','\r',';','|','>','<','`','$','\\']):return None
 cwd,body=base.strip_cd(command)
 if '&' in body:return None
 try:words=shlex.split(body)
 except ValueError:return None
 if words[:2]!=['git','diff']:return None
 args=words[2:];terminated=bool(args and args[0]=='--')
 if terminated:args=args[1:]
 if len(args)!=1 or (args[0].startswith('-') and not terminated):return None
 path=base.source_path(args[0],cwd)
 return {'cwd':cwd,'argv':['git','diff','--',path]} if path else None

def reasoning(raw,t):
 m=raw['messages'][t['sourceMessageIndex']]
 if m.get('object')=='response':return any(x.get('type')!='function_call' for x in m.get('output',[]))
 return bool(m.get('content')) or bool(m.get('reasoning_content')) or ((t['usage'] or {}).get('reasoningOutputTokens') or 0)>0

def analyze(raw,label):
 ts=core.normalize(raw);ps=[];events=[];used=set();diagnostics=collections.Counter()
 for i,t in enumerate(ts[:-1]):
  action=base.singleton(t)
  if not action:continue
  p=plan(action['command'],action['results'][0])
  if not p:continue
  row={'cohort':label,'instance':raw['instance_id'],'sourceOrdinal':i,'targetOrdinal':i+1,'partition':group(raw['instance_id']),'matched':False};ps.append(row)
  nxt=base.singleton(ts[i+1])
  if not nxt:diagnostics['nextNotSingletonOrMissingResult']+=1;continue
  if parse_diff(nxt['command'])!={k:p[k] for k in ['cwd','argv']}:diagnostics['nextCommandDiffers']+=1;continue
  result=nxt['results'][0]
  if not base.success(result) or len(result.encode())>POLICY['maxOutputBytes'] or 'truncated' in result.lower():diagnostics['nextOutputFailedTruncatedOrOversize']+=1;continue
  if i in used or i+1 in used:diagnostics['overlapExcluded']+=1;continue
  row['matched']=True;used.add(i+1)
  events.append({**row,'matchType':'exact','usage':ts[i+1]['usage'],'reportedCost':ts[i+1]['reportedCost'],'reasoningOrProse':reasoning(raw,ts[i+1]),'requiresRuntimeStateChecks':True})
 return ts,ps,events,dict(diagnostics)

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest',required=True,type=pathlib.Path);p.add_argument('--public',required=True,type=pathlib.Path);p.add_argument('--private',required=True,type=pathlib.Path);a=p.parse_args();manifest=json.loads(a.manifest.read_text());rows=[];events=[]
 for f in manifest['files']:
  data=pathlib.Path(f['local']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Source checksum mismatch')
  raw=json.loads(data);ts,ps,es,ds=analyze(raw,f['label']);rows.append({'cohort':f['label'],'instance':raw['instance_id'],'partition':group(raw['instance_id']),'turns':ts,'proposals':ps,'events':es,'diagnostics':ds});events.extend(es)
 def summary(rs):
  ts=[t for r in rs for t in r['turns']];ps=[p for r in rs for p in r['proposals']];es=[e for r in rs for e in r['events']];den=u.sums(ts);gain=u.sums(es)
  return {'trajectories':len(rs),'issues':len({r['instance'] for r in rs}),'denominator':den,'proposals':len(ps),'matchedCalls':len(es),'unmatchedProposals':len(ps)-len(es),'proposalMatchPercent':100*len(es)/len(ps) if ps else 0,'matchedIssues':len({e['instance'] for e in es}),'matchedUsage':gain,'callPercent':100*len(es)/den['calls'] if den['calls'] else 0,'tokenPercent':100*gain['totalTokens']/den['totalTokens'] if den['totalTokens'] else 0,'matchesWithReasoningOrProse':sum(e['reasoningOrProse'] for e in es),'diagnostics':dict(sum((collections.Counter(r['diagnostics']) for r in rs),collections.Counter()))}
 report={'version':4,'program':PROGRAM,'title':TITLE,'kind':'conditional-gross-recorded-usage-replay-estimate','policy':POLICY,**summary(rows),'cohorts':{c:summary([r for r in rows if r['cohort']==c]) for c in sorted({r['cohort'] for r in rows})},'byPartition':{g:summary([r for r in rows if r['partition']==g]) for g in ['discovery','validation']},'split':'SHA256(autotoken-v4:instance_id)%5==0 discovery, grouped across models. Only discovery inspected before freezing exact edited-file diff rule; this corpus was previously studied, not untouched external validation.','sourceManifestSha256':hashlib.sha256(a.manifest.read_bytes()).hexdigest(),'plannerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'editDetectorSha256':hashlib.sha256(pathlib.Path(base.__file__).read_bytes()).hexdigest(),'limitations':['The edited filename and cwd come from the prior successful source command, never the future label.','Exact means same normalized git diff argv/file/cwd; optional pathspec separator, quote spelling and trailing whitespace are canonicalized.','Whole-repository diffs, pipelines, redirects, alternate flags and bundled commands receive no exact credit.','Source mutation and historical repository/filesystem state are not reconstructed. Future execution requires explicit patch-review policy, registered repository, unchanged regular file and disabled external diff/textconv configuration.','A successful bounded observed diff does not establish patch correctness; removing model reasoning may change task quality.','Usage belongs to original model calls; avoided calls/tokens are conditional gross estimates before routing/execution/fallback costs and future context/cache effects.','Cache and reasoning details are subsets of input/output totals, never added again.','Discovery and validation partition this already-used corpus; no untouched external validation claim.','No recorded command is executed and no paid inference occurs.']}
 a.public.write_text(json.dumps(report,indent=2)+'\n');a.private.parent.mkdir(parents=True,exist_ok=True);a.private.write_text(json.dumps(events,indent=2)+'\n');a.private.chmod(0o600)
 print(json.dumps({k:report[k] for k in ['proposals','matchedCalls','matchedIssues','matchedUsage','callPercent','tokenPercent','proposalMatchPercent']},indent=2))
if __name__=='__main__':main()
