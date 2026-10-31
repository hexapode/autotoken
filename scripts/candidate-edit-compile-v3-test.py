import importlib.util,pathlib,unittest,json
s=importlib.util.spec_from_file_location('candidate',pathlib.Path(__file__).with_name('candidate-edit-compile-v3.py'));c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
OK='<returncode>0</returncode>\n<output>\n</output>'
EDIT="cd /testbed && python - <<'PY'\nfrom pathlib import Path\np = Path('app/core.py')\ns = p.read_text()\np.write_text(s.replace('old', 'new'))\nPY"
class Checks(unittest.TestCase):
 def test_literal_edit_derives_target(self):self.assertEqual(c.plan(EDIT,OK)['argv'],['python','-m','py_compile','/testbed/app/core.py'])
 def test_failed_edit_refused(self):self.assertIsNone(c.plan(EDIT,OK.replace('>0<','>1<')))
 def test_nonliteral_and_multiple_writes_refused(self):
  self.assertIsNone(c.plan(EDIT.replace("Path('app/core.py')","Path(target)"),OK));self.assertIsNone(c.plan(EDIT.replace("\nPY","\np.write_text('more')\nPY"),OK))
 def test_tests_and_escape_refused(self):
  for path in ['tests/test_a.py','../app/a.py','/tmp/app.py']:
   self.assertIsNone(c.plan(EDIT.replace('app/core.py',path),OK))
 def test_fixed_command_matching(self):
  self.assertEqual(c.parse_check('cd /testbed && python -m py_compile app/core.py'),{'cwd':'/testbed','argv':['python','-m','py_compile','/testbed/app/core.py']})
  for command in ['python3 -m py_compile app/core.py','python -m compileall -q app/core.py','python -m py_compile app/core.py 2>&1','python -m py_compile app/core.py && git status','PYTHONPATH=lib python -m py_compile app/core.py']:self.assertIsNone(c.parse_check(command))
 def test_whole_response_usage_and_multitool(self):
  def assistant(i,cmd):return {'role':'assistant','tool_calls':[{'id':i,'function':{'name':'bash','arguments':json.dumps({'command':cmd})}}],'extra':{'response':{'usage':{'prompt_tokens':100,'completion_tokens':20}},'cost':.01}}
  raw={'instance_id':'example__repo-1','messages':[assistant('a',EDIT),{'role':'tool','tool_call_id':'a','content':OK},assistant('b','python -m py_compile app/core.py'),{'role':'tool','tool_call_id':'b','content':OK}]}
  ts,ps,es,ds=c.analyze(raw,'model');self.assertEqual(len(es),1);self.assertEqual(es[0]['usage']['totalTokens'],120)
  raw['messages'][2]['tool_calls'].append({'id':'c','function':{'name':'bash','arguments':'{"command":"true"}'}});self.assertEqual(len(c.analyze(raw,'model')[2]),0)
if __name__=='__main__':unittest.main()
