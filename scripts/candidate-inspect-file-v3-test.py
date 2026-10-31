import importlib.util,pathlib,unittest,json
s=importlib.util.spec_from_file_location('candidate',pathlib.Path(__file__).with_name('candidate-inspect-file-v3.py'));c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
def obs(text,code=0):return '<returncode>'+str(code)+'</returncode>\n<output>\n'+text+'\n</output>'
class Checks(unittest.TestCase):
 def test_unique_find_and_explicit_runtime_bounds(self):
  p=c.plan('find . -type f -name "one.py"',obs('./pkg/one.py'));self.assertEqual(p['path'],'/testbed/pkg/one.py');self.assertTrue(p['requiresRuntimeBoundCheck']);self.assertEqual(p['maxBytes'],16384)
 def test_head_limit_must_not_hide_second_path(self):
  self.assertIsNone(c.plan('find . -name "one.py" | head -1',obs('./one.py')))
  self.assertIsNotNone(c.plan('find . -name "one.py" | head -5',obs('./one.py')))
 def test_ambiguous_path_and_unsafe_paths_refused(self):
  for output in ['./a.py\n./b.py','../secret.py','/etc/passwd','./.key']:
   self.assertIsNone(c.plan('find . -name "*.py"',obs(output)))
 def test_search_shapes(self):
  self.assertEqual(c.plan('grep -rl "pattern" pkg',obs('pkg/a.py'))['path'],'/testbed/pkg/a.py')
  self.assertEqual(c.plan('rg -n "pattern" pkg/a.py',obs('5:pattern'))['path'],'/testbed/pkg/a.py')
 def test_execution_and_filtering_refused(self):
  for cmd in ['find . -name a.py -exec cat {} ;','find . -name a.py | grep a','find . -name a.py && cat a.py','find . -name $(pwd)']:
   self.assertIsNone(c.plan(cmd,obs('a.py')))
 def test_exact_cat_and_eof_equivalence_separate(self):
  p=c.plan('find . -name a.py',obs('a.py'))
  self.assertEqual(c.classify(p,'cat a.py',obs('x')),'exact')
  self.assertEqual(c.classify(p,"sed -n '1,200p' a.py",obs('x')),'equivalent_eof')
  self.assertIsNone(c.classify(p,'head -1 a.py',obs('x')))
 def test_size_lines_failed_and_truncated_reads_refused(self):
  p=c.plan('find . -name a.py',obs('a.py'))
  for output in [obs('x'*16384),obs('\n'.join(['x']*251)),obs('x',1),obs('output truncated')]:self.assertIsNone(c.classify(p,'cat a.py',output))
 def test_singleton_whole_call_and_usage(self):
  def assistant(i,cmd):return {'role':'assistant','tool_calls':[{'id':i,'function':{'name':'bash','arguments':json.dumps({'command':cmd})}}],'extra':{'response':{'usage':{'prompt_tokens':20,'completion_tokens':3}},'cost':0.1}}
  target=assistant('b','cat a.py');raw={'instance_id':'fixture__repo-1','messages':[assistant('a','find . -name a.py'),{'tool_call_id':'a','content':obs('a.py')},target,{'tool_call_id':'b','content':obs('x')}]}
  self.assertEqual(c.analyze(raw,'fixture')[2][0]['usage']['totalTokens'],23)
  target['tool_calls'].append({'id':'c','function':{'name':'bash','arguments':'{}'}});self.assertEqual(c.analyze(raw,'fixture')[2],[])
if __name__=='__main__':unittest.main()
