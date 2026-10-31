import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('estimate',pathlib.Path(__file__).with_name('estimate-trace-savings.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Estimates(unittest.TestCase):
 def test_structured_payload_counted_once_without_results_or_ids(self):
  self.assertEqual(m.payload({'content':'why','tool_calls':[{'id':'private-id','function':{'name':'view','arguments':'{}'}}],'results':['huge result']}),'why\nview\n{}')
 def test_list_content_and_object_arguments_are_serialized(self):
  self.assertEqual(m.payload({'content':[{'type':'text','text':'x'}],'tool_calls':[{'function':{'name':'f','arguments':{'a':1}}}]}),'[{"type":"text","text":"x"}]\nf\n{"a":1}')
 def test_prose_disqualifies_conservative(self):
  t={'content':'```bash\npython test.py\n```','actions':[{'command':'python test.py'}]}
  self.assertTrue(m.action_only(t));t['content']='THOUGHT: run it\n'+t['content'];self.assertFalse(m.action_only(t))
 def test_structured_tools_need_empty_prose_and_single_action(self):
  t={'content':'','actions':[{'arguments':{'command':'view'}}]};self.assertTrue(m.action_only(t));t['actions']*=2;self.assertFalse(m.action_only(t))
 def test_overlap_and_chain_removed_without_cross_record_collision(self):
  def e(s,t,r='a',p='p'):return {'record':r,'sourceOrdinal':s,'targetOrdinal':t,'program':p,'exact':True,'actionOnly':True,'requiresUnobservedOptIn':False}
  es=[e(0,1),e(0,1,p='q'),e(1,2),e(2,3),e(0,1,'b')]
  self.assertEqual([(e['record'],e['targetOrdinal']) for e in m.select_nonoverlapping(es)],[('a',1),('a',3),('b',1)])
 def test_optin_and_equivalent_and_prose_are_scenario_only(self):
  base={'record':'a','sourceOrdinal':0,'targetOrdinal':1,'program':'p','exact':True,'actionOnly':True,'requiresUnobservedOptIn':False}
  for key,val in [('exact',False),('actionOnly',False),('requiresUnobservedOptIn',True)]:
   event={**base,key:val};self.assertEqual(m.select_nonoverlapping([event],True),[]);self.assertEqual(len(m.select_nonoverlapping([event])),1)
 def test_accounting_separates_input_output_and_deduplicates_groups(self):
  es=[{'record':'a','issue':'i','outputTokenProxy':3,'requestInputTokenProxy':100,'actionOnly':False},{'record':'b','issue':'j','outputTokenProxy':7,'requestInputTokenProxy':200,'actionOnly':True}]
  a=m.accounting(es,{'a':{'groupKey':'g'},'b':{'groupKey':'g'}});self.assertEqual(a['visibleOutputTokenProxy'],10);self.assertEqual(a['skippedRequestInputTokenProxy'],300);self.assertEqual(a['totalGrossTokenProxy'],310);self.assertEqual(a['repoBaseGroups'],1)
if __name__=='__main__':unittest.main()
