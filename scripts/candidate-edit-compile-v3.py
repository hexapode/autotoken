"""Inert bounded source edit -> fixed Python syntax-check program and replay."""
import argparse,collections,hashlib,importlib.util,json,pathlib,re,shlex
ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
base=load('compile_base','candidate-rerun-v2.py');core=load('compile_core','trace_batch_core.py');u=load('compile_usage','estimate-recorded-usage.py')
PROGRAM='edit_compile_v3';TITLE='Check syntax after editing a Python source file'
POLICY={'root':'/testbed','interpreter':'python','module':'py_compile','maxOutputBytes':16384,'timeoutSeconds':10,'sourceEditGrammar':'Unchanged bounded sed substitution or single literal pathlib write from rerun-v2','requiresRegisteredInterpreterAndEnvironment':True,'requiresRegularFileNoSymlinkAndUnchangedState':True,'writesBytecodeCache':True}
def group(issue):return 'discovery' if int(hashlib.sha256(('autotoken-v3:'+issue).encode()).hexdigest(),16)%5==0 else 'validation'
def plan(command,result):
 if not base.success(result):return None
 path=base.edited_source(command)
 if not path:return None
 cwd,_=base.strip_cd(command)
 return {'cwd':cwd,'argv':['python','-m','py_compile',path],'requiresExplicitCheckAfterEditPolicy':True,**POLICY}
def parse_check(command):
 if not isinstance(command,str) or len(command)>2048 or any(x in command for x in ['\n',';','|','>','<','`','$','\\']):return None
 cwd,body=base.strip_cd(command)
 if '&' in body:return None
 try:words=shlex.split(body)
 except ValueError:return None
 if len(words)!=4 or words[:3]!=['python','-m','py_compile']:return None
 path=base.source_path(words[3],cwd)
 return {'cwd':cwd,'argv':words[:3]+[path]} if path else None

def reasoning(raw,turn):
 m=raw['messages'][turn['sourceMessageIndex']]
 if m.get('object')=='response':return any(x.get('type')!='function_call' for x in m.get('output',[]))
 return bool(m.get('content')) or bool(m.get('reasoning_content')) or ((turn['usage'] or {}).get('reasoningOutputTokens') or 0)>0

def analyze(raw,label):
 ts=core.normalize(raw);proposals=[];events=[];used=set();diagnostics=collections.Counter()
 for i,t in enumerate(ts[:-1]):
  action=base.singleton(t)
  if not action:continue
  proposal=plan(action['command'],action['results'][0])
  if not proposal:continue
  row={'cohort':label,'instance':raw['instance_id'],'sourceOrdinal':i,'targetOrdinal':i+1,'matched':False}
  proposals.append(row);nextaction=base.singleton(ts[i+1])
  if not nextaction:diagnostics['nextNotSingletonOrMissingResult']+=1;continue
  parsed=parse_check(nextaction['command'])
  if parsed!={k:proposal[k] for k in ['cwd','argv']}:diagnostics['nextCommandDiffers']+=1;continue
  if i in used or i+1 in used:diagnostics['overlapExcluded']+=1;continue
  row['matched']=True;used.add(i+1)
  events.append({**row,'matchType':'exact','usage':ts[i+1]['usage'],'reportedCost':ts[i+1]['reportedCost'],'partition':group(raw['instance_id']),'reasoningOrProse':reasoning(raw,ts[i+1])})
 return ts,proposals,events,dict(diagnostics)

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest',type=pathlib.Path,required=True);p.add_argument('--public',type=pathlib.Path,required=True);p.add_argument('--private',type=pathlib.Path,required=True);a=p.parse_args();manifest=json.loads(a.manifest.read_text());rows=[];events=[]
 for f in manifest['files']:
  data=pathlib.Path(f['local']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Source checksum mismatch')
  raw=json.loads(data);ts,ps,es,ds=analyze(raw,f['label']);rows.append({'instance':raw['instance_id'],'cohort':f['label'],'partition':group(raw['instance_id']),'turns':ts,'proposals':ps,'events':es,'diagnostics':ds});events.extend(es)
 def summary(rs):
  ts=[t for r in rs for t in r['turns']];ps=[x for r in rs for x in r['proposals']];es=[e for r in rs for e in r['events']];denom=u.sums(ts);gain=u.sums(es)
  return {'trajectories':len(rs),'issues':len({r['instance'] for r in rs}),'proposals':len(ps),'matchedCalls':len(es),'unmatchedProposals':len(ps)-len(es),'proposalMatchPercent':100*len(es)/len(ps) if ps else 0,'matchedIssues':len({e['instance'] for e in es}),'matchedUsage':gain,'denominator':denom,'callPercent':100*len(es)/denom['calls'] if denom['calls'] else 0,'tokenPercent':100*gain['totalTokens']/denom['totalTokens'] if denom['totalTokens'] else 0,'matchesWithReasoningOrProse':sum(e['reasoningOrProse'] for e in es),'diagnostics':dict(sum((collections.Counter(r['diagnostics']) for r in rs),collections.Counter()))}
 report={'version':3,'program':PROGRAM,'title':TITLE,'kind':'conditional-gross-recorded-usage-replay-estimate','policy':POLICY,**summary(rows),'cohorts':{c:summary([r for r in rows if r['cohort']==c]) for c in sorted({r['cohort'] for r in rows})},'byPartition':{g:summary([r for r in rows if r['partition']==g]) for g in ['discovery','validation']},'split':'SHA256(autotoken-v3:instance_id)%5==0 discovery; same issue across models stays grouped. Only discovery inspected before fixing python -m py_compile policy; corpus previously studied, not untouched external validation.','limitations':['Program derives the edited file and cwd from the successful source command, never the next response.','Next whole singleton response must match exact fixed interpreter/module/path/cwd; compileall, environment prefixes, redirections and bundled commands excluded.','Source-edit recognition is static and unchanged from rerun-v2; actual mutation and filesystem state are not reconstructed.','A future executor requires explicit syntax-check policy, registered interpreter/environment and regular nonsymlink file with unchanged state. py_compile writes bytecode cache.','Syntax success is not bug-fix success; removed model reasoning/prose may matter.','Recorded usage belongs to original calls; saved usage is conditional, not observed live savings.','Cached input and reasoning output are subsets, never added twice.','Gross estimates exclude routing/program cost, false positives and downstream context/cache effects.','No recorded commands executed and no paid model inference.'],'sourceManifestSha256':hashlib.sha256(a.manifest.read_bytes()).hexdigest(),'plannerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'editDetectorSha256':hashlib.sha256(pathlib.Path(base.__file__).read_bytes()).hexdigest()}
 a.public.write_text(json.dumps(report,indent=2)+'\n');a.private.parent.mkdir(parents=True,exist_ok=True);a.private.write_text(json.dumps(events,indent=2)+'\n');a.private.chmod(0o600)
 print(json.dumps({k:report[k] for k in ['proposals','matchedCalls','matchedIssues','matchedUsage','callPercent','tokenPercent','proposalMatchPercent']},indent=2))
if __name__=='__main__':main()
