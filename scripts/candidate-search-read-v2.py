"""Inert unique-search -> bounded-context planner; discovery replay, never executes shell."""
import argparse,collections,hashlib,importlib.util,json,pathlib,re,shlex
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('usage',ROOT/'scripts/estimate-recorded-usage.py');u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
POLICY={'lineRadius':100,'fileLines':200,'maxOutputBytes':16000,'requiresUnchangedFile':True,'requiresRepoRootAndNoSymlinks':True}
def path(p):
 if p.startswith('/testbed/'):p=p[9:]
 elif p.startswith('/'):return None
 if not re.fullmatch(r'[A-Za-z0-9_.][A-Za-z0-9_./-]{0,249}',p) or any(x in ('','..','.') for x in p.split('/')) or p.startswith('-'):return None
 return '/testbed/'+p

def tokens(command):
 if not isinstance(command,str) or len(command)>4096 or any(c in command for c in ['\n','`','$',';','|','>','<']):return None
 try:a=shlex.split(command)
 except ValueError:return None
 if a[:3]==['cd','/testbed','&&']:a=a[3:]
 if any(x in a for x in ['&&','&','||']):return None
 return a

def output(obs):
 m=re.fullmatch(r'<returncode>0</returncode>\n<output>\n?(.*?)\n?</output>',obs,re.S)
 if not m or len(m[1].encode())>16000 or re.search(r'truncat|omitted|output too long',m[1],re.I):return None
 return m[1]

def plan(command,obs):
 a=tokens(command);o=output(obs)
 if not a or o is None:return None
 lines=o.splitlines()
 if len(lines)!=1:return None
 if a[0] in ['grep','rg']:
  # Only ordinary line-number searches; context, filtering and max-count are refused.
  flags=[];pos=[]
  for x in a[1:]:
   if x.startswith('-'):flags.append(x)
   else:pos.append(x)
  if len(pos)!=2 or not flags or not all(re.fullmatch(r'-[nriHFE]+',f) for f in flags) or not any('n'in f for f in flags):return None
  m=re.fullmatch(r'(?:(.+):)?([1-9][0-9]*):(.*)',lines[0])
  if not m:return None
  p=path(m[1] if m[1] else pos[1]);n=int(m[2])
  if not p or n>1000000:return None
  return {'path':p,'start':max(1,n-100),'end':n+100,'kind':'unique_line_context','maxOutputBytes':16000}
 if a[0]=='find':
  # No -exec, expressions, piped head, or directories masquerading as source reads.
  if len(a) not in [4,6] or a[2]!='-name' or (len(a)==6 and a[4:]!=['-type','f']):return None
  if not path(a[1].rstrip('/')+'/placeholder') or not re.fullmatch(r'[A-Za-z0-9_.*?-]{1,100}',a[3]):return None
  p=path(lines[0])
  if p:return {'path':p,'start':1,'end':200,'kind':'unique_file_context','maxOutputBytes':16000}
 return None

def read(command,obs):
 a=tokens(command);o=output(obs)
 if not a or o is None:return None
 p=None;lo=1;hi=None
 if len(a)==4 and a[:2]==['sed','-n']:
  m=re.fullmatch(r'([1-9][0-9]*),([1-9][0-9]*)p',a[2])
  if not m:return None
  lo,hi=map(int,m.groups());p=path(a[3])
 elif len(a)==3 and a[0]=='head' and re.fullmatch(r'-[1-9][0-9]*',a[1]):hi=int(a[1][1:]);p=path(a[2])
 elif len(a)==4 and a[:2]==['head','-n'] and a[2].isdigit():hi=int(a[2]);p=path(a[3])
 elif len(a)==2 and a[0]=='cat':p=path(a[1]);hi=len(o.splitlines())
 if not p or not hi or hi<lo or hi-lo+1>250 or not o.splitlines() or len(o.splitlines())>hi-lo+1:return None
 return {'path':p,'start':lo,'end':hi,'observedLines':len(o.splitlines()),'catToEOF':a[0]=='cat','bytes':len(o.encode())}

