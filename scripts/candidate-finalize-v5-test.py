import importlib.util,json,pathlib,unittest
spec=importlib.util.spec_from_file_location('finalize',pathlib.Path(__file__).with_name('candidate-finalize-v5.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def result(text='',code=0):return f'<returncode>{code}</returncode>\n<output>\n{text}\n</output>'
def fixture(commands):
 messages=[]
 for i,(cmd,out) in enumerate(commands):
  messages.append({'role':'assistant','content':'Reviewing verification evidence.','tool_calls':[{'id':str(i),'function':{'name':'bash','arguments':json.dumps({'command':cmd})}}],'extra':{'response':{'usage':{'prompt_tokens':100,'completion_tokens':10}},'cost':.01}})
  if out is not None:messages.append({'role':'tool','tool_call_id':str(i),'content':out})
 return {'instance_id':'synthetic-fixture','messages':messages}
class Checks(unittest.TestCase):
 def test_positive_conditional_only(self):
  ts,ps,es,d=m.analyze(fixture([('python -m pytest tests -q',result('12 passed')),('git diff --check',result()),(m.FINISH,None)]),'fixture')
  self.assertEqual(len(ps),1);self.assertEqual(len(es),1);self.assertEqual(es[0]['deploymentCreditCalls'],0);self.assertFalse(es[0]['historicalOptInVerified']);self.assertTrue(es[0]['reasoningOrProse'])
 def test_passing_test_not_enough(self):
  _,ps,es,_=m.analyze(fixture([('pytest -q',result('1 passed')),(m.FINISH,None)]),'fixture');self.assertFalse(ps);self.assertFalse(es)
 def test_unknown_edit_or_pipeline_invalidates(self):
  for command in ['git status --short | head -5','python fix.py','sed -i s/a/b/ file.py']:
   _,ps,es,_=m.analyze(fixture([('pytest -q',result('1 passed')),(command,result()),('git diff --check',result()),(m.FINISH,None)]),'fixture');self.assertFalse(ps)
 def test_checks_are_full_tree_and_unmasked(self):
  for command in ['git diff --check file.py','git diff --check | head -5','git diff --check; true','git diff --check > /tmp/result']:
   self.assertIsNone(m.parse_operations(command))
 def test_failed_test_or_check(self):
  for tests,check in [(result('1 failed, 2 passed',1),result()),(result('2 passed'),result('whitespace',2)),(result('2 passed\noutput truncated'),result())]:
   _,ps,es,_=m.analyze(fixture([('pytest -q',tests),('git diff --check',check),(m.FINISH,None)]),'fixture');self.assertFalse(ps)
 def test_exact_submission_only(self):
  for command in ['echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT',m.FINISH+' && git diff','echo finished']:
   _,ps,es,_=m.analyze(fixture([('pytest -q',result('1 passed')),('git diff --check',result()),(command,None)]),'fixture');self.assertEqual(len(ps),1);self.assertFalse(es)
 def test_stale_verification(self):
  state={'ordinal':0,'argv':['pytest']};state,plan=m.advance(state,'git diff --check',result(),5);self.assertIsNone(plan)
 def test_chain_order_and_redirect(self):
  _,p=m.advance(None,'cd /testbed && pytest -q 2>&1 && git diff --check 2>&1',result('2 passed'),0);self.assertIsNotNone(p)
  _,p=m.advance(None,'git diff --check && pytest -q',result('2 passed'),0);self.assertIsNone(p)
if __name__=='__main__':unittest.main()
