"""Inert write/run v2 planner and recorded-usage replay; never executes commands."""
import argparse,collections,hashlib,importlib.util,json,pathlib,re,posixpath
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('usage',ROOT/'scripts/estimate-recorded-usage.py');usage=importlib.util.module_from_spec(spec);spec.loader.exec_module(usage)
TOKEN=r'[A-Za-z0-9_./-]+'
PREFIX=re.compile(r'\A\s*cd ('+TOKEN+r')\s*&&\s*')
HEADER=re.compile(r"\Acat\s+(?:>\s*(?P<p1>"+TOKEN+r")\s*<<\s*'(?P<d1>[A-Za-z_][A-Za-z0-9_]{0,31})'|<<\s*'(?P<d2>[A-Za-z_][A-Za-z0-9_]{0,31})'\s*>\s*(?P<p2>"+TOKEN+r"))\s*\Z")

def group(issue):return 'validation' if int(hashlib.sha256(('write-run-v2:'+issue).encode()).hexdigest(),16)%2 else 'discovery'
def safe_absolute(p,cwd='/testbed'):
 if not re.fullmatch(TOKEN,p) or len(p)>240 or '..' in p.split('/') or any(x.startswith('.') and x!='.' for x in p.split('/')):return None
 p=posixpath.normpath(posixpath.join(cwd,p))
 return p if p.startswith(('/testbed/','/tmp/')) else None

def take_prefix(command,initial_cwd='/testbed'):
 m=PREFIX.match(command);cwd=initial_cwd
 if m:
  cwd=safe_absolute(m[1],initial_cwd) if m[1] not in ['/testbed','/tmp'] else m[1]
  if cwd is None:return None,None
  command=command[m.end():]
 return command,cwd

def parse_write(command,initial_cwd='/testbed'):
 if not isinstance(command,str) or len(command.encode())>65536:return None
 command,cwd=take_prefix(command,initial_cwd)
 if command is None or '\n' not in command:return None
 header,body=command.split('\n',1);m=HEADER.fullmatch(header)
 if not m:return None
 delimiter=m['d1'] or m['d2'];path=safe_absolute(m['p1'] or m['p2'],cwd)
 if path is None or not path.endswith('.py'):return None
 lines=body.splitlines(keepends=True)
 ends=[i for i,l in enumerate(lines) if l.rstrip('\r\n')==delimiter]
 if len(ends)!=1 or ends[0]!=len(lines)-1:return None
 content=''.join(lines[:-1])
 if not content:return None
 return {'path':path,'cwd':cwd,'body':content,'sha256':hashlib.sha256(content.encode()).hexdigest()}

def plan(command,result,registered_interpreter='python',initial_cwd='/testbed'):
 write=parse_write(command,initial_cwd)
 if write is None or registered_interpreter!='python' or not usage.mini.success(result):return None
 return {'argv':['python',write['path']],'cwd':write['cwd'],'sha256':write['sha256'],'requiresExplicitRunAfterWritePolicy':True,'requiresCurrentFileHashCheck':True,'requiresRegisteredInterpreter':True,'maxOutputBytes':16000,'timeoutSeconds':10}

def parse_run(command,initial_cwd='/testbed'):
 command,cwd=take_prefix(command,initial_cwd)
 if command is None:return None
 m=re.fullmatch(r'\s*python\s+('+TOKEN+r')\s*',command)
 if not m:return None
 path=safe_absolute(m[1],cwd)
 return {'argv':['python',path],'cwd':cwd} if path and path.endswith('.py') else None

def has_reasoning(raw,turn):
 m=raw['messages'][turn['sourceMessageIndex']]
 if m.get('object')=='response':return any(x.get('type')!='function_call' for x in m.get('output',[]))
 return bool(m.get('content')) or bool(m.get('reasoning_content')) or ((turn['usage'] or {}).get('reasoningOutputTokens') or 0)>0

