import importlib.util,pathlib,unittest,json
s=importlib.util.spec_from_file_location('candidate',pathlib.Path(__file__).with_name('candidate-traceback-context-v4.py'));c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
def obs(body):return '<returncode>1</returncode>\n<output>\nTraceback (most recent call last):\n'+body+'\n</output>'
GOOD=obs('  File "/testbed/a.py", line 30, in f\n    x()\n  File "/testbed/pkg/b.py", line 100, in g\n    bad()\nValueError: bad')
class Checks(unittest.TestCase):
 def test_deepest_source_and_fixed_window(self):
  p=c.plan('python repro.py',GOOD);self.assertEqual((p['path'],p['start'],p['end']),('/testbed/pkg/b.py',50,150))
 def test_root_bound_and_near_start(self):
  p=c.plan('cd /testbed && python3 -m test',obs('  File "/testbed/a.py", line 2, in f\nValueError: x'));self.assertEqual(p['start'],1)
  for path in ['/etc/a.py','/testbed/../a.py','/testbed/.venv/a.py','/testbed/test_a.py','/testbed/tests/a.py','/testbed/repro.py']:
   self.assertIsNone(c.plan('python x',obs('  File "'+path+'", line 2, in f\nValueError: x')))
 def test_import_setup_and_multiple_tracebacks_abstain(self):
  for extra in ['ImportError: bad','ModuleNotFoundError: bad','ERROR collecting','ERROR at setup','Traceback (most recent call last):']:
   self.assertIsNone(c.plan('python x',GOOD.replace('ValueError: bad',extra)))
 def test_failure_command_and_observation_caps(self):
  self.assertIsNone(c.plan('echo fake',GOOD));self.assertIsNone(c.plan('python x',GOOD.replace('>1<','>0<')));self.assertIsNone(c.plan('python x',GOOD+'x'*65536))
 def test_exact_coverage_distinction(self):
  p=c.plan('python x',GOOD);r={'path':p['path'],'start':50,'end':150,'bytes':10,'catToEOF':False};self.assertEqual(c.reader.classify(p,r),'exact');self.assertEqual(c.reader.classify(p,{**r,'start':80,'end':120}),'coverage_only');self.assertIsNone(c.reader.classify(p,{**r,'start':1}))
 def test_full_singleton_response_accounting(self):
  def a(i,cmd):return {'role':'assistant','tool_calls':[{'id':i,'function':{'name':'bash','arguments':json.dumps({'command':cmd})}}],'extra':{'response':{'usage':{'prompt_tokens':100,'completion_tokens':20}},'cost':0.01}}
  raw={'instance_id':'sample__repo-1','messages':[a('a','python x'),{'role':'tool','tool_call_id':'a','content':GOOD},a('b',"sed -n '50,150p' pkg/b.py"),{'role':'tool','tool_call_id':'b','content':'<returncode>0</returncode>\n<output>\nline\n</output>'}]}
  es=c.analyze(raw,'fixture')[2];self.assertEqual(len(es),1);self.assertEqual(es[0]['usage']['totalTokens'],120)
  raw['messages'][2]['tool_calls'].append({'id':'c','function':{'name':'bash','arguments':'{}'}});self.assertEqual(c.analyze(raw,'fixture')[2],[])
if __name__=='__main__':unittest.main()
