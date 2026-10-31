"""Validate imported samples and publish aggregate metadata only when requested."""
import argparse,collections,json,pathlib,re

def audit(root,known_path):
 if not known_path.exists():raise ValueError('Known issue fold manifest required; pass --known-folds')
 known=json.loads(known_path.read_text())['assignments']
 counts=collections.Counter();seen=set();issues=set();groups={};repos=set();names=collections.Counter();missing=[]
 for line in (root/'sample.jsonl').open():
  r=json.loads(line);key=(r['harness'],r['instanceId'])
  assert key not in seen;seen.add(key)
  assert r['instanceId'] not in known and r['fold'] in (2,3,4)
  assert len(r['messages'])==len(r['sourceMessages']) and r['usage'] is None
  group=r['groupKey'].casefold();assert group not in groups or groups[group]==r['fold'];groups[group]=r['fold']
  issues.add(r['instanceId']);repos.add(r['instanceId'].split('.')[0] if '.' in r['instanceId'] else re.sub(r'-[0-9]+$','',r['instanceId']));counts[r['harness']]+=1
  for t in r['turns']:
   assert r['messages'][t['sourceMessageIndex']]['role']=='assistant'
   for action in t['actions']:
    names[(r['harness'],action['name'])]+=1
    if action.get('alignment')=='unmatched':missing.append({'name':action['name'],'terminal':t['ordinal']==len(r['turns'])-1})
 summary=json.loads((root/'summary.json').read_text())
 assert sum(counts.values())==sum(c['trajectories'] for c in summary['counts'].values())
 for entry in summary['catalog']:assert counts[entry['harness']]==entry['selected']
 summary['global']={'trajectories':sum(counts.values()),'distinctIssueIds':len(issues),'splitGroups':len(groups),'repositories':len(repos),'assistantTurns':sum(x['assistantTurns'] for x in summary['counts'].values()),'toolActions':sum(x['actions'] for x in summary['counts'].values())}
 summary['toolNames']=[{'harness':h,'name':n,'count':c} for (h,n),c in names.items()]
 summary['observationGaps']={'unmatchedNativeCalls':len(missing),'terminalUnmatchedCalls':sum(x['terminal'] for x in missing)}
 summary['validation']='Unique issue per harness; known local issues excluded; discovery-only groups consistent; original message arrays retained; action source indices checked. Missing native tool observations counted separately from terminal finish.'
 (root/'summary.json').write_text(json.dumps(summary,indent=2));return summary
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--known-folds',default='data/experiments/router-all-traces-v2/report.json');parser.add_argument('--publish-summary');args=parser.parse_args()
 summary=audit(pathlib.Path(args.output),pathlib.Path(args.known_folds))
 if args.publish_summary:pathlib.Path(args.publish_summary).write_text(json.dumps(summary,indent=2))
 print(json.dumps({'global':summary['global'],'gaps':summary['observationGaps']},indent=2))
