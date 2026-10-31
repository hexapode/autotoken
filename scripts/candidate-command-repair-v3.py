"""Inert missing-rg repair: literal, explicit-file search -> bounded grep retry.

Never executes commands. Predicts from the failed request and native error only.
"""
import argparse,collections,hashlib,importlib.util,json,pathlib,posixpath,re,shlex
from trace_batch_core import normalize
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('usage',ROOT/'scripts/estimate-recorded-usage.py');usage=importlib.util.module_from_spec(spec);spec.loader.exec_module(usage)
POLICY={'maxCommandBytes':4096,'maxFiles':4,'maxOutputBytes':16000,'maxFileBytes':1000000,'maxRetries':1,'regexSupport':'ASCII words, digits, underscores and spaces only; no regex translation','requiresRegisteredGrep':True,'requiresRegularRepoFilesNoSymlinks':True,'requiresUnchangedFiles':True,'timeoutSeconds':5}

def partition(issue):return 'discovery' if initial_exploratory_group(issue) or int(hashlib.sha256(('autotoken-v3:'+issue).encode()).hexdigest(),16)%5==0 else 'validation'
def initial_exploratory_group(issue):return int(hashlib.sha256(('repair-v3:'+issue).encode()).hexdigest(),16)%5==0

def parse(command,executable):
 if not isinstance(command,str) or len(command.encode())>POLICY['maxCommandBytes'] or any(x in command for x in ['\n',';','|','`','$','\\','>','<']):return None
 cwd='/testbed';match=re.match(r'\Acd (/testbed(?:/[A-Za-z0-9_.-]+)*) && ',command)
 if match:cwd=match[1];command=command[match.end():]
 if '..' in cwd.split('/') or any(x.startswith('.') for x in cwd.split('/') if x) or '&' in command:return None
 try:args=shlex.split(command)
 except ValueError:return None
 if not args or args[0]!=executable:return None
 numbered=False;positionals=[];terminated=False
 for arg in args[1:]:
  if arg=='--' and not terminated:terminated=True;continue
  if arg=='-n' and not terminated:numbered=True;continue
  if arg.startswith('-') and not terminated:return None
  positionals.append(arg)
 if not 2<=len(positionals)<=1+POLICY['maxFiles']:return None
 pattern=positionals[0]
 if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_ ]{0,199}',pattern):return None
 paths=[]
 for arg in positionals[1:]:
  if not re.fullmatch(r'[A-Za-z0-9_./-]{1,240}',arg) or '..' in arg.split('/') or any(x.startswith('.') for x in arg.split('/') if x and x!='.'):return None
  path=posixpath.normpath(posixpath.join(cwd,arg))
  if not path.startswith('/testbed/') or not re.search(r'\.(?:py|txt|rst|md|ini|cfg|toml|yaml|yml|json|html|css|js)$',path):return None
  paths.append(path)
 if len(paths)!=len(set(paths)):return None
 return {'cwd':cwd,'pattern':pattern,'paths':paths,'numbered':numbered}

def missing_rg(result):
 return isinstance(result,str) and re.fullmatch(r'<returncode>127</returncode>\n<output>\n(?:bash: (?:line \d+: )?rg: command not found|/bin/bash: (?:line \d+: )?rg: command not found)\n</output>',result) is not None

def plan(command,result,retries=0):
 if retries or not missing_rg(result):return None
 spec=parse(command,'rg')
 if not spec:return None
 return {**spec,'argv':['grep']+(['-n'] if spec['numbered'] else [])+['--',spec['pattern']]+spec['paths'],'maxOutputBytes':POLICY['maxOutputBytes'],'timeoutSeconds':POLICY['timeoutSeconds'],'requiresRegisteredGrepAndRegularUnchangedFiles':True}

def singleton(t):
 if len(t['actions'])!=1:return None
 a=t['actions'][0]
 return a if a['name']=='bash' and isinstance(a['command'],str) and len(a['results'])==1 else None

def observed_search(result):
 return isinstance(result,str) and len(result.encode())<=POLICY['maxOutputBytes'] and bool(re.fullmatch(r'<returncode>[01]</returncode>\n<output>.*</output>',result,re.S)) and not re.search(r'(?i)truncated|binary file .*matches',result)

