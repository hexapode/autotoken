"""Inert registered-test rerun planner; never executes recorded commands."""
import argparse,ast,collections,hashlib,importlib.util,json,pathlib,re,shlex
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('usage',ROOT/'scripts/estimate-recorded-usage.py');usage=importlib.util.module_from_spec(spec);spec.loader.exec_module(usage)

def success(text):return text.startswith('<returncode>0</returncode>\n<output>') and text.count('<returncode>')==1

def strip_cd(command):
 m=re.match(r'\Acd (/testbed(?:/[A-Za-z0-9_.-]+)*) && ',command)
 return (m[1],command[m.end():]) if m else ('/testbed',command)

def path_at(p,cwd):
 if not isinstance(p,str) or not re.fullmatch(r'[A-Za-z0-9_./-]{1,240}',p) or '..' in p.split('/'):return None
 p=str(pathlib.PurePosixPath(cwd)/p) if not p.startswith('/') else p
 return p if p.startswith('/testbed/') and not any(x.startswith('.') for x in p.split('/') if x) else None

def source_path(p,cwd):
 p=path_at(p,cwd)
 return p if p and p.endswith('.py') and not any(x in ['test','tests','testing'] or x.startswith(('test_','repro','fix_')) or x.endswith('_test.py') for x in p.split('/')) else None

def test_command(command):
 if not isinstance(command,str) or len(command)>16384:return None
 cwd,body=strip_cd(command)
 inline=re.fullmatch(r"(python3?) - <<'([A-Z][A-Z0-9_]*)'\n(.*)\n\2\n?",body,re.S)
 if inline:
  if inline[2] in inline[3].splitlines():return None
  try:tree=ast.parse(inline[3])
  except SyntaxError:return None
  if not any(isinstance(n,ast.Assert) for n in ast.walk(tree)):return None
  # A registered regression script, never executed by this planner. Matching is
  # exact body hash; assertions identify test intent, not execution safety.
  return {'cwd':cwd,'argv':[inline[1],'-',hashlib.sha256(inline[3].encode()).hexdigest()],'command':command,'requiresScriptHashRegistration':True}
 if len(command)>2048 or any(x in command for x in ['\n',';','|','>','<','`','$','\\']):return None
 if '&&' in body or '&' in body:return None
 try:a=shlex.split(body)
 except ValueError:return None
 if not a:return None
 if a[0] in ['python','python3'] and len(a)==2:
  p=path_at(a[1],cwd)
  if not p and re.fullmatch(r'/tmp/(?:test|repro)[A-Za-z0-9_.-]*\.py',a[1]):p=a[1]
  if p and p.endswith('.py') and re.match(r'(?:test|repro)',pathlib.PurePosixPath(p).name):return {'cwd':cwd,'argv':a,'command':command}
 if a[0]=='pytest':args=a[1:]
 elif a[:3] in [['python','-m','pytest'],['python3','-m','pytest']]:args=a[3:]
 else:return None
 if not args or not any(not x.startswith('-') for x in args):return None
 for x in args:
  if x.startswith('-'):
   if x not in ['-q','-v','-vv','-x','--disable-warnings','--tb=short']:return None
  elif not path_at(x.split('::')[0],cwd) or not re.fullmatch(r'[A-Za-z0-9_./:-]+',x):return None
 return {'cwd':cwd,'argv':a,'command':command}

def edited_source(command):
 if not isinstance(command,str) or len(command)>65536:return None
 cwd,body=strip_cd(command)
 # Limited sed substitution, no expression execution or auxiliary writes.
 try:a=shlex.split(body)
 except ValueError:a=[]
 if len(a)==4 and a[:2]==['sed','-i'] and re.fullmatch(r'(?:\d+)?s/[^/\n]*/[^/\n]*/g?',a[2]):return source_path(a[3],cwd)
 m=re.fullmatch(r"python3? - <<'([A-Z][A-Z0-9_]*)'\n(.*)\n\1\n?",body,re.S)
 if not m or m[1] in m[2].splitlines():return None
 try:tree=ast.parse(m[2])
 except SyntaxError:return None
 bindings={};handles={};writes=[]
 # Only statically recognized pathlib/text replacement scripts. This is a
 # detector, not proof of actual mutation; successful process exit is required.
 for n in ast.walk(tree):
  if isinstance(n,(ast.For,ast.While,ast.FunctionDef,ast.ClassDef,ast.Try,ast.Lambda,ast.Delete,ast.AugAssign)):return None
  if isinstance(n,ast.Import):return None
  if isinstance(n,ast.ImportFrom) and (n.module!='pathlib' or any(x.name!='Path' or x.asname for x in n.names)):return None
  if isinstance(n,ast.Call):
   if isinstance(n.func,ast.Name) and n.func.id not in ['Path','print','SystemExit']:return None
   if isinstance(n.func,ast.Attribute) and n.func.attr not in ['read_text','write_text','replace','count']:return None
 for n in tree.body:
  if isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name):
   v=n.value
   if isinstance(v,ast.Call) and isinstance(v.func,ast.Name) and v.func.id=='Path' and len(v.args)==1 and isinstance(v.args[0],ast.Constant):bindings[n.targets[0].id]=source_path(v.args[0].value,cwd)
 for n in ast.walk(tree):
  if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='write_text':
   target=n.func.value
   p=bindings.get(target.id) if isinstance(target,ast.Name) else None
   if not p:return None
   writes.append(p)
 return writes[0] if len(writes)==1 else None

def singleton(t):
 if len(t['actions'])!=1:return None
 a=t['actions'][0]
 return a if a['name']=='bash' and isinstance(a['command'],str) and len(a['results'])==1 else None

