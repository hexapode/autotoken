"""Host-only public task/oracle preflight. Never reads the dataset gold patch."""
import argparse, collections, concurrent.futures, json, os, pathlib, re, subprocess, xml.etree.ElementTree as ET
import pyarrow.parquet as pq

def run(args,cwd,env=None,timeout=180):
 try:
  p=subprocess.run(args,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=timeout)
  return p.returncode,p.stdout
 except subprocess.TimeoutExpired:return 124,'TIMEOUT'

def main():
 p=argparse.ArgumentParser();p.add_argument('--parquet',required=True);p.add_argument('--sample',required=True);p.add_argument('--local-data',default='data');p.add_argument('--out',required=True);p.add_argument('--cache',required=True);p.add_argument('--python',required=True);p.add_argument('--repo',action='append',required=True);p.add_argument('--workers',type=int,default=4);a=p.parse_args()
 out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True);cache=pathlib.Path(a.cache);python=os.path.abspath(a.python)
 excluded_ids={json.loads(line)['instanceId'] for line in open(a.sample)};excluded_groups=set()
 for path in pathlib.Path(a.local_data).rglob('task.json'):
  try:
   t=json.loads(path.read_text());m=json.loads((path.parent/'manifest.json').read_text())
   if m.get('inference'):excluded_ids.add(t['instance_id'])
   # Conservative: exclude every already prepared repo/base including synthetic probes.
   if t.get('repo') and t.get('base_commit'):excluded_groups.add((t['repo'],t['base_commit']))
  except (ValueError,OSError,KeyError):pass
 # Gold `patch` and hints are deliberately not selected.
 cols=['instance_id','repo','base_commit','problem_statement','test_patch','FAIL_TO_PASS','created_at']
 rows=pq.read_table(a.parquet,columns=cols).to_pylist();candidates=[];seen=set()
 for r in rows:
  group=(r['repo'],r['base_commit']);ids=r['FAIL_TO_PASS']
  if r['repo'] not in a.repo or r['instance_id'] in excluded_ids or group in excluded_groups or group in seen:continue
  if not ids or not r['test_patch'] or any(not isinstance(n,str) or n.startswith('-') or ('[' in n and not n.endswith(']')) for n in ids):continue
  seen.add(group);candidates.append(r)
 candidates.sort(key=lambda r:(r['repo'],int(r['instance_id'].rsplit('-',1)[1])),reverse=True)
 def check(r):
  ident=r['instance_id'];d=out/ident;d.mkdir(exist_ok=False);repo=d/'checkout';source=cache/r['repo'].split('/')[-1]
  rec={'instanceId':ident,'repo':r['repo'],'base_commit':r['base_commit'],'state':'preparing'}
  try:
   code,log=run(['git','clone','--quiet','--shared',str(source),str(repo)],out);assert code==0,log
   code,log=run(['git','checkout','--quiet',r['base_commit']],repo);assert code==0,log
   env={**os.environ,'PYTHONPATH':str(repo),'PYTEST_DISABLE_PLUGIN_AUTOLOAD':'1'}
   tests='pyflakes/test' if r['repo']=='PyCQA/pyflakes' else 'tests'
   code,log=run([python,'-m','pytest','-q',tests,'--disable-warnings'],repo,env);(d/'baseline-suite.log').write_text(log);rec['suiteExit']=code
   if code:rec['state']='baseline_suite_failed';return rec
   oracle={'instance_id':ident,'test_patch':r['test_patch'],'FAIL_TO_PASS':r['FAIL_TO_PASS']}
   (d/'oracle.json').write_text(json.dumps(oracle,indent=2));(d/'test.patch').write_text(r['test_patch'])
   code,log=run(['git','apply','--check',str(d/'test.patch')],repo);assert code==0,log
   code,log=run(['git','apply',str(d/'test.patch')],repo);assert code==0,log
   xml=d/'baseline-oracle.xml';code,log=run([python,'-m','pytest','-q','--disable-warnings',f'--junitxml={xml}',*r['FAIL_TO_PASS']],repo,env);(d/'baseline-oracle.log').write_text(log);rec['oracleExit']=code
   cases=list(ET.parse(xml).iter('testcase')) if xml.exists() else [];failures=[c.find('failure') for c in cases if c.find('failure') is not None]
   good=code==1 and len(cases)==len(r['FAIL_TO_PASS']) and len(failures)==len(cases) and all(c.find('error') is None and c.find('skipped') is None for c in cases) and all(re.match(r'(?:AssertionError\b|assert\b|Failed: DID NOT RAISE\b)',f.get('message','').strip()) for f in failures)
   rec['oracleCases']=len(cases);rec['assertionFailures']=len(failures);rec['state']='eligible' if good else 'oracle_not_clean_assertion_failure'
   if good:
    task={k:r[k] for k in ['instance_id','repo','base_commit','problem_statement']};task.update(dataset='nebius/SWE-bench-extra',revision='11dcbfb30e19552df2a2f8030bd764adc95c92a5',split='train')
    (d/'public-task.json').write_text(json.dumps(task,indent=2));rec['publicTask']=str(d/'public-task.json');rec['oracle']=str(d/'oracle.json')
  except Exception as e:rec['state']='preparation_failed';rec['error']=str(e)[:500]
  finally:(d/'preflight.json').write_text(json.dumps(rec,indent=2))
  return rec
 result=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
  for r in pool.map(check,candidates):result.append(r);print(r['instanceId'],r['state'],flush=True)
 report={'goldPatchRead':False,'candidateCount':len(candidates),'profiles':{'python':python,'packages':['pytest==7.4.4','tokenize-rt==5.2.0','setuptools==68.2.2','wheel==0.42.0'],'pluginAutoload':False},'summary':dict(collections.Counter(r['state'] for r in result)),'records':result}
 (out/'report.json').write_text(json.dumps(report,indent=2));(out/'eligible-tasks.json').write_text(json.dumps([json.load(open(r['publicTask'])) for r in result if r['state']=='eligible'],indent=2));print(json.dumps(report['summary']))
if __name__=='__main__':main()
