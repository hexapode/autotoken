import importlib.util,json,pathlib,unittest
s=importlib.util.spec_from_file_location('candidate',pathlib.Path(__file__).with_name('candidate-path-repair-v5.py'));c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
def output(text,code=0):return f'<returncode>{code}</returncode>\n<output>\n{text}\n</output>'
def turn(command,result,ordinal=0):return {'ordinal':ordinal,'actions':[{'name':'bash','command':command,'results':[result]}]}
class Checks(unittest.TestCase):
 def test_unique_known_read_repairs_without_future(self):
  h=[turn('cat lib/a.py',output('x'))];now=turn('cat a.py',output('cat: a.py: No such file or directory',1))
  self.assertEqual(c.plan(h,now)['argv'],['cat','/testbed/lib/a.py'])
 def test_ambiguous_unknown_and_retry_abstain(self):
  now=turn('cat a.py',output('cat: a.py: No such file or directory',1));h=[turn('cat x/a.py',output('x')),turn('cat y/a.py',output('y'))]
  self.assertIsNone(c.plan(h,now));self.assertIsNone(c.plan([],now));self.assertIsNone(c.plan(h[:1],now,1))
 def test_pure_find_listing_and_operation_preserved(self):
  h=[turn("find . -type f -name 'a.py'",output('./lib/a.py'))];now=turn("sed -n '3,8p' a.py",output("sed: can't read a.py: No such file or directory",2))
  self.assertEqual(c.plan(h,now)['argv'],['sed','-n','3,8p','/testbed/lib/a.py'])
 def test_failure_must_name_requested_path(self):
  now=turn('cat a.py',output('cat: b.py: No such file or directory',1));self.assertIsNone(c.plan([turn('cat x/a.py',output('x'))],now))
 def test_bundles_traversal_and_unregistered_paths_reject(self):
  for cmd in ['cat ../a.py','cat /etc/a.py','cat a.py | head -10','cat a.py; true','cat .env','head -1000 a.py','sed -n 1,1000p a.py']:self.assertIsNone(c.parse_read(cmd))
 def test_history_horizon_and_truncated_outputs(self):
  h=[turn('cat x/a.py',output('x'))]+[turn('true',output(''))]*12
  self.assertEqual(c.known_paths(h),set());self.assertIsNone(c.output(output('output truncated')))
 def test_whole_response_usage_and_multitool_exclusion(self):
  def assistant(i,cmd):return {'role':'assistant','tool_calls':[{'id':i,'function':{'name':'bash','arguments':json.dumps({'command':cmd})}}],'extra':{'response':{'usage':{'prompt_tokens':100,'completion_tokens':20}},'cost':0.01}}
  msgs=[]
  for i,(cmd,res) in enumerate([('cat lib/a.py',output('x')),('cat a.py',output('cat: a.py: No such file or directory',1)),('cat /testbed/lib/a.py',output('x'))]):msgs.extend([assistant(str(i),cmd),{'role':'tool','tool_call_id':str(i),'content':res}])
  raw={'instance_id':'example__repo-1','messages':msgs};ts,ps,es,d=c.analyze(raw,'fixture');self.assertEqual(len(es),1);self.assertEqual(es[0]['usage']['totalTokens'],120)
  msgs[4]['tool_calls'].append({'id':'extra','function':{'name':'bash','arguments':'{"command":"true"}'}});self.assertEqual(c.analyze(raw,'fixture')[2],[])
if __name__=='__main__':unittest.main()