def classify(p,r):
 if not r or r['path']!=p['path'] or r['bytes']>p['maxOutputBytes']:return None
 if not r['catToEOF'] and p['start']==r['start'] and p['end']==r['end']:return 'exact'
 if p['start']<=r['start'] and p['end']>=r['end']:return 'coverage_only'
 return None

def stats(events):
 return {'matchedCalls':len(events),'matchedIssues':len({e['instance']for e in events}),'matchedUsage':u.sums(events)}
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--manifest',type=pathlib.Path,required=True);ap.add_argument('--public',type=pathlib.Path,required=True);ap.add_argument('--private',type=pathlib.Path,required=True);args=ap.parse_args();manifest=json.loads(args.manifest.read_text());events=[];rows=[]
 for f in manifest['files']:
  data=pathlib.Path(f['local']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Checksum mismatch')
  raw=json.loads(data);ts=u.normalize(raw);label=f['label'];proposals=0;targeted=set()
  for i,t in enumerate(ts[:-1]):
   if len(t['actions'])!=1:continue
   a=t['actions'][0]
   if a['name']!='bash' or len(a['results'])!=1:continue
   p=plan(a['command'],a['results'][0])
   if not p:continue
   proposals+=1;n=ts[i+1];match=None
   if len(n['actions'])==1:
    b=n['actions'][0]
    if b['name']=='bash' and len(b['results'])==1:match=classify(p,read(b['command'],b['results'][0]))
   if match and i not in targeted and i+1 not in targeted:
    targeted.add(i+1);events.append({'cohort':label,'instance':raw['instance_id'],'sourceOrdinal':i,'targetOrdinal':i+1,'matchType':match,'usage':n['usage'],'reportedCost':n['reportedCost'],'plan':p,'extraContextCostNotMeasured':match=='coverage_only'})
  rows.append({'cohort':label,'instance':raw['instance_id'],'proposals':proposals,'calls':len(ts)})
 exact=[e for e in events if e['matchType']=='exact'];covered=[e for e in events if e['matchType']=='coverage_only']
 report={'program':'search_read_v2','title':'Read context around the only search hit','kind':'conditional_gross_replay_estimate_not_measured_savings','policy':POLICY,'trajectories':len(rows),'calls':sum(r['calls']for r in rows),'proposals':sum(r['proposals']for r in rows),**stats(exact),'coverageOnly':stats(covered),'cohorts':{c:{'proposals':sum(r['proposals']for r in rows if r['cohort']==c),**stats([e for e in exact if e['cohort']==c]),'coverageOnly':stats([e for e in covered if e['cohort']==c])}for c in sorted({r['cohort']for r in rows})},'unmatchedProposals':sum(r['proposals']for r in rows)-len(events),'limitations':['Discovery policy, not held-out validation; fixed plus/minus100-line policy chosen before evaluating labels.','Only exact fixed-range matches count in matchedCalls. Coverage-only next reads may be supplied by a larger context output; extra output and downstream input costs are not measured, so their recorded target-call tokens are a gross opportunity ceiling only. Historical files are not reconstructed, so the larger output may hit its byte cap before covering the desired lines.','Recorded input includes cache subsets; cache and reasoning details are not added twice.','Read-only program must validate repository paths, reject symlinks, and bind unchanged file version at runtime; inert replay does not reconstruct historical filesystem state.','Matched response may contain useful reasoning; removing it is not independently validated. Strict causal saved-call credit is zero.','Router, discovery and fallback costs are excluded; source-reported costs are not verified invoices.','No recorded commands executed. Pure reads require successful nontruncated observed output; bundled/multitool turns not credited.'], 'sourceManifestSha256':hashlib.sha256(args.manifest.read_bytes()).hexdigest(),'plannerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}
 args.public.write_text(json.dumps(report,indent=2)+'\n');args.private.parent.mkdir(parents=True,exist_ok=True);args.private.write_text(json.dumps(events,indent=2));args.private.chmod(0o600);print(json.dumps(report,indent=2))
if __name__=='__main__':main()
