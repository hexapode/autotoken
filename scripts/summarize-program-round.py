"""Audit new program events against source calls and combine with frozen baseline.

Accounting only: original-call usage is not proof of avoided live usage.
"""
import argparse,hashlib,importlib.util,json,pathlib,sqlite3,collections
ROOT=pathlib.Path(__file__).resolve().parents[1]
def module(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
core=module('round_core','trace_batch_core.py');u=module('round_usage','estimate-recorded-usage.py');agg=module('round_union','aggregate-candidate-estimates.py')

def figures(events,denominator):
 usage=u.sums(events)
 return {'matchedUsage':usage,'matchedIssues':len({e['instance'] for e in events}),'callPercent':100*usage['calls']/denominator['calls'] if denominator['calls'] else 0,'tokenPercent':100*usage['totalTokens']/denominator['totalTokens'] if denominator['totalTokens'] else 0,'sourceReportedCostPercent':100*usage['sourceReportedCostSum']/denominator['sourceReportedCostSum'] if denominator['sourceReportedCostSum'] else 0}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest',type=pathlib.Path,required=True);p.add_argument('--baseline',type=pathlib.Path,required=True);p.add_argument('--cache',type=pathlib.Path,required=True);p.add_argument('--candidate',nargs=2,action='append',required=True);p.add_argument('--public',type=pathlib.Path,required=True);a=p.parse_args()
 manifest=json.loads(a.manifest.read_text());baseline=json.loads(a.baseline.read_text());denominator=baseline['denominator'];newreports=[];new_events=[]
 if hashlib.sha256(a.manifest.read_bytes()).hexdigest()!=baseline['sourceManifestSha256']:raise ValueError('Baseline corpus mismatch')
 for reportfile,eventfile in a.candidate:
  report=json.loads(pathlib.Path(reportfile).read_text());es=json.loads(pathlib.Path(eventfile).read_text())
  if not isinstance(es,list):raise ValueError('Expected event list')
  exact=[e for e in es if e.get('matchType','exact')=='exact']
  if len(exact)!=report['matchedCalls']:raise ValueError('Candidate report/event count mismatch')
  seen=set()
  for e in exact:
   key=(e['cohort'],e['instance'],e['targetOrdinal'])
   if key in seen:raise ValueError('Duplicate target within candidate')
   seen.add(key);e['program']=report['program']
  new_events.extend(exact);newreports.append((report,exact,pathlib.Path(reportfile).name))
 wanted=collections.defaultdict(list)
 for e in new_events:wanted[(e['cohort'],e['instance'])].append(e)
 verified=0;old_events=[];db=sqlite3.connect('file:'+str(a.cache.resolve())+'?mode=ro',uri=True)
 for entry in manifest['files']:
  path=pathlib.Path(entry['local']);data=path.read_bytes()
  if hashlib.sha256(data).hexdigest()!=entry['sha256']:raise ValueError('Source bytes changed')
  key=hashlib.sha256((entry['label']+':'+entry['sha256']+':'+baseline['policyHash']).encode()).hexdigest();cached=db.execute('SELECT result FROM results WHERE key=?',(key,)).fetchone()
  if not cached:raise ValueError('Missing frozen baseline cache entry')
  row=json.loads(cached[0]);old_events.extend(e for e in row['events'] if e['matchType']=='exact')
  matches=wanted.get((entry['label'],row['instance']),[])
  if not matches:continue
  raw=json.loads(data);turns=core.normalize(raw)
  for e in matches:
   i=e['sourceOrdinal'];j=e['targetOrdinal']
   if j!=i+1 or i<0 or j>=len(turns):raise ValueError('Invalid adjacent call indices')
   source,target=turns[i],turns[j]
   for turn in [source,target]:
    if len(turn['actions'])!=1 or len(turn['actions'][0]['results'])!=1:raise ValueError('Not a supported singleton response')
   if e['usage']!=target['usage'] or e.get('reportedCost')!=target['reportedCost']:raise ValueError('Usage mismatch against original call')
   verified+=1
 if verified!=len(new_events):raise ValueError('Candidate events missing in corpus')
 db.close();old_selected,_,_=agg.select_union(old_events)
 if u.sums(old_selected)['calls']!=baseline['union']['matchedUsage']['calls'] or u.sums(old_selected)['totalTokens']!=baseline['union']['matchedUsage']['totalTokens']:raise ValueError('Frozen baseline events disagree')
 rows=[]
 for c in baseline['candidates']:
  es=[e for e in old_events if e['program']==c['program']]
  rows.append({'program':c['program'],'title':c['title'],'round':'previous','proposals':c['proposals'],'proposalMatchPercent':100*len(es)/c['proposals'] if c['proposals'] else 0,**figures(es,denominator)})
 for report,es,file in newreports:
  rows.append({'program':report['program'],'title':report['title'],'round':'new','sourceReport':file,'proposals':report['proposals'],'proposalMatchPercent':100*len(es)/report['proposals'] if report['proposals'] else 0,**figures(es,denominator),'cohorts':report.get('cohorts'),'partitions':report.get('byPartition',report.get('partitions'))})
 combined,duplicates,chains=agg.select_union(old_events+new_events);new_only,nd,nc=agg.select_union(new_events)
 report={'version':1,'kind':'conditional-gross-program-replay-percentages','trajectories':baseline['trajectories'],'uniqueIssues':baseline['uniqueIssues'],'denominator':denominator,'programs':rows,'previousUnion':figures(old_selected,denominator),'newRoundUnion':{**figures(new_only,denominator),'duplicateTargetsRemoved':nd,'dependentChainsExcluded':nc},'combinedUnion':{**figures(combined,denominator),'duplicateTargetsRemoved':duplicates,'dependentChainsExcluded':chains},'incrementalExactCalls':len(combined)-len(old_selected),'sourceManifestSha256':baseline['sourceManifestSha256'],'verifiedNewEvents':verified,'limitations':['Percentages divide matched original calls/tokens by the full corpus denominator, not by proposals.','Proposal match percentage is descriptive precision, not deployment safety or task success.','Programs see prior/current observations; future calls are replay labels only.','Original recorded token counts are known; avoiding those calls is conditional on dispensable reasoning and successful program execution.','Gross estimates exclude routing/program/false-positive costs and future context/cache effects.','Per-program savings may overlap; combined totals deduplicate targets and exclude dependent adjacent substitutions.','New candidates use candidate-specific discovery/validation issue partitions; previously inspected discovery issues are excluded from validation. This corpus is not untouched external validation.','Coverage-only or EOF-equivalent scenarios are not added to exact totals.','No recorded commands are executed and no paid model calls occur.']}
 a.public.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'newRound':report['newRoundUnion'],'combined':report['combinedUnion'],'incrementalCalls':report['incrementalExactCalls']},indent=2))
if __name__=='__main__':main()
