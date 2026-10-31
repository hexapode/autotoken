"""Inert syntax-verification -> repository-status workflow, with usage replay."""
import argparse,collections,hashlib,importlib.util,json,pathlib,re,shlex
ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
core=load('status_core','trace_batch_core.py');u=load('status_usage','estimate-recorded-usage.py')
PROGRAM='syntax_check_status_v3';TITLE='Inspect repository status after a syntax check'
POLICY={'root':'/testbed','trigger':'Successful standalone python -m py_compile or python -m compileall -q on explicit .py files','nextArgv':['git','status','--porcelain'],'maxOutputBytes':32768,'timeoutSeconds':10,'requiresRegisteredRepository':True}

def common_group(issue):return 'discovery' if int(hashlib.sha256(('autotoken-v3:'+issue).encode()).hexdigest(),16)%5==0 else 'validation'
def group(issue):
 initial=int(hashlib.sha256(('diff-check-v3:'+issue).encode()).hexdigest(),16)%5==0
 return 'discovery' if initial or common_group(issue)=='discovery' else 'validation'
def command_words(command):
 if not isinstance(command,str) or len(command)>4096 or '\n' in command:return None
 try:words=shlex.split(command)
 except ValueError:return None
 if words[:3]==['cd','/testbed','&&']:words=words[3:]
 if not words or any(any(ch in x for ch in [';','|','&','>','<','`','$','\\']) for x in words):return None
 return words

def source_path(path):
 if path.startswith('/') and not path.startswith('/testbed/'):return False
 if not re.fullmatch(r'(?:/testbed/)?[A-Za-z0-9_./-]+\.py',path) or len(path)>240:return False
 return not path.startswith('-') and not any(x in ['..',''] or x.startswith('.') for x in path.lstrip('/').split('/'))
def syntax_check(command):
 words=command_words(command)
 if not words or words[0] not in ['python','python3'] or len(words)<4 or words[1]!='-m':return None
 if words[2]=='py_compile':paths=words[3:]
 elif words[2]=='compileall' and words[3]=='-q':paths=words[4:]
 else:return None
 if not paths or len(paths)>16 or not all(source_path(p) for p in paths):return None
 return {'cwd':'/testbed','files':paths,'module':words[2]}
def success(result):return isinstance(result,str) and result.startswith('<returncode>0</returncode>\n<output>') and result.count('<returncode>')==1

def plan(command,result):
 check=syntax_check(command)
 if not check or not success(result):return None
 return {'cwd':'/testbed','argv':['git','status','--porcelain'],'maxOutputBytes':32768,'timeoutSeconds':10,'requiresRegisteredRepository':True,'triggerFiles':check['files']}
def status_command(command):
 words=command_words(command)
 if words and words[:3]==['git','-C','/testbed']:words=['git']+words[3:]
 return words==['git','status','--porcelain']
def singleton(turn):
 if len(turn['actions'])!=1:return None
 a=turn['actions'][0]
 return a if a['name']=='bash' and len(a['results'])==1 and isinstance(a['command'],str) else None

def reasoning(raw,turn):
 m=raw['messages'][turn['sourceMessageIndex']]
 if m.get('object')=='response':return any(x.get('type')!='function_call' for x in m.get('output',[]))
 return bool(m.get('content')) or bool(m.get('reasoning_content')) or ((turn['usage'] or {}).get('reasoningOutputTokens') or 0)>0

