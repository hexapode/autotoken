"""Observe comparison intent; never execute historical commands."""
import json,pathlib,re
s=json.load(open('data/experiments/router-all-traces-v2/snapshot.json'));assign=json.load(open('data/experiments/router-all-traces-v2/report.json'))['assignments'];events=[]
for run in s['runs']:
 if run['arm']!='baseline' or assign[run['instanceId']] not in [2,3,4]:continue
 for t in run['turns']:
  if not t['valid']:continue
  command='\n'.join(a.get('command') or '' for a in t['actions'])
  if 'pytest' not in command:continue
  stash='git stash' in command
  direct='write_bytes(' in command and 'git' in command and 'HEAD:' in command and 'finally:' in command
  if not stash and not direct:continue
  broad=bool(re.search(r'git stash(?: -q| push -q)?\s*(?:;|\n)',command))
  events.append({'issue':run['instanceId'],'traceId':t['id'],'kind':'stash' if stash else 'temporary_source_replacement','wholeTreeStash':broad,'historicalExplicitRegressionOverlayAvailable':False})
summary={'observations':len(events),'distinctIssues':len({e['issue'] for e in events}),'stashComparisons':sum(e['kind']=='stash' for e in events),'temporarySourceReplacement':sum(e['kind']=='temporary_source_replacement' for e in events),'wholeTreeStash':sum(e['wholeTreeStash'] for e in events),'automaticReplayEligibleWithVerifiedHistoricalRegressionOverlay':0}
report={'scope':'Baseline discovery folds 2,3,4 only','summary':summary,'events':events,'interpretation':'Comparison intent exists; an explicit identical regression overlay would make these workflows safer. Source snapshots and regression overlays have not been reconstructed, so no historical comparison is certified replayable.','limitations':['Whole-tree stash can remove tracked regression additions; observed command shape alone does not establish an actual false pass.','Synthetic fixture validates mechanics, not real issue correctness or saved calls.','Tests can modify files outside their temporary checkout: trusted tests only; no security sandbox.','Executable file modes, symlinks, submodules, untracked dependencies, and custom environments are unsupported by this prototype.','User-supplied added source files must be explicit.','A failing baseline can reflect an environment failure; retain and inspect evidence.']}
out=pathlib.Path('data/analysis/isolated-regression-v1');out.mkdir(parents=True,exist_ok=True);(out/'report.json').write_text(json.dumps(report,indent=2));(out/'report.json').chmod(0o600);print(json.dumps(summary,indent=2))
