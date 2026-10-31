import importlib.util,json,pathlib,unittest
s=importlib.util.spec_from_file_location('candidate',pathlib.Path(__file__).with_name('candidate-pytest-repair-v5.py'));c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
MISSING='<returncode>127</returncode>\n<output>\nbash: line 1: pytest: command not found\n</output>'
OK='<returncode>0</returncode>\n<output>\n1 passed\n</output>'
class Checks(unittest.TestCase):
 def test_missing_executable_preserves_args_cwd(self):
  p=c.plan('cd /testbed && pytest -q tests/test_a.py::TestA::test_x',MISSING)
  self.assertEqual(p['argv'],['python3','-m','pytest','-q','/testbed/tests/test_a.py::TestA::test_x']);self.assertEqual(p['cwd'],'/testbed')
 def test_exact_error_and_retry_limit(self):
  for text in [MISSING.replace('127','1'),MISSING.replace('pytest:','python:')]:self.assertIsNone(c.plan('pytest tests/test_a.py',text))
  self.assertIsNone(c.plan('pytest tests/test_a.py',MISSING,1))
 def test_no_shell_or_setup(self):
  for cmd in ['pytest tests/test_a.py | tail -30','pip install pytest && pytest tests/test_a.py','PYTHONPATH=src pytest tests/test_a.py','pytest tests/test_a.py; true','pytest tests/test_a.py > log','pytest tests/test_a.py\necho ok']:
   self.assertIsNone(c.plan(cmd,MISSING))
 def test_paths_and_options_bound(self):
  for cmd in ['pytest ../tests/test_a.py','pytest /etc/test_a.py','pytest -n 4 tests/test_a.py','pytest --version','pytest .hidden/test_a.py','pytest tests/test_a.py[weird]']:
   self.assertIsNone(c.plan(cmd,MISSING))
 def test_interpreter_not_guessed(self):
  self.assertIsNone(c.parse('python -m pytest tests/test_a.py',True))
  self.assertEqual(c.parse('python3 -m pytest ./tests/test_a.py',True),c.parse('pytest tests/test_a.py'))
 def test_unavailable_module_not_credited(self):
  self.assertFalse(c.observed_retry('<returncode>1</returncode>\n<output>\npython3: No module named pytest\n</output>'))
  self.assertTrue(c.observed_retry(OK.replace('>0<','>1<')))
 def test_whole_response_usage_and_multitool_exclusion(self):
  def assistant(i,command):return {'role':'assistant','tool_calls':[{'id':i,'function':{'name':'bash','arguments':json.dumps({'command':command})}}],'extra':{'response':{'usage':{'prompt_tokens':100,'completion_tokens':20}},'cost':.1}}
  raw={'instance_id':'example__repo-1','messages':[assistant('a','pytest -q tests/test_a.py'),{'role':'tool','tool_call_id':'a','content':MISSING},assistant('b','python3 -m pytest -q tests/test_a.py'),{'role':'tool','tool_call_id':'b','content':OK}]}
  ts,ps,es,ds=c.analyze(raw,'fixture');self.assertEqual(len(es),1);self.assertEqual(es[0]['usage']['totalTokens'],120)
  raw['messages'][2]['tool_calls'].append({'id':'c','function':{'name':'bash','arguments':'{"command":"true"}'}})
  self.assertEqual(len(c.analyze(raw,'fixture')[2]),0)
if __name__=='__main__':unittest.main()
