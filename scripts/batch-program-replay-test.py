import hashlib,importlib.util,json,pathlib,tempfile,unittest,subprocess,sys
p=pathlib.Path(__file__).with_name('batch-program-replay.py');s=importlib.util.spec_from_file_location('batch',p);b=importlib.util.module_from_spec(s);s.loader.exec_module(b)
OK='<returncode>0</returncode>\n<output>\n</output>'
def assistant(i,cmd):return {'role':'assistant','tool_calls':[{'id':i,'function':{'name':'bash','arguments':json.dumps({'command':cmd})}}],'extra':{'response':{'usage':{'prompt_tokens':100,'completion_tokens':20,'prompt_tokens_details':{'cached_tokens':80}}},'cost':0.1}}
def fixture():return {'instance_id':'example__repo-1','info':{'model_stats':{'api_calls':3}},'messages':[assistant('a',"cat > a.py <<'EOF'\nprint(1)\nEOF"),{'role':'tool','tool_call_id':'a','content':OK},assistant('b','python a.py'),{'role':'tool','tool_call_id':'b','content':OK}]}
class Checks(unittest.TestCase):
 def test_actual_usage_and_missing_response_counter(self):
  row=b.classify(fixture(),'model',list(b.PROGRAMS));report=b.summarize([row],list(b.PROGRAMS))
  self.assertEqual(report['union']['matchedUsage']['totalTokens'],120);self.assertEqual(report['denominator']['totalTokens'],240);self.assertEqual(report['unrecordedResponseCount'],1)
  self.assertEqual(row['stats']['write_then_run_v2']['exactMatches'],1)
 def test_multitool_response_does_not_become_two_calls(self):
  raw=fixture();raw['messages'][2]['tool_calls'].append({'id':'c','function':{'name':'bash','arguments':'{"command":"true"}'}})
  result=b.classify(raw,'model',list(b.PROGRAMS));self.assertEqual(result['usage']['calls'],2);self.assertEqual(result['events'],[])
 def test_corrupted_source_rejected_not_zero_opportunities(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'x.traj.json';p.write_text(json.dumps(fixture()))
   result=b.work(({'local':str(p),'sha256':'0'*64,'label':'model'},list(b.PROGRAMS),100000))
   self.assertFalse(result['ok']);self.assertEqual(result['errorType'],'ValueError')
 def test_trace_size_bound(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'x.traj.json';data=json.dumps(fixture()).encode();p.write_bytes(data)
   result=b.work(({'local':str(p),'sha256':hashlib.sha256(data).hexdigest(),'label':'model'},list(b.PROGRAMS),2));self.assertFalse(result['ok'])
 def test_program_selection_changes_cache_fingerprint(self):
  self.assertNotEqual(b.policy_hash(['write_then_run_v2'])[0],b.policy_hash(list(b.PROGRAMS))[0])
 def test_failed_last_write_is_not_a_proposal(self):
  raw=fixture();raw['messages']=raw['messages'][:2];raw['messages'][1]['content']=OK.replace('>0<','>1<')
  row=b.classify(raw,'model',list(b.PROGRAMS));self.assertEqual(row['stats']['write_then_run_v2']['proposals'],0)
 def test_new_plugin_can_run_alone(self):
  raw=fixture();raw['messages'][0]=assistant('a','python -m py_compile a.py');raw['messages'][2]=assistant('b','git status --porcelain')
  row=b.classify(raw,'model',['syntax_check_status_v3']);self.assertEqual(row['stats']['syntax_check_status_v3']['exactMatches'],1);self.assertEqual(len(row['stats']),1);self.assertEqual(row['events'][0]['usage']['totalTokens'],120)
 def test_resume_cache_and_tampered_cached_source(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);trace=root/'one.traj.json';trace.write_text(json.dumps(fixture()))
   manifest=root/'manifest.json';manifest.write_text(json.dumps({'files':[{'local':str(trace),'label':'fixture','sha256':hashlib.sha256(trace.read_bytes()).hexdigest()}]}))
   out=root/'report.json';cmd=[sys.executable,str(p),'--manifest',str(manifest),'--cache',str(root/'cache.sqlite'),'--public',str(out),'--workers','1']
   first=subprocess.run(cmd,capture_output=True);self.assertEqual(first.returncode,0,first.stderr.decode());self.assertEqual(json.loads(out.read_text())['performance']['cacheHits'],0)
   second=subprocess.run(cmd,capture_output=True);self.assertEqual(second.returncode,0,second.stderr.decode());self.assertEqual(json.loads(out.read_text())['performance']['cacheHits'],1)
   trace.write_text('{}');third=subprocess.run(cmd,capture_output=True);self.assertEqual(third.returncode,2);self.assertEqual(json.loads(out.read_text())['failedTrajectories'],1)
if __name__=='__main__':unittest.main()
