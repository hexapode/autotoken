"""Run frozen deterministic program classifiers over thousands of trace files.

Offline only: classify current/history observations, score the next recorded
whole response, and sum original usage. Never execute recorded commands.
"""
import argparse,collections,concurrent.futures,hashlib,importlib.util,json,os,pathlib,sqlite3,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
def module(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
u=module('batch_usage','estimate-recorded-usage.py')
core=module('batch_core','trace_batch_core.py')
w=module('batch_write','candidate-write-run-v2.py')
s=module('batch_search','candidate-search-read-v2.py')
r=module('batch_rerun','candidate-rerun-v2.py')
f=module('batch_failed','candidate-failed-rerun-v2.py')
a=module('batch_union','aggregate-candidate-estimates.py')
PROGRAMS={'write_then_run_v2':'Write a script and run it','search_read_v2':'Read context around the only search hit','registered_test_rerun_v2':'Rerun a previously passing test','registered_failed_test_rerun_v2':'Rerun a failed assertion regression'}
SOURCES=['batch-program-replay.py','trace_batch_core.py','estimate-recorded-usage.py','mine-public-mini.py','candidate-write-run-v2.py','candidate-search-read-v2.py','candidate-rerun-v2.py','candidate-failed-rerun-v2.py','aggregate-candidate-estimates.py']

def hash_stream(stream):
 digest=hashlib.sha256()
 for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
 return digest.hexdigest()

def policy_hash(programs):
 hashes={p:hashlib.sha256((ROOT/'scripts'/p).read_bytes()).hexdigest() for p in SOURCES}
 return hashlib.sha256(json.dumps({'sources':hashes,'programs':programs},sort_keys=True).encode()).hexdigest(),hashes

def singleton(t):
 if len(t['actions'])!=1:return None
 x=t['actions'][0]
 return x if x['name']=='bash' and isinstance(x['command'],str) and len(x['results'])==1 else None

def classify(raw,label,programs):
 turns=core.normalize(raw);events=[];stats={p:{'proposals':0,'exactMatches':0,'coverageOnlyMatches':0,'overlapExcluded':0} for p in programs};targets={p:set() for p in programs}
 diagnostics=collections.Counter();instance=raw['instance_id']
 for t in turns:
  diagnostics['nativeToolActions']+=len(t['actions'])
  diagnostics['recognizedBashActions']+=sum(x['name']=='bash' and isinstance(x['command'],str) for x in t['actions'])
  diagnostics['multiToolResponses']+=len(t['actions'])>1
  diagnostics['responsesWithoutUsage']+=t['usage'] is None
 for i,t in enumerate(turns[:-1]):
  current=singleton(t)
  if not current:continue
  nxt=turns[i+1];nextaction=singleton(nxt)
  for program in programs:
   proposal=None;kind=None
   if program=='write_then_run_v2':
    proposal=w.plan(current['command'],current['results'][0])
    if proposal and nextaction and w.parse_run(nextaction['command'])=={k:proposal[k] for k in ['argv','cwd']}:kind='exact'
   elif program=='search_read_v2':
    proposal=s.plan(current['command'],current['results'][0])
    if proposal and nextaction:kind=s.classify(proposal,s.read(nextaction['command'],nextaction['results'][0]))
   else:
    proposal=(r.plan if program=='registered_test_rerun_v2' else f.plan)(turns[max(0,i-12):i],t)
    if proposal and nextaction:
     predicted=r.test_command(nextaction['command'])
     if predicted and predicted['cwd']==proposal['cwd'] and predicted['argv']==proposal['argv']:kind='exact'
   if not proposal:continue
   stats[program]['proposals']+=1
   if not kind:continue
   if i in targets[program] or i+1 in targets[program]:stats[program]['overlapExcluded']+=1;continue
   targets[program].add(i+1)
   stats[program]['exactMatches' if kind=='exact' else 'coverageOnlyMatches']+=1
   events.append({'program':program,'cohort':label,'instance':instance,'sourceOrdinal':i,'targetOrdinal':i+1,'matchType':kind,'usage':nxt['usage'],'reportedCost':nxt['reportedCost'],'reasoningOrProse':w.has_reasoning(raw,nxt)})
 # Write/run's original standalone analyzer also counts a supported last write
 # as a proposal without a next response; preserve that denominator.
 if turns and 'write_then_run_v2' in programs:
  last=singleton(turns[-1])
  if last and w.plan(last['command'],last['results'][0]):stats['write_then_run_v2']['proposals']+=1
 return {'instance':instance,'cohort':label,'usage':u.sums(turns),'stats':stats,'events':events,'diagnostics':dict(diagnostics),'reportedApiCalls':raw.get('info',{}).get('model_stats',{}).get('api_calls')}

def work(job):
 entry,programs,max_bytes=job;started=time.perf_counter()
 try:
  path=pathlib.Path(entry['local'])
  if path.stat().st_size>max_bytes:raise ValueError('Trace exceeds configured byte bound')
  data=path.read_bytes()
  if hashlib.sha256(data).hexdigest()!=entry['sha256']:raise ValueError('Source checksum mismatch')
  raw=json.loads(data)
  if not isinstance(raw.get('instance_id'),str) or not raw['instance_id']:raise ValueError('Missing instance identity')
  result=classify(raw,entry['label'],programs)
  result.update(ok=True,workerSeconds=time.perf_counter()-started,bytes=len(data))
  return result
 except Exception as e:return {'ok':False,'errorType':type(e).__name__,'error':str(e)[:300],'cohort':entry.get('label'),'workerSeconds':time.perf_counter()-started}

def merge_usage(rows):
 result=collections.Counter()
 for row in rows:
  for key,value in row.items():
   if isinstance(value,(int,float)):result[key]+=value
 return dict(result)

def summarize(rows,programs):
 events=[e for row in rows for e in row['events']];denominator=merge_usage([row['usage'] for row in rows]);reports=[]
 for program in programs:
  exact=[e for e in events if e['program']==program and e['matchType']=='exact'];coverage=[e for e in events if e['program']==program and e['matchType']=='coverage_only']
  counts=collections.Counter({'proposals':0,'exactMatches':0,'coverageOnlyMatches':0,'overlapExcluded':0})
  for row in rows:counts.update(row['stats'][program])
  reports.append({'program':program,'title':PROGRAMS[program],**dict(counts),'matchedIssues':len({e['instance'] for e in exact}),'matchedUsage':u.sums(exact),'matchesWithReasoningOrProse':sum(e['reasoningOrProse'] for e in exact),'coverageOnly':{'matchedIssues':len({e['instance'] for e in coverage}),'matchedUsage':u.sums(coverage),'excludedFromExactUnion':True,'extraContextCostMeasured':False},'cohorts':{label:{'proposals':sum(row['stats'][program]['proposals'] for row in rows if row['cohort']==label),'matchedUsage':u.sums([e for e in exact if e['cohort']==label]),'coverageOnlyUsage':u.sums([e for e in coverage if e['cohort']==label])} for label in sorted({row['cohort'] for row in rows})}})
 selected,duplicates,chains=a.select_union([e for e in events if e['matchType']=='exact'])
 return {'reportedApiCalls':sum(row['reportedApiCalls'] for row in rows if type(row.get('reportedApiCalls')) is int),'trajectoriesWithReportedApiCalls':sum(type(row.get('reportedApiCalls')) is int for row in rows),'unrecordedResponseCount':sum(max(0,row['reportedApiCalls']-row['usage']['calls']) for row in rows if type(row.get('reportedApiCalls')) is int),'trajectoriesWithCounterMismatch':sum(row['reportedApiCalls']!=row['usage']['calls'] for row in rows if type(row.get('reportedApiCalls')) is int),'trajectories':len(rows),'uniqueIssues':len({row['instance'] for row in rows}),'denominator':denominator,'diagnostics':dict(sum((collections.Counter(row['diagnostics']) for row in rows),collections.Counter())),'candidates':reports,'union':{'matchedUsage':u.sums(selected),'matchedIssues':len({e['instance'] for e in selected}),'duplicateTargetsRemoved':duplicates,'dependentChainsExcluded':chains},'cohorts':{label:{'trajectories':sum(row['cohort']==label for row in rows),'usage':merge_usage([row['usage'] for row in rows if row['cohort']==label])} for label in sorted({row['cohort'] for row in rows})}}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest',required=True,type=pathlib.Path);p.add_argument('--cache',required=True,type=pathlib.Path);p.add_argument('--public',required=True,type=pathlib.Path);p.add_argument('--workers',type=int,default=4);p.add_argument('--limit',type=int);p.add_argument('--max-trace-mb',type=int,default=32);p.add_argument('--program',action='append',choices=PROGRAMS);p.add_argument('--no-cache',action='store_true');p.add_argument('--reference-manifest',type=pathlib.Path);args=p.parse_args()
 if not 1<=args.workers<=16 or not 1<=args.max_trace_mb<=128 or args.limit is not None and args.limit<1:p.error('Invalid limits')
 programs=sorted(set(args.program or PROGRAMS));started=time.perf_counter();manifest=json.loads(args.manifest.read_text());entries=[];seen=set()
 for entry in manifest['files']:
  if not entry['local'].endswith('.traj.json'):continue
  identity=(entry['label'],entry['sha256'])
  if identity in seen:continue
  seen.add(identity);entries.append(entry)
 if args.limit:entries=entries[:args.limit]
 ph,hashes=policy_hash(programs);args.cache.parent.mkdir(parents=True,exist_ok=True);db=sqlite3.connect(args.cache);os.chmod(args.cache,0o600)
 db.execute('CREATE TABLE IF NOT EXISTS results (key TEXT PRIMARY KEY, result TEXT NOT NULL)');db.commit()
 def key(entry):return hashlib.sha256((entry['label']+':'+entry['sha256']+':'+ph).encode()).hexdigest()
 rows=[];errors=[];queue=[];hits=0
 for entry in entries:
  cached=None if args.no_cache else db.execute('SELECT result FROM results WHERE key=?',(key(entry),)).fetchone()
  if cached:
   # Verify immutable source bytes even on cache hits; skip parsing/classification.
   try:
    path=pathlib.Path(entry['local'])
    if path.stat().st_size>args.max_trace_mb*1024*1024:raise ValueError('Trace exceeds configured byte bound')
    with path.open('rb') as stream:actual=hash_stream(stream)
    if actual!=entry['sha256']:raise ValueError('Cached source checksum mismatch')
    result=json.loads(cached[0]);rows.append(result);hits+=1
   except Exception as e:errors.append({'errorType':type(e).__name__,'error':str(e)[:300],'cohort':entry['label']})
  else:queue.append(entry)
 with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
  pending={};iterator=iter(queue)
  def fill():
   while len(pending)<args.workers*2:
    entry=next(iterator,None)
    if entry is None:break
    pending[pool.submit(work,(entry,programs,args.max_trace_mb*1024*1024))]=entry
  fill()
  while pending:
   done,_=concurrent.futures.wait(pending,return_when=concurrent.futures.FIRST_COMPLETED)
   for future in done:
    entry=pending.pop(future)
    try:result=future.result()
    except Exception as e:result={'ok':False,'errorType':type(e).__name__,'error':str(e)[:300],'cohort':entry['label']}
    if result['ok']:
     rows.append(result);db.execute('INSERT OR REPLACE INTO results VALUES (?,?)',(key(entry),json.dumps(result)));db.commit()
    else:errors.append(result)
    if (len(rows)+len(errors))%100==0:print(json.dumps({'processed':len(rows),'errors':len(errors),'cacheHits':hits,'total':len(entries)}),flush=True)
   fill()
 elapsed=time.perf_counter()-started;summary=summarize(rows,programs);calls=summary['denominator'].get('calls',0)
 report={'version':1,'kind':'offline-program-classifier-batch-replay','classifier':'Deterministic eligibility guards and argument planners; no model API or learned router invoked.','status':'complete' if not errors else 'complete-with-errors','requestedTrajectories':len(entries),'failedTrajectories':len(errors),'errorsByType':dict(collections.Counter(e['errorType'] for e in errors)),'sources':manifest.get('sources',[]),'sourceManifestSha256':hashlib.sha256(args.manifest.read_bytes()).hexdigest(),'policyHash':ph,'policySources':hashes,'performance':{'workers':args.workers,'wallSeconds':elapsed,'cacheHits':hits,'classifiedTrajectories':len(rows)-hits,'trajectoriesPerSecond':len(rows)/elapsed,'responsesPerSecond':calls/elapsed,'workerSecondsNewWork':sum(row.get('workerSeconds',0) for row in rows) if not hits else None},**summary,'limitations':['Frozen policies from the earlier100-trace discovery sample, which overlaps this larger corpus; this is not fully held-out validation.','Match means predicted next whole singleton response, not proof that reasoning or task quality can be preserved.','Recorded usage belongs to original calls; avoided usage is a conditional gross estimate. No routing/program/fallback cost or future cache effect is subtracted.','Cached input and reasoning are subsets; never add them again to total tokens.','Coverage-only search reads can add context and hit output caps; excluded from exact totals.','Execution requires opt-in and state/hash checks not reconstructable from historical traces. No deployment savings credited.','Only recognized bash-tool shapes are supported. Unsupported patterns abstain; parser errors are reported, not counted as zero-opportunity traces.','Source-reported costs are metadata, not our spending or independently verified invoices.','No source commands or scripts are executed, and no paid model requests are made.']}
 if args.reference_manifest:
  reference=json.loads(args.reference_manifest.read_text());known={entry['instanceId'] for entry in reference['files']}
  report['referenceComparison']={'referenceManifestSha256':hashlib.sha256(args.reference_manifest.read_bytes()).hexdigest(),'knownIssueCount':len(known),'previouslySampledIssues':summarize([row for row in rows if row['instance'] in known],programs),'otherIssues':summarize([row for row in rows if row['instance'] not in known],programs),'interpretation':'Issue-disjoint from the specified earlier sample, not a claim of untouched external validation.'}
 args.public.parent.mkdir(parents=True,exist_ok=True);args.public.write_text(json.dumps(report,indent=2)+'\n');db.close()
 print(json.dumps({'status':report['status'],'trajectories':len(rows),'calls':calls,'performance':report['performance'],'union':report['union'],'candidates':[{'program':x['program'],'proposals':x['proposals'],'matches':x['exactMatches'],'tokens':x['matchedUsage']['totalTokens'],'coverageCalls':x['coverageOnly']['matchedUsage']['calls']} for x in report['candidates']]},indent=2))
 if errors:raise SystemExit(2)
if __name__=='__main__':main()