def analyze(raw,label):
 turns=usage.normalize(raw);events=[];proposals=[];diagnostics=collections.Counter();targets=set()
 for i,t in enumerate(turns):
  if len(t['actions'])!=1:continue
  a=t['actions'][0]
  if a['name']!='bash' or not isinstance(a['command'],str) or len(a['results'])!=1:continue
  if 'cat ' in a['command'] and '<<' in a['command']:diagnostics['heredocLikeSources']+=1
  proposal=plan(a['command'],a['results'][0])
  if not proposal:continue
  row={'cohort':label,'instance':raw['instance_id'],'partition':group(raw['instance_id']),'sourceOrdinal':i,'targetOrdinal':i+1,'matched':False}
  proposals.append(row)
  if i+1>=len(turns):diagnostics['noNextCall']+=1;continue
  nxt=turns[i+1]
  if len(nxt['actions'])!=1:diagnostics['nextNotSingleton']+=1;continue
  n=nxt['actions'][0]
  if n['name']!='bash' or len(n['results'])!=1 or not isinstance(n['command'],str):diagnostics['nextMissingBashResult']+=1;continue
  predicted={k:proposal[k] for k in ['argv','cwd']}
  if parse_run(n['command'])!=predicted:diagnostics['nextActionDiffers']+=1;continue
  if i in targets or i+1 in targets:diagnostics['overlapExcluded']+=1;continue
  targets.add(i+1);row['matched']=True
  events.append({**row,'usage':nxt['usage'],'reportedCost':nxt['reportedCost'],'reasoningOrProse':has_reasoning(raw,nxt),'sourceMessageIndex':t['sourceMessageIndex'],'targetMessageIndex':nxt['sourceMessageIndex'],'scriptSha256':proposal['sha256'],'targetExitCode':int(re.match(r'<returncode>(-?\d+)</returncode>',n['results'][0])[1]) if re.match(r'<returncode>(-?\d+)</returncode>',n['results'][0]) else None})
 return turns,proposals,events,dict(diagnostics)

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest',type=pathlib.Path,required=True);p.add_argument('--public',type=pathlib.Path,required=True);p.add_argument('--private',type=pathlib.Path,required=True);args=p.parse_args();manifest=json.loads(args.manifest.read_text());rows=[];all_events=[]
 for f in manifest['files']:
  path=pathlib.Path(f['local'])
  if not str(path).endswith('.traj.json'):continue
  data=path.read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Source checksum mismatch')
  raw=json.loads(data);turns,proposals,events,diagnostics=analyze(raw,f['label']);rows.append({'cohort':f['label'],'partition':group(raw['instance_id']),'instance':raw['instance_id'],'turns':turns,'proposals':proposals,'events':events,'diagnostics':diagnostics});all_events.extend(events)
 def summarize(selected):
  turns=[t for r in selected for t in r['turns']];proposals=[p for r in selected for p in r['proposals']];events=[e for r in selected for e in r['events']]
  return {'trajectories':len(selected),'issues':len({r['instance'] for r in selected}),'denominator':usage.sums(turns),'proposals':len(proposals),'matchedWholeCalls':len(events),'unmatchedProposals':len(proposals)-len(events),'matchedIssues':len({e['instance'] for e in events}),'grossMatchedUsage':usage.sums(events),'matchesWithReasoningOrProse':sum(e['reasoningOrProse'] for e in events),'matchedTargetExitCodes':dict(collections.Counter(str(e['targetExitCode']) for e in events)),'diagnostics':dict(sum((collections.Counter(r['diagnostics']) for r in selected),collections.Counter()))}
 report={'version':2,'candidate':'write_then_run_v2','kind':'conditional-recorded-usage-replay-estimate-not-measured-savings','sources':manifest['sources'],'policy':{'initialCwd':'/testbed','registeredInterpreter':'python','roots':['/testbed','/tmp'],'maxWriteBytes':65536,'quotedHeredocOnly':True,'singleStandaloneWrite':True,'singleRunWithoutArguments':True,'exactCwdAndPathRequired':True,'runtimeRequires':['explicit run-after-write opt-in','current file hash matches','registered interpreter','resolve path inside allowlisted roots without symlinks','bounded subprocess']},'split':{'method':'SHA256(write-run-v2:instance_id) parity; issue stays grouped across models','discoveryUsedForDevelopment':True,'validationMeans':'Issue-disjoint within this round; corpus previously inspected, not untouched external validation'},'summary':summarize(rows),'byModel':{label:summarize([r for r in rows if r['cohort']==label]) for label in sorted({r['cohort'] for r in rows})},'byPartition':{g:summarize([r for r in rows if r['partition']==g]) for g in ['discovery','validation']},'conservativeDeploymentCredit':{'calls':0,'tokens':0,'reason':'Required execution opt-in and live unchanged-file check are not observed in historical traces.'},'limitations':['New policy version; not a retrospective update to the original frozen policy.','Plans use current commands and successful observations only; next actions are replay labels.','A complete next model response must contain exactly one matching bash action and one aligned result.','Matching may remove useful reasoning; task success has not been tested.','Reported input/output/cache counts belong to original calls; savings are conditional counterfactual estimates.','Cached input and reasoning output are subsets, never added again.','Gross estimates exclude router/discovery/fallback overhead and downstream history/cache changes.','Shell body is inert data; no recorded commands executed and no paid inference.','Existing bundled write-and-run commands are excluded because no additional call is avoided.','A successful write does not establish intent to execute it; unmatched proposals show the risk of broad automatic routing.'],'plannerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}
 report.update(program='write_then_run_v2',title='Write a script and run it',proposals=report['summary']['proposals'],matchedCalls=report['summary']['matchedWholeCalls'],matchedIssues=report['summary']['matchedIssues'],matchedUsage=report['summary']['grossMatchedUsage'],cohorts=report['byModel'])
 args.public.write_text(json.dumps(report,indent=2)+'\n');args.private.parent.mkdir(parents=True,exist_ok=True);args.private.write_text(json.dumps(all_events,indent=2));args.private.chmod(0o600);print(json.dumps(report['summary'],indent=2))
if __name__=='__main__':main()
