import importlib.util,pathlib,unittest,json
s=importlib.util.spec_from_file_location('w',pathlib.Path(__file__).with_name('workflow-investigate-v6.py'));w=importlib.util.module_from_spec(s);s.loader.exec_module(w)
def obs(s):return '<returncode>0</returncode>\n<output>\n'+s+'\n</output>'
class Tests(unittest.TestCase):
 def test_unique_definition(self):
  p=w.start('grep -n "def foo" x.py',obs('99:def foo():'));self.assertEqual((p['start'],p['end']),(99,100))
 def test_multiple_abstain(self):self.assertIsNone(w.start('grep -n "def foo" x.py',obs('99:def foo():\n100:def bar():')))
 def test_non_definition_abstain(self):self.assertIsNone(w.start('grep -n "foo" x.py',obs('99:foo = 1')))
 def test_incomplete_string(self):
  p=w.start('grep -n "def foo" x.py',obs('99:def foo():'));q=w.advance(p,"sed -n '99,100p' x.py",obs('def foo():\n    """unfinished'));self.assertEqual((q['start'],q['end'],q['step']),(100,200,2));self.assertIsNone(w.advance(q,"sed -n '100,200p' x.py",obs('x')))
 def test_indent_not_proof(self):
  p=w.start('grep -n "def foo" x.py',obs('99:def foo():'));self.assertIsNone(w.advance(p,"sed -n '99,100p' x.py",obs('def foo():\n    pass')))
 def test_short_read_abstain(self):
  p=w.start('grep -n "def foo" x.py',obs('99:def foo():'));self.assertIsNone(w.advance(p,"sed -n '99,100p' x.py",obs('"""unfinished')))
 def test_unplanned_read_abstain(self):
  p=w.start('grep -n "def foo" x.py',obs('99:def foo():'));self.assertIsNone(w.advance(p,"sed -n '98,100p' x.py",obs('def foo():\n    """unfinished')))
 def test_complete_chain_and_dependency(self):
  def call(i,cmd):return {'role':'assistant','tool_calls':[{'id':i,'function':{'name':'bash','arguments':json.dumps({'command':cmd})}}],'extra':{'response':{'usage':{'prompt_tokens':100,'completion_tokens':10}},'cost':.01}}
  messages=[]
  for i,cmd,result in [('s','grep -n "def foo" x.py','99:def foo():'),('r',"sed -n '99,100p' x.py",'def foo():\n    """unfinished'),('c',"sed -n '100,200p' x.py",'    """unfinished\n    done"""')]:
   messages.extend([call(i,cmd),{'role':'tool','tool_call_id':i,'content':obs(result)}])
  raw={'instance_id':'fixture__fixture-1','messages':messages};ts,ps,es,ds=w.analyze(raw,'fixture')
  self.assertEqual(ds['completeSequences'],1);self.assertEqual(len(es),2);self.assertEqual(es[1]['dependencyTargetOrdinal'],es[0]['targetOrdinal']);self.assertTrue(all(e['completeSequence']for e in es));self.assertEqual(sum(e['usage']['totalTokens']for e in es),220)
  messages[2]['tool_calls'].append({'id':'extra','function':{'name':'bash','arguments':'{"command":"true"}'}})
  self.assertEqual(w.analyze(raw,'fixture')[2],[])
if __name__=='__main__':unittest.main()
