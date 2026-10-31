"""Inert discovery mining for native OpenHands tools; no shell/code execution."""
import json,pathlib,re,shlex,collections,argparse
MAX_LINES=250

def result(a):return '\n'.join(x.get('content','') for x in a.get('results',[]))
def singleton(t):return t['actions'][0] if len(t.get('actions',[]))==1 else None
def view(a):return bool(a and a['name']=='str_replace_editor' and a.get('arguments',{}).get('command')=='view')
def valid_path(p):return isinstance(p,str) and p.startswith('/workspace/') and len(p)<=4096 and '\x00' not in p and '..' not in p.split('/')
# Intended for an immediate serialized retry on the same file version. A
# concurrent edit invalidates the error-reported length; never loop retries.
def repair_view(a,observation,retries=0):
 if retries!=0 or not view(a) or not isinstance(observation,str) or len(observation)>1024:return None
 args=a.get('arguments',{});p=args.get('path');v=args.get('view_range')
 if not set(args)<= {'path','command','view_range'}:return None
 if not valid_path(p) or not isinstance(v,list) or len(v)!=2 or any(type(x)is not int for x in v):return None
 lo,hi=v
 if lo<1 or hi<lo or hi-lo+1>MAX_LINES:return None
 match=re.fullmatch(r'ERROR:\nInvalid `view_range` parameter: \[(\d+), (\d+)\]\. Its second element `(\d+)` should be smaller than the number of lines in the file: `(\d+)`\.',observation.strip())
 if not match:return None
 x,y,z,n=map(int,match.groups())
 if [x,y]!=v or z!=hi or not lo<=n<hi:return None
 return {'name':'str_replace_editor','arguments':{'command':'view','path':p,'view_range':[lo,n]}}

def range_of(a):
 if not view(a):return None
 v=a.get('arguments',{}).get('view_range')
 return v if isinstance(v,list) and len(v)==2 and all(type(x)is int for x in v) and v[0]>=1 and v[1]>=v[0] else None

def pytest_command(a):
 if not a or a['name']!='execute_bash' or a.get('arguments',{}).get('is_input') in (True,'true'):return None
 c=a.get('arguments',{}).get('command','')
 if any(x in c for x in ('\n','|',';','>','<','`','$')):return None
 try:t=shlex.split(c)
 except ValueError:return None
 if t[:1]==['cd']:
  if len(t)<4 or t[2]!='&&':return None
  t=t[3:]
 if '&&' in t:return None
 if t[:3] in (['python','-m','pytest'],['python3','-m','pytest']):t=t[3:]
 elif t[:1]==['pytest']:t=t[1:]
 else:return None
 return c

