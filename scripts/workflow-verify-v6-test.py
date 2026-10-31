import importlib.util,json,pathlib,unittest
spec=importlib.util.spec_from_file_location('verify_v6',pathlib.Path(__file__).with_name('workflow-verify-v6.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def output(code=0,text=''):return f'<returncode>{code}</returncode>\n<output>\n{text}\n</output>'
TEST={'cwd':'/testbed','argv':['pytest','tests/test_module.py','-q']};H='a'*64;S='b'*64
EDIT="sed -i 's/old/new/' src/module.py";COMPILE='python -m py_compile src/module.py'
def raw(actions):
 messages=[]
 for i,(cmd,result) in enumerate(actions):
  messages.append({'role':'assistant','content':'Reasoning matters.','tool_calls':[{'id':str(i),'function':{'name':'bash','arguments':json.dumps({'command':cmd})}}],'extra':{'response':{'usage':{'prompt_tokens':100,'completion_tokens':10}},'cost':.01}})
  if result is not None:messages.append({'role':'tool','tool_call_id':str(i),'content':result})
 return {'instance_id':'fixture','messages':messages}
def workflow():return m.VerificationWorkflow(TEST,explicit_opt_in=True,environment_id='env1',test_hash=H)
def edit(w,**kw):return w.on_edit('/testbed/src/module.py',edit_result=output(),cwd='/testbed',source_hash=S,tree_epoch='epoch',environment_id='env1',test_hash=H,**kw)
def guards(**kw):return {**dict(cwd='/testbed',source_hash=S,test_hash=H,tree_epoch='epoch',environment_id='env1'),**kw}
class Checks(unittest.TestCase):
 def test_actual_state_machine(self):
  w=workflow();self.assertEqual(edit(w)['step'],'compile');self.assertEqual(w.observe_compile(output(),**guards())['argv'],TEST['argv']);self.assertEqual(w.observe_test(output()),'passed');self.assertIsNone(w.observe_compile(output(),**guards()))
 def test_no_optin_no_registration(self):
  with self.assertRaises(ValueError):m.VerificationWorkflow(TEST,explicit_opt_in=False,environment_id='env1',test_hash=H)
  with self.assertRaises(ValueError):m.VerificationWorkflow(TEST,explicit_opt_in=True,environment_id='env1',test_hash=None)
 def test_source_test_environment_and_cwd_guards(self):
  for override in [{'source_hash':'c'*64},{'test_hash':'d'*64},{'environment_id':'env2'},{'cwd':'/testbed/subdir'},{'tree_epoch':'changed'}]:
   w=workflow();edit(w);self.assertIsNone(w.observe_compile(output(),**guards(**override)));self.assertEqual(w.state,'abstained')
 def test_compile_fail_or_truncation_stops(self):
  for result in [output(1,'SyntaxError'),output(0,'output truncated'),output(0,'x'*17000)]:
   w=workflow();edit(w);self.assertIsNone(w.observe_compile(result,**guards()))
 def test_replay_complete_chain(self):
  ts,ps,es,d=m.analyze(raw([('pytest tests/test_module.py -q',output()),(EDIT,output()),(COMPILE,output()),('pytest tests/test_module.py -q',output(1,'regression fails'))]),'fixture')
  self.assertEqual(len(ps),2);self.assertEqual(len(es),2);self.assertTrue(all(e['completeChain'] for e in es));self.assertTrue(es[0]['overlapsExistingEditCompileCandidate']);self.assertFalse(es[1]['overlapsExistingEditCompileCandidate']);self.assertEqual(es[1]['testExitCode'],1)
 def test_no_guessed_unsolicited_step_credit(self):
  _,ps,es,d=m.analyze(raw([('pytest tests/test_module.py -q',output()),(EDIT,output()),('pytest tests/test_module.py -q',output())]),'fixture');self.assertEqual(len(ps),1);self.assertFalse(es)
 def test_compile_failure_no_second_proposal(self):
  _,ps,es,d=m.analyze(raw([('pytest tests/test_module.py -q',output()),(EDIT,output()),(COMPILE,output(1)),('pytest tests/test_module.py -q',output())]),'fixture');self.assertEqual(len(ps),1);self.assertEqual(len(es),1)
 def test_newer_failed_test_clears_registration(self):
  _,ps,es,d=m.analyze(raw([('pytest tests/test_module.py -q',output()),('pytest tests/test_module.py -q',output(1)),(EDIT,output()),(COMPILE,output())]),'fixture');self.assertFalse(ps)
 def test_focused_only_and_no_bundle(self):
  self.assertIsNone(m.focused_test('pytest tests -q'));self.assertIsNone(m.compile_command(COMPILE+' && pytest tests/test_module.py'))
 def test_runtime_failed_edit(self):
  w=workflow();self.assertIsNone(w.on_edit('/testbed/src/module.py',edit_result=output(1),cwd='/testbed',source_hash=S,tree_epoch='epoch',environment_id='env1',test_hash=H))
if __name__=='__main__':unittest.main()