def plan(history,current):
 a=singleton(current)
 if not a or not success(a['results'][0]):return None
 path=edited_source(a['command'])
 if not path:return None
 # Most recent recognized test must have succeeded; a failed newer test clears
 # old evidence. Horizon is bounded, and test-file edits are never triggers.
 for old in reversed(history[-12:]):
  oa=singleton(old)
  if not oa:continue
  prior=test_command(oa['command'])
  if prior:
   if not success(oa['results'][0]):return None
   return {**prior,'editedPath':path,'testSourceOrdinal':old['ordinal'],'requiresRegisteredTestAndEnvironment':True,'requiresExplicitRerunAfterEditPolicy':True,'maxRuntimeSeconds':120,'maxOutputBytes':32000}
 return None

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest',type=pathlib.Path,required=True);p.add_argument('--public',type=pathlib.Path,required=True);p.add_argument('--private',type=pathlib.Path,required=True);a=p.parse_args()
 manifest=json.loads(a.manifest.read_text());cohorts=collections.defaultdict(list);events=[];allturns=[];proposals=[];diagnostics=collections.Counter()
 for f in manifest['files']:
  data=pathlib.Path(f['local']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Checksum mismatch')
  r=json.loads(data);ts=usage.normalize(r);allturns+=ts;es=[];ps=[];used=set()
  for i,t in enumerate(ts[:-1]):
   action=singleton(t)
   if action and test_command(action['command']):
    diagnostics['recognizedTestCommands']+=1;diagnostics['successfulTestCommands']+=success(action['results'][0])
   if action and edited_source(action['command']):
    diagnostics['recognizedSourceEdits']+=1
    for old in reversed(ts[max(0,i-12):i]):
     previous=singleton(old)
     if previous and test_command(previous['command']):
      diagnostics['latestTestSuccessful' if success(previous['results'][0]) else 'latestTestFailed']+=1;break
    else:diagnostics['noRecognizedTestWithinHorizon']+=1
   proposal=plan(ts[:i],t)
   if not proposal:continue
   nexta=singleton(ts[i+1]);match=bool(nexta and test_command(nexta['command']) and test_command(nexta['command'])['cwd']==proposal['cwd'] and test_command(nexta['command'])['argv']==proposal['argv'])
   row={'cohort':f['label'],'instance':r['instance_id'],'sourceOrdinal':i,'targetOrdinal':i+1,'matched':match,'proposal':proposal}
   if match and i not in used and i+1 not in used:
    e={**row,'usage':ts[i+1]['usage'],'reportedCost':ts[i+1]['reportedCost'],'requiresExplicitRegisteredTestPolicy':True};es.append(e);used.add(i+1)
   ps.append(row)
  events+=es;proposals+=ps;cohorts[f['label']].append({'instance':r['instance_id'],'turns':ts,'proposals':ps,'events':es})
 summaries={}
 for label,rs in cohorts.items():
  es=[e for r in rs for e in r['events']];ps=[p for r in rs for p in r['proposals']]
  summaries[label]={'trajectories':len(rs),'proposals':len(ps),'matchedCalls':len(es),'unmatchedProposals':sum(not p['matched'] for p in ps),'matchPrecision':len(es)/len(ps) if ps else None,'matchedIssues':len({e['instance'] for e in es}),'matchedUsage':usage.sums(es),'corpusUsage':usage.sums([t for r in rs for t in r['turns']])}
 report={'version':2,'program':'registered_test_rerun_v2','title':'Rerun a registered test after a source edit','kind':'conditional-gross-recorded-usage-estimate','proposals':len(proposals),'matchedCalls':len(events),'unmatchedProposals':sum(not p['matched'] for p in proposals),'matchPrecision':len(events)/len(proposals) if proposals else None,'matchedIssues':len({e['instance'] for e in events}),'matchedUsage':usage.sums(events),'corpusUsage':usage.sums(allturns),'cohorts':summaries,'diagnostics':dict(diagnostics),'fixtureChecks':8,'policy':'Successful bounded sed substitution or static pathlib write to one source file; rerun most recent successful pure Python reproduction, hash-bound inline Python assertion script, or explicit pytest target within 12 prior responses. A newer failed test invalidates old success. Exact cwd/argv match only.','limitations':['Discovery policy on this sample, not held-out or measured saved calls.','Every candidate requires an explicit registered test/environment and rerun policy not observed in historical traces; deployment credit is zero.','Successful prior test exit does not establish a useful regression or assertion coverage.','Removing a model response may discard necessary reasoning; all token estimates are conditional.','Only whole singleton responses with aligned observed tool results are credited; multi-tool responses excluded.','Recorded input includes cached input; cache and reasoning details are subsets, not added again.','Gross usage of matched calls excludes router/fallback/discovery costs and downstream context changes.','Unmatched proposals may change behavior; match precision is descriptive, not safety or task-quality validation.','No recorded commands executed; source edits are detected statically, actual filesystem change not reconstructed.'],'sourceRevision':manifest['sources'][0]['githubRevision'],'plannerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}
 a.public.write_text(json.dumps(report,indent=2)+'\n');a.private.parent.mkdir(parents=True,exist_ok=True);a.private.write_text(json.dumps(events,indent=2)+'\n');a.private.chmod(0o600);a.private.with_name(a.private.name.replace('-events.json','-proposals.json')).write_text(json.dumps(proposals,indent=2)+'\n');a.private.with_name(a.private.name.replace('-events.json','-proposals.json')).chmod(0o600);print(json.dumps({k:report[k] for k in ['proposals','matchedCalls','unmatchedProposals','matchedIssues','matchedUsage']},indent=2))
if __name__=='__main__':main()