def mine(records):
 candidates={k:[] for k in ['view_range_repair','view_expansion','edit_failure_readback','edit_followed_by_prior_pytest','test_failure_source_context']};toolcounts=collections.Counter();gaps=[];turns=0;labelPairs=0;viewRangeErrors=0
 for record in records:
  recent_test=None;turnlist=record['turns'];turns+=len(turnlist)
  for i,t in enumerate(turnlist):
   for action in t['actions']:
    toolcounts[action['name']]+=1
    if not action.get('results') and action['name']!='finish':gaps.append({'issue':record['instanceId'],'ordinal':i,'tool':action['name']})
   a=singleton(t)
   if not a or not a.get('results'):continue
   obs=result(a);args=a.get('arguments',{});previous_test=recent_test
   if view(a) and obs.startswith('ERROR:\nInvalid `view_range` parameter:'):viewRangeErrors+=1
   test=pytest_command(a)
   if test and '[Command finished with exit code 0]' in obs:recent_test=test
   if i+1>=len(turnlist):continue
   nt=turnlist[i+1]
   # Five terminal non-finish tool gaps cannot supply next-action success labels.
   if any(not x.get('results') and x['name']!='finish' for x in nt['actions']):continue
   labelPairs+=1;n=singleton(nt);na=n.get('arguments',{}) if n else {};no=result(n) if n else ''
   base={'issue':record['instanceId'],'sourceOrdinal':i,'targetOrdinal':i+1}
   proposal=repair_view(a,obs)
   if proposal:
    exact=bool(n and n['name']==proposal['name'] and na==proposal['arguments'])
    semantic=exact or bool(view(n) and set(na)<= {'path','command','view_range'} and na.get('path')==args.get('path') and na.get('view_range')==[proposal['arguments']['view_range'][0],-1])
    candidates['view_range_repair'].append({**base,'proposal':proposal,'exactNextAction':exact,'sameReadToEOF':semantic,'nextSucceeded':semantic and no.startswith("Here's the result of running `cat -n` on " ) and all(line in {int(x) for x in re.findall(r'^\s*(\d+)\t',no,re.M)} for line in range(proposal['arguments']['view_range'][0],proposal['arguments']['view_range'][1]+1))})
   v=range_of(a)
   if v and not obs.startswith('ERROR:') and v[1]-v[0]+1<=MAX_LINES:
    # Freeze expansion before looking at target ranges.
    expanded=[max(1,v[0]-40),v[1]+40]
    if expanded[1]-expanded[0]+1>MAX_LINES:expanded[1]=expanded[0]+MAX_LINES-1
    nv=range_of(n);same=view(n) and na.get('path')==args.get('path')
    covered=bool(same and nv and expanded[0]<=nv[0] and expanded[1]>=nv[1])
    original=bool(same and nv and v[0]<=nv[0] and v[1]>=nv[1])
    candidates['view_expansion'].append({**base,'nextSameFileView':bool(same),'nextRangeCovered':covered,'alreadyCovered':original,'proposedAdditionalLines':expanded[1]-expanded[0]+1-(v[1]-v[0]+1)})
   if a['name']=='str_replace_editor' and args.get('command')=='str_replace' and obs.startswith('ERROR:'):
    candidates['edit_failure_readback'].append({**base,'failure':'ambiguous' if 'Multiple occurrences' in obs else 'unchanged' if 'must be different' in obs else 'missing_text' if 'did not appear verbatim' in obs else 'other','nextSameFileView':bool(view(n) and na.get('path')==args.get('path')),'nextAnotherEdit':bool(n and n['name']=='str_replace_editor' and na.get('command')=='str_replace')})
   if a['name']=='str_replace_editor' and args.get('command') in ('str_replace','create') and not obs.startswith('ERROR:') and previous_test:
    exact=bool(n and n['name']=='execute_bash' and na.get('command')==previous_test and na.get('is_input') not in ('true',True))
    candidates['edit_followed_by_prior_pytest'].append({**base,'exactNextCommand':exact,'nextAnyPytest':bool(pytest_command(n))})
   if test and '[Command finished with exit code 0]' not in obs and re.search(r'\bFAILED\b|\b\d+ failed\b',obs):
    pointers=[]
    for match in re.finditer(r'^((?:/?[\w.-]+/)*[\w.-]+\.py):(\d+):',obs,re.M):
     if (match[1],int(match[2])) not in pointers:pointers.append((match[1],int(match[2])))
    if pointers:
     pointers=pointers[:4];nv=range_of(n);hit=bool(view(n) and nv and any(na.get('path','').endswith('/'+p.lstrip('/')) and max(1,line-20)<=nv[0]<=nv[1]<=line+20 for p,line in pointers))
     candidates['test_failure_source_context'].append({**base,'pointerCount':len(pointers),'nextViewRangeCovered':hit})
 summary={}
 for k,es in candidates.items():
  entry={'events':len(es),'issues':len(set(e['issue'] for e in es))}
  for flag in ['exactNextAction','sameReadToEOF','nextSucceeded','nextSameFileView','nextRangeCovered','alreadyCovered','nextAnotherEdit','exactNextCommand','nextAnyPytest','nextViewRangeCovered']:
   if any(flag in e for e in es):entry[flag]=sum(bool(e.get(flag)) for e in es)
  if k=='view_range_repair':
   entry['equivalentEOFOnly']=sum(e['sameReadToEOF'] and not e['exactNextAction'] for e in es)
   entry['exactMatchIssues']=len(set(e['issue'] for e in es if e['exactNextAction']))
   entry['equivalentMatchIssues']=len(set(e['issue'] for e in es if e['sameReadToEOF']))
  if k=='view_expansion':entry['proposedAdditionalLines']=sum(e['proposedAdditionalLines'] for e in es)
  if k=='edit_failure_readback':entry['failures']=dict(collections.Counter(e['failure'] for e in es))
  summary[k]=entry
 return {'records':len(records),'issues':len(set(r['instanceId'] for r in records)),'turns':turns,'toolCalls':dict(toolcounts),'eligibleAdjacentPairs':labelPairs,'viewRangeErrors':viewRangeErrors,'nonfinishResultGaps':gaps,'summary':summary,'events':candidates}

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--input',required=True,type=pathlib.Path);parser.add_argument('--output',required=True,type=pathlib.Path);options=parser.parse_args()
 records=[json.loads(line) for line in options.input.open()];records=[r for r in records if r['harness']=='openhands' and r['partition']=='discovery']
 report=mine(records);report['limitations']=['Discovery observations only; no frozen heldout evaluation or causal savings.','Proposal inputs precede target actions; next-action comparisons label potential only.','Native structured edits already exist: another exact-replacement API is not a new optimization here.','Output expansion adds context; historical file content beyond displayed ranges is unavailable.','Exact tool-action reproduction does not establish preservation of assistant reasoning or task success.','Read repair prototype emits bounded arguments only; no source files, imports or recorded commands executed.','Repair assumes unchanged file version and immediate serialized retry; any repeated error falls back.','Pytest loop is a compatibility label, not authorization to run tests after every edit.','All missing non-finish tool-result targets excluded; finish calls normally have no tool result.']
 options.output.mkdir(parents=True,exist_ok=True);p=options.output/'report.json';p.write_text(json.dumps(report,indent=2));p.chmod(0o600)
 print(json.dumps({k:v for k,v in report.items() if k not in ('events','limitations')},indent=2))
if __name__=='__main__':main()
