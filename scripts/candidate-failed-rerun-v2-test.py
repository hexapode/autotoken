import importlib.util,pathlib,unittest
s=importlib.util.spec_from_file_location('candidate',pathlib.Path(__file__).with_name('candidate-failed-rerun-v2.py'));c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
def result(text,code=1):return f'<returncode>{code}</returncode>\n<output>\n{text}\n</output>'
def turn(cmd,text='',code=0,i=0):return {'ordinal':i,'actions':[{'name':'bash','command':cmd,'results':[result(text,code)]}]}
EDIT="sed -i 's/old/new/' /testbed/pkg/source.py"
class Tests(unittest.TestCase):
 def test_plain_assertion(self):self.assertTrue(c.assertion_failure(result('Traceback...\nAssertionError: expected value')))
 def test_pytest_assertion(self):self.assertTrue(c.assertion_failure(result('E       assert 1 == 2')))
 def test_infrastructure_refused(self):
  for text in ['ImportError: missing\nAssertionError','ModuleNotFoundError: pkg','ERROR collecting test_x\nE       assert False','ERROR at setup test_x\nAssertionError']:self.assertFalse(c.assertion_failure(result(text)))
 def test_nonassertions_and_exit(self):
  for text,code in [('KeyError: x',1),('AssertionError',0),('AssertionError',2)]:self.assertFalse(c.assertion_failure(result(text,code)))
 def test_plan_requires_failed_assertion_and_current_success(self):
  h=[turn('python test_bug.py','AssertionError: bug',1)]
  self.assertEqual(c.plan(h,turn(EDIT,i=1))['argv'],['python','test_bug.py']);self.assertIsNone(c.plan(h,turn(EDIT,'failed',1,1)));self.assertIsNone(c.plan([turn('python test_bug.py')],turn(EDIT,i=1)))
if __name__=='__main__':unittest.main()
