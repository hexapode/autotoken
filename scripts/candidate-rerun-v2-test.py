import importlib.util,pathlib,unittest
s=importlib.util.spec_from_file_location('candidate',pathlib.Path(__file__).with_name('candidate-rerun-v2.py'));c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
OK='<returncode>0</returncode>\n<output>\n</output>';BAD='<returncode>1</returncode>\n<output>\nfailed\n</output>'
def turn(cmd,result=OK,i=0):return {'ordinal':i,'actions':[{'name':'bash','command':cmd,'results':[result]}]}
EDIT="sed -i 's/old/new/' /testbed/pkg/source.py"
class Tests(unittest.TestCase):
 def test_successful_prior_test(self):
  p=c.plan([turn('python /testbed/test_bug.py')],turn(EDIT,i=1));self.assertEqual(p['argv'],['python','/testbed/test_bug.py']);self.assertTrue(p['requiresRegisteredTestAndEnvironment'])
 def test_failure_invalidates(self):self.assertIsNone(c.plan([turn('python test_bug.py'),turn('python test_bug.py',BAD,1)],turn(EDIT,i=2)))
 def test_expiry(self):self.assertIsNone(c.plan([turn('pytest tests/test_bug.py')]+[turn('pwd',i=i+1) for i in range(12)],turn(EDIT,i=13)))
 def test_refuse_test_edit_failure_and_mixed(self):
  for t in [turn("sed -i 's/a/b/' /testbed/tests/test_bug.py"),turn(EDIT,BAD),{'ordinal':1,'actions':turn(EDIT)['actions']*2}]:self.assertIsNone(c.plan([turn('python test_bug.py')],t))
 def test_python_source_detector(self):
  cmd="cd /testbed && python - <<'PY'\nfrom pathlib import Path\np = Path('pkg/source.py')\ns = p.read_text()\np.write_text(s.replace('a','b'))\nPY"
  self.assertEqual(c.edited_source(cmd),'/testbed/pkg/source.py');self.assertIsNone(c.edited_source(cmd.replace('p.write_text','exec')))
 def test_registered_inline_exact_hash(self):
  cmd="python - <<'PY'\nassert 1 == 1\nPY";self.assertTrue(c.test_command(cmd)['requiresScriptHashRegistration']);self.assertNotEqual(c.test_command(cmd)['argv'],c.test_command(cmd.replace('1 == 1','2 == 2'))['argv'])
 def test_command_refusals(self):
  for cmd in ['python x.py','pytest','pytest tests/test_a.py; rm -rf /','pytest ../tests','python /tmp/test_a.py && echo x','python -c "assert True"']:self.assertIsNone(c.test_command(cmd))
  self.assertIsNotNone(c.test_command('python /tmp/test_a.py'));self.assertIsNotNone(c.test_command('cd /testbed && python -m pytest -q tests/test_a.py::test_x'))
 def test_plan_independent_future(self):
  history=[turn('python test_a.py')];current=turn(EDIT,i=1);self.assertEqual(c.plan(history,current),c.plan(history,current));self.assertIsNone(c.plan([],current))
if __name__=='__main__':unittest.main()
