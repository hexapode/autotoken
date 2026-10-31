import importlib.util,json,pathlib,unittest
s=importlib.util.spec_from_file_location('candidate',pathlib.Path(__file__).with_name('candidate-empty-search-v5.py'));c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
EMPTY='<returncode>1</returncode>\n<output>\n</output>';OK='<returncode>0</returncode>\n<output>\npkg/other.py: def thing():\n</output>'
class Checks(unittest.TestCase):
 def test_fixed_parent_and_literal_query(self):
  p=c.plan('grep -n "def thing" pkg/a.py',EMPTY);self.assertEqual(p['argv'],['grep','-r','--','def thing','/testbed/pkg']);self.assertFalse(p['numbered'])
 def test_native_empty_only(self):
  for output in [EMPTY.replace('>1<','>0<'),EMPTY.replace('\n</output>','oops\n</output>'),EMPTY.replace('>1<','>2<')]:self.assertIsNone(c.plan('grep word pkg/a.py',output))
 def test_paths_and_root_scope(self):
  for path in ['a.py','../a.py','/etc/a.py','pkg/.secret.py','pkg/*.py']:
   self.assertIsNone(c.plan('grep word '+path,EMPTY))
 def test_unsupported_search_and_bundles(self):
  for cmd in ['rg word pkg/a.py','grep -i word pkg/a.py','grep "a.*b" pkg/a.py','grep word pkg/a.py | head','grep word pkg/a.py; true','grep word pkg/a.py pkg/b.py']:
   self.assertIsNone(c.plan(cmd,EMPTY))
 def test_canonical_cd_and_trailing_slash(self):
  p=c.plan('cd /testbed/pkg && grep -r word a.py\n',EMPTY);self.assertEqual(p['path'],'/testbed/pkg');self.assertEqual(c.parse('cd /testbed/pkg && grep -r word ./')['path'],p['path'])
 def test_single_fallback_and_output_bound(self):
  self.assertIsNone(c.plan('grep word pkg/a.py',EMPTY,1));self.assertFalse(c.observed_result(OK+'x'*16000));self.assertFalse(c.observed_result(OK.replace('def thing','output truncated')))
 def test_whole_call_and_recorded_usage(self):
  def a(i,cmd):return {'role':'assistant','tool_calls':[{'id':i,'function':{'name':'bash','arguments':json.dumps({'command':cmd})}}],'extra':{'response':{'usage':{'prompt_tokens':100,'completion_tokens':10}},'cost':.01}}
  raw={'instance_id':'a__b-1','messages':[a('s','grep -n "def thing" pkg/a.py'),{'role':'tool','tool_call_id':'s','content':EMPTY},a('t','grep -r "def thing" pkg/'),{'role':'tool','tool_call_id':'t','content':OK}]}
  es=c.analyze(raw,'test')[2];self.assertEqual(len(es),1);self.assertEqual(es[0]['usage']['totalTokens'],110)
  raw['messages'][2]['tool_calls'].append({'id':'extra','function':{'name':'bash','arguments':'{"command":"true"}'}});self.assertEqual(c.analyze(raw,'test')[2],[])
if __name__=='__main__':unittest.main()