def analyze(raw,label):
 turns=core.normalize(raw);proposals=[];events=[];diagnostics=collections.Counter();used=set()
 for i,t in enumerate(turns[:-1]):
  a=singleton(t)
  if not a:continue
  if syntax_check(a['command']):diagnostics['recognizedSyntaxChecks']+=1
  p=plan(a['command'],a['results'][0])
  if not p:continue
  row={'cohort':label,'instance':raw['instance_id'],'sourceOrdinal':i,'targetOrdinal':i+1,'partition':group(raw['instance_id']),'matched':False};proposals.append(row)
  n=turns[i+1];na=singleton(n)
  if not na:diagnostics['nextNotSingletonBashWithResult']+=1;continue
  if not status_command(na['command']):diagnostics['nextCommandDiffers']+=1;continue
  if not success(na['results'][0]) or len(na['results'][0].encode())>p['maxOutputBytes'] or 'output truncated' in na['results'][0].lower():diagnostics['nextResultFailedOrExceedsBound']+=1;continue
  if i in used or i+1 in used:diagnostics['overlapExcluded']+=1;continue
  row['matched']=True;used.add(i+1)
  events.append({**row,'matchType':'exact','usage':n['usage'],'reportedCost':n['reportedCost'],'reasoningOrProse':reasoning(raw,n)})
 return turns,proposals,events,dict(diagnostics)

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest',type=pathlib.Path,required=True);p.add_argument('--public',type=pathlib.Path,required=True);p.add_argument('--private',type=pathlib.Path,required=True);args=p.parse_args()
 manifest=json.loads(args.manifest.read_text());rows=[];events=[]
 for f in manifest['files']:
  data=pathlib.Path(f['local']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Source checksum mismatch')
  raw=json.loads(data);turns,ps,es,ds=analyze(raw,f['label']);events.extend(es);rows.append({'instance':raw['instance_id'],'cohort':f['label'],'partition':group(raw['instance_id']),'turns':turns,'proposals':ps,'events':es,'diagnostics':ds})
 def summary(selected):
  turns=[t for r in selected for t in r['turns']];es=[e for r in selected for e in r['events']];ps=[p for r in selected for p in r['proposals']];den=u.sums(turns);gain=u.sums(es)
  return {'trajectories':len(selected),'issues':len({r['instance'] for r in selected}),'proposals':len(ps),'matchedCalls':len(es),'unmatchedProposals':len(ps)-len(es),'matchedIssues':len({e['instance'] for e in es}),'matchPercent':100*len(es)/len(ps) if ps else 0,'matchedUsage':gain,'denominator':den,'callPercent':100*len(es)/den['calls'] if den['calls'] else 0,'tokenPercent':100*gain['totalTokens']/den['totalTokens'] if den['totalTokens'] else 0,'matchesWithReasoningOrProse':sum(e['reasoningOrProse'] for e in es),'diagnostics':dict(sum((collections.Counter(r['diagnostics']) for r in selected),collections.Counter()))}
 report={'version':3,'program':PROGRAM,'title':TITLE,'kind':'conditional-gross-replay-estimate-not-measured-savings','policy':POLICY,**summary(rows),'cohorts':{c:summary([r for r in rows if r['cohort']==c]) for c in sorted({r['cohort'] for r in rows})},'byPartition':{g:summary([r for r in rows if r['partition']==g]) for g in ['discovery','validation']},'partitionMethod':'Discovery is union of SHA256(autotoken-v3:instance_id)%5==0 and initially inspected SHA256(diff-check-v3:instance_id)%5==0; validation excludes both. Same issue grouped across models.','selectionNote':'Only discovery next actions were inspected to choose syntax-check -> fixed porcelain status. Policy frozen before replaying validation. Discovery prefix changed during coordination; union prevents inspected issues being relabeled validation. Corpus was previously used in project research, so not untouched external validation.','limitations':['Only whole singleton next responses with observed successful bounded output count. No partial shell commands or redirected/bundled status calls credited.','Root repository must be registered and still present; replay does not reconstruct historical filesystem state.','Git status arguments/cwd match, not a reconstructed execution/output equivalence proof.','All potential saved calls may contain useful reasoning; task quality remains untested.','Successful compilation is syntax verification, not proof the bug is fixed or tests pass.','Proposal precision is descriptive; unmatched proposals show that automatic routing is not justified universally.','Recorded input/output/cache usage belongs to original calls. Savings are conditional gross estimates before router/program/fallback costs and future cache effects.','Cached input and reasoning output are subsets, never added again.','No recorded command was executed and no paid inference was used.'],'sourceManifestSha256':hashlib.sha256(args.manifest.read_bytes()).hexdigest(),'plannerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}
 args.public.write_text(json.dumps(report,indent=2)+'\n');args.private.parent.mkdir(parents=True,exist_ok=True);args.private.write_text(json.dumps(events,indent=2)+'\n');args.private.chmod(0o600)
 print(json.dumps({k:report[k] for k in ['proposals','matchedCalls','matchedIssues','matchPercent','callPercent','tokenPercent','matchedUsage','byPartition']},indent=2))
if __name__=='__main__':main()
