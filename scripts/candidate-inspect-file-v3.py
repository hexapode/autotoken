"""Inert unique-file search -> bounded complete-file inspection candidate.

Plans use completed search output only. Runtime file bounds are explicit
preconditions; replay checks the recorded later read as a label, never an input.
"""
import argparse,collections,hashlib,importlib.util,json,pathlib,posixpath,re,shlex
from trace_batch_core import normalize
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('usage',ROOT/'scripts/estimate-recorded-usage.py');usage=importlib.util.module_from_spec(spec);spec.loader.exec_module(usage)
MAX_BYTES=16384;MAX_LINES=250

def partition(instance):
 # Earlier inspection used inspect-v3; union preserves an uninspected remainder
 # when the project-wide seed was supplied after that inspection began.
 return 'discovery' if any(int(hashlib.sha256((seed+instance).encode()).hexdigest(),16)%5==0 for seed in ['inspect-v3:','autotoken-v3:']) else 'validation'

def path(value):
 if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_./-]{1,240}',value) or value.startswith('-') or '..' in value.split('/'):return None
 value=posixpath.normpath(posixpath.join('/testbed',value))
 if not value.startswith('/testbed/') or any(x.startswith('.') for x in value.split('/') if x):return None
 return value

def output(text):
 if not isinstance(text,str) or text.count('<returncode>')!=1:return None
 m=re.fullmatch(r'<returncode>0</returncode>\n<output>\n?(.*?)\n?</output>',text,re.S)
 if not m or len(m[1].encode())+2>MAX_BYTES or re.search(r'truncat|omitted|output too long',m[1],re.I):return None
 return m[1]

def tokens(command):
 if not isinstance(command,str) or len(command)>4096 or any(x in command for x in ['\n',';','`','$','>','<','\\']):return None
 try:a=shlex.split(command)
 except ValueError:return None
 if a[:3]==['cd','/testbed','&&']:a=a[3:]
 if any(x in a for x in ['&&','&','||']):return None
 return a

def plan(command,observation):
 a=tokens(command);body=output(observation)
 if not a or body is None:return None
 # A head bound >=2 with only one returned path cannot hide a second path.
 if '|' in a:
  cut=a.index('|');tail=a[cut+1:]
  if tail[:2]==['head','-n'] and len(tail)==3 and tail[2].isdigit():cap=int(tail[2])
  elif len(tail)==2 and tail[0]=='head' and re.fullmatch(r'-[0-9]+',tail[1]):cap=int(tail[1][1:])
  else:return None
  if cap<2 or cap>100:return None
  a=a[:cut]
 lines=body.splitlines()
 if len(lines)!=1:return None
 discovered=None
 if a[0]=='find':
  if len(a)<4 or not (a[1] in ['.','/testbed'] or path(a[1])):return None
  rest=a[2:];seen=set()
  while rest:
   if len(rest)<2 or rest[0] in seen:return None
   flag,value,*rest=rest;seen.add(flag)
   if flag=='-type' and value=='f':continue
   if flag in ['-name','-path'] and len(value)<=160:continue
   return None
  if not seen.intersection(['-name','-path']):return None
  discovered=path(lines[0])
 elif a[0] in ['rg','grep']:
  flags=[];pos=[]
  for x in a[1:]:
   (flags if x.startswith('-') else pos).append(x)
  if len(pos)!=2 or not flags:return None
  if all(re.fullmatch(r'-[lrRiIFHE]+',flag) for flag in flags) and any('l'in flag for flag in flags):discovered=path(lines[0])
  elif all(re.fullmatch(r'-[nrRiIFHE]+',flag) for flag in flags) and any('n'in flag for flag in flags):
   m=re.fullmatch(r'(?:(.+):)?([1-9][0-9]*):(.*)',lines[0])
   if m:discovered=path(m[1] or pos[1])
 if not discovered:return None
 return {'operation':'bounded_full_file_read','path':discovered,'maxBytes':MAX_BYTES,'maxLines':MAX_LINES,'requiresRegularFileNoSymlinks':True,'requiresUnchangedFile':True,'requiresRuntimeBoundCheck':True,'runtimeOnOversize':'abstain_without_returning_partial_source'}

def classify(proposal,command,observation):
 a=tokens(command);body=output(observation)
 if not a or '|'in a or body is None or len(body.splitlines())>MAX_LINES:return None
 if len(a)==2 and a[0]=='cat' and path(a[1])==proposal['path']:return 'exact'
 limit=None;target=None
 if len(a)==3 and a[0]=='head' and re.fullmatch(r'-[1-9][0-9]*',a[1]):limit=int(a[1][1:]);target=path(a[2])
 elif len(a)==4 and a[:2]==['head','-n'] and a[2].isdigit():limit=int(a[2]);target=path(a[3])
 elif len(a)==4 and a[:2]==['sed','-n']:
  m=re.fullmatch(r'1,([1-9][0-9]*)p',a[2])
  if m:limit=int(m[1]);target=path(a[3])
 if target==proposal['path'] and limit and len(body.splitlines())<limit:return 'equivalent_eof'
 return None

def singleton(turn):
 if len(turn['actions'])!=1:return None
 a=turn['actions'][0]
 return a if a['name']=='bash' and isinstance(a['command'],str) and len(a['results'])==1 else None

def reasoning(raw,turn):
 m=raw['messages'][turn['sourceMessageIndex']]
 if m.get('object')=='response':return any(x.get('type')!='function_call' for x in m.get('output',[]))
 return bool(m.get('content')) or bool(m.get('reasoning_content')) or bool((turn['usage'] or {}).get('reasoningOutputTokens',0))