def analyze(raw,label):
 turns=normalize(raw);proposals=[];events=[];diagnostics=collections.Counter();targets=set()
 for i,t in enumerate(turns[:-1]):
  a=singleton(t)
  if not a:continue
  if missing_rg(a['results'][0]):diagnostics['nativeMissingRgErrors']+=1
  p=plan(a['command'],a['results'][0])
  if not p:continue
  row={'cohort':label,'instance':raw['instance_id'],'sourceOrdinal':i,'targetOrdinal':i+1,'partition':partition(raw['instance_id']),'matched':False};proposals.append(row)
  nexta=singleton(turns[i+1])
  if not nexta:diagnostics['nextNotSingletonObservedBash']+=1;continue
  target=parse(nexta['command'],'grep')
  if not target or target!={k:p[k] for k in ['cwd','pattern','paths','numbered']}:diagnostics['nextCommandDiffers']+=1;continue
  if not observed_search(nexta['results'][0]):diagnostics['nextOutputUnsupported']+=1;continue
  if i in targets or i+1 in targets:diagnostics['overlapExcluded']+=1;continue
  targets.add(i+1);row['matched']=True
  events.append({**row,'matchType':'exact','usage':turns[i+1]['usage'],'reportedCost':turns[i+1]['reportedCost'],'requiresRuntimeStateChecks':True})
 return turns,proposals,events,dict(diagnostics)

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest',required=True,type=pathlib.Path);p.add_argument('--public',required=True,type=pathlib.Path);p.add_argument('--private',required=True,type=pathlib.Path);args=p.parse_args();manifest=json.loads(args.manifest.read_text());rows=[];events=[]
 for f in manifest['files']:
  data=pathlib.Path(f['local']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Source checksum mismatch')
  raw=json.loads(data);ts,ps,es,d=analyze(raw,f['label']);rows.append({'cohort':f['label'],'instance':raw['instance_id'],'partition':partition(raw['instance_id']),'turns':ts,'proposals':ps,'events':es,'diagnostics':d});events.extend(es)
 def summary(selected):
  ts=[t for r in selected for t in r['turns']];ps=[p for r in selected for p in r['proposals']];es=[e for r in selected for e in r['events']];den=usage.sums(ts);gain=usage.sums(es)
  return {'trajectories':len(selected),'issues':len({r['instance'] for r in selected}),'denominator':den,'proposals':len(ps),'matchedCalls':len(es),'matchedIssues':len({e['instance'] for e in es}),'matchedUsage':gain,'matchPercent':100*len(es)/len(ps) if ps else 0,'callPercent':100*len(es)/den['calls'] if den['calls'] else 0,'tokenPercent':100*gain['totalTokens']/den['totalTokens'] if den['totalTokens'] else 0,'diagnostics':dict(sum((collections.Counter(r['diagnostics']) for r in selected),collections.Counter()))}
 report={'version':3,'program':'missing_rg_literal_search_repair_v3','title':'Repair a missing ripgrep with a literal file search','kind':'conditional-gross-recorded-usage-replay-estimate','policy':POLICY,**summary(rows),'cohorts':{c:summary([r for r in rows if r['cohort']==c]) for c in sorted({r['cohort'] for r in rows})},'byPartition':{g:summary([r for r in rows if r['partition']==g]) for g in ['discovery','validation']},'split':{'method':"Discovery is UNION of SHA256('autotoken-v3:'+instance_id)%5==0 and SHA256('repair-v3:'+instance_id)%5==0; validation excludes both, grouped across models",'priorExploratoryExposure':'Initial error scan used repair-v3 seed before common split was specified. Both subsets are assigned discovery, so validation excludes all issues from that scan. The larger corpus was previously used by this project; this is not untouched external validation.','validationExcludesBothDiscoverySubsets':True},'sourceManifestSha256':hashlib.sha256(args.manifest.read_bytes()).hexdigest(),'plannerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'limitations':['Program predicts from current failed request and exact native missing-rg error; next actions are labels only.','Only plain literal-pattern searches over explicit repository file paths are supported; bundles, pipes, regex changes, recursive searches and implicit paths abstain.','Exact match means same normalized cwd/pattern/file list/line-number flag. Redundant -n, quotation and path spelling differences are canonicalized; no observed command is executed.','Future executor must register grep, reject symlinks/directories, bind unchanged files and enforce file/output/runtime bounds; historical filesystem conditions are not reconstructed.','Whole singleton response and one aligned result required. Multi-tool or bundled responses are not credited as saved calls.','Removing a matching response may discard useful reasoning; no preserved task-quality claim.','Recorded usage is original-call usage; avoided usage is a conditional gross estimate before program/router overhead, false-positive costs or downstream cache changes.','Cache and reasoning are subsets of input/output totals, not added again.','No paid inference or recorded commands executed.','Discovery includes both initial and common hash subsets; validation excludes their union. Prior project research means this is not untouched external evaluation.']}
 args.public.write_text(json.dumps(report,indent=2)+'\n');args.private.parent.mkdir(parents=True,exist_ok=True);args.private.write_text(json.dumps(events,indent=2));args.private.chmod(0o600);print(json.dumps({k:report[k] for k in ['proposals','matchedCalls','matchedIssues','matchedUsage','callPercent','tokenPercent','diagnostics']},indent=2))
if __name__=='__main__':main()
