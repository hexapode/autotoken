import importlib.util,pathlib,json,collections
spec=importlib.util.spec_from_file_location('rerun',pathlib.Path(__file__).with_name('targeted-rerun.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
s=json.load(open('data/experiments/router-all-traces-v2/snapshot.json'));a=json.load(open('data/experiments/router-all-traces-v2/report.json'))['assignments'];events=[];reasons=collections.Counter();observed=0;decisions=0;all_failure_turns=0
for run in s['runs']:
 if run['arm']!='baseline' or a[run['instanceId']] not in [2,3,4]:continue
 for i,t in enumerate(run['turns']):
  decisions+=1
  if not t['valid']:continue
  if any(line.startswith('FAILED ') for act in t['actions'] for line in (act.get('result') or '').splitlines()):all_failure_turns+=1
  if len(t['actions'])!=1 or t['actions'][0]['name'] not in ['local_bash','container_bash']:continue
  action=t['actions'][0];command=action.get('command') or '';result=action.get('result') or ''
  if not any(line.startswith('FAILED ') for line in result.splitlines()):continue
  observed+=1
  proposal=m.plan(command,result) # Frozen before reading next action.
  if proposal['status']!='planned':reasons[proposal['reason']]+=1;continue
  nxt=run['turns'][i+1] if i+1<len(run['turns']) else None
  nextcalls=[call for act in nxt['actions'] for call in m.pytest_calls(act.get('command') or '')] if nxt and nxt['valid'] else []
  exact=any(call['prefix']+call['args']==proposal['argv'] for call in nextcalls)
  nodes=any(set(m.node_selection(call['args']))==set(proposal['nodes']) for call in nextcalls)
  events.append({'issue':run['instanceId'],'traceId':t['id'],'proposal':proposal,'proposalJsonBytes':len(json.dumps({'argv':proposal['argv']},separators=(',',':')).encode()),'nextContainsTest':bool(nextcalls),'nextHasEdit':'edit' in nxt['tags'] if nxt else False,'nextPureTestTagged':nxt['tags']==['test-run'] if nxt else False,'exactArgvMatch':exact,'exactNodeSetMatch':nodes,'nextIsMixed':bool(nxt and any(tag!='test-run' for tag in nxt['tags']))})
summary={'discoveryDecisions':decisions,'allFailureSummaryTurns':all_failure_turns,'singleActionFailureSummaryTurns':observed,'supportedProposals':len(events),'distinctIssues':len({e['issue'] for e in events}),'abstentions':dict(reasons),'nextContainsRecognizedPytest':sum(e['nextContainsTest'] for e in events),'nextHasEdit':sum(e['nextHasEdit'] for e in events),'nextPureTestTagged':sum(e['nextPureTestTagged'] for e in events),'exactArgvMatch':sum(e['exactArgvMatch'] for e in events),'exactNodeSetMatch':sum(e['exactNodeSetMatch'] for e in events),'proposalJsonBytes':sum(e['proposalJsonBytes'] for e in events)}
report={'scope':'Baseline discovery folds2,3,4 only','summary':summary,'events':events,'limitations':['All proposals are computed from prior command/result before next-action labels.','Failure summaries may describe intentionally failing new regressions; an immediate rerun before a fix has little value.','Output truncation markers and multi-session evidence cause abstention, but absent markers do not prove complete logs.','A registered execution environment and trusted per-invocation metadata are required before executing any plan.','Changed tests can invalidate parameter IDs.','Static matches are descriptive labels, not proven whole-call replacements.','No commands were executed and no historical filesystem state reconstructed.']}
out=pathlib.Path('data/analysis/targeted-rerun-v1');out.mkdir(parents=True,exist_ok=True);(out/'report.json').write_text(json.dumps(report,indent=2));(out/'report.json').chmod(0o600);print(json.dumps(summary,indent=2))