def analyze(raw,label):
 turns=normalize(raw);proposals=[];events=[];diagnostics=collections.Counter();targets=set()
 for i,t in enumerate(turns[:-1]):
  action=singleton(t)
  if not action:continue
  prediction=plan(action['command'],action['results'][0])
  if not prediction:continue
  row={'cohort':label,'instance':raw['instance_id'],'partition':partition(raw['instance_id']),'sourceOrdinal':i,'targetOrdinal':i+1}
  proposals.append(row);nextaction=singleton(turns[i+1])
  match=classify(prediction,nextaction['command'],nextaction['results'][0]) if nextaction else None
  if not match:diagnostics['nextNotMatchingBoundedWholeRead']+=1;continue
  if i in targets or i+1 in targets:diagnostics['overlapExcluded']+=1;continue
  targets.add(i+1);events.append({**row,'matchType':match,'usage':turns[i+1]['usage'],'reportedCost':turns[i+1]['reportedCost'],'reasoningOrProse':reasoning(raw,turns[i+1]),'runtimeStateChecksNotObserved':True})
 return turns,proposals,events,dict(diagnostics)

def summarize(rows):
 turns=[t for r in rows for t in r['turns']];events=[e for r in rows for e in r['events']];exact=[e for e in events if e['matchType']=='exact'];equivalent=[e for e in events if e['matchType']=='equivalent_eof'];den=usage.sums(turns);matched=usage.sums(exact);proposals=sum(len(r['proposals']) for r in rows)
 return {'trajectories':len(rows),'issues':len({r['instance'] for r in rows}),'denominator':den,'proposals':proposals,'matchedCalls':len(exact),'matchedIssues':len({e['instance']for e in exact}),'matchedUsage':matched,'matchPrecisionPercent':100*len(exact)/proposals if proposals else 0,'callPercent':100*len(exact)/den['calls'] if den['calls'] else 0,'tokenPercent':100*matched['totalTokens']/den['totalTokens'] if den['totalTokens'] else 0,'matchesWithReasoningOrProse':sum(e['reasoningOrProse'] for e in exact),'equivalentEOF':{'matchedCalls':len(equivalent),'matchedIssues':len({e['instance']for e in equivalent}),'matchedUsage':usage.sums(equivalent),'excludedFromExactTotal':True}}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest',required=True,type=pathlib.Path);p.add_argument('--public',required=True,type=pathlib.Path);p.add_argument('--private',required=True,type=pathlib.Path);p.add_argument('--partition',choices=['all','discovery','validation'],default='all');a=p.parse_args();m=json.loads(a.manifest.read_text());rows=[];events=[]
 for f in m['files']:
  if a.partition!='all' and partition(f['instanceId'])!=a.partition:continue
  data=pathlib.Path(f['local']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Source checksum mismatch')
  raw=json.loads(data);ts,ps,es,ds=analyze(raw,f['label']);rows.append({'instance':raw['instance_id'],'partition':partition(raw['instance_id']),'cohort':f['label'],'turns':ts,'proposals':ps,'events':es});events.extend(es)
 summary=summarize(rows);report={'version':3,'program':'inspect_unique_small_file_v3','title':'Inspect the only matching small file','kind':'conditional-gross-replay-estimate','policy':{'maxBytes':MAX_BYTES,'maxLines':MAX_LINES,'source':'One path from bounded supported find/grep/rg result','prediction':'Complete file read, only after regular-file, no-symlink, unchanged-file and size checks','nextActionDoesNotChooseArguments':True},**summary,'cohorts':{label:summarize([r for r in rows if r['cohort']==label])for label in sorted({r['cohort']for r in rows})},'byPartition':{part:summarize([r for r in rows if r['partition']==part])for part in ['discovery','validation']},'split':'Discovery is union of SHA256(inspect-v3:instance_id)%5==0 and SHA256(autotoken-v3:instance_id)%5==0, because initial inspection preceded the common-seed instruction. Models for an issue stay together. Validation excluded both sets before policy evaluation.','limitations':['New candidate developed on a deterministic discovery subset; corpus had prior project analysis, so validation is not untouched external data.','Runtime file size/type/symlink/state checks are required but not reconstructed from source observations. Matched target outputs fit bounds retrospectively; conservative deployment credit is zero.','Exact means pure cat of the same complete file; head/sed reads reaching EOF are listed separately, not included in exact percentages.','Source search output alone does not establish intent to read the file; unmatched proposals may alter workflow.','All token savings are conditional gross recorded-call usage, not causal saved tokens or preserved task quality.','Removing calls may discard useful reasoning; no routing or program overhead and no downstream context/cache changes modeled.','Cached input and reasoning are subsets of usage totals, never added again.','No recorded commands executed and no paid inference.'],'plannerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'sourceManifestSha256':hashlib.sha256(a.manifest.read_bytes()).hexdigest()}
 a.public.write_text(json.dumps(report,indent=2)+'\n');a.private.parent.mkdir(parents=True,exist_ok=True);a.private.write_text(json.dumps([e for e in events if e['matchType']=='exact'],indent=2));a.private.chmod(0o600);other=a.private.with_name(a.private.stem+'-equivalent.json');other.write_text(json.dumps([e for e in events if e['matchType']!='exact'],indent=2));other.chmod(0o600);print(json.dumps({k:summary[k]for k in ['trajectories','proposals','matchedCalls','matchedIssues','matchedUsage','callPercent','tokenPercent','equivalentEOF']},indent=2))
if __name__=='__main__':main()
