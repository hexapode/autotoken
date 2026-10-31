import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('download',pathlib.Path(__file__).with_name('download-official-traces.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class UsageTests(unittest.TestCase):
 def test_chat_cache_is_subset(self):
  t={'messages':[{'role':'assistant','tool_calls':[{},{}],'extra':{'response':{'usage':{'prompt_tokens':100,'completion_tokens':20,'prompt_tokens_details':{'cached_tokens':80},'cache_creation_input_tokens':10,'completion_tokens_details':{'reasoning_tokens':5}}},'cost':0.1}}]}
  r=m.usage_summary(t);self.assertEqual(r['modelCalls'],1);self.assertEqual(r['inputTokens'],100);self.assertEqual(r['cachedInputTokens'],80);self.assertEqual(r['cacheCreationInputTokens'],10);self.assertEqual(r['outputTokens'],20);self.assertEqual(r['reasoningOutputTokens'],5)
 def test_native_response_multiple_actions_one_call(self):
  t={'messages':[{'object':'response','output':[{'type':'function_call'},{'type':'function_call'}],'usage':{'input_tokens':100,'output_tokens':20,'input_tokens_details':{'cached_tokens':50}}},{'type':'function_call_output','output':'ok'}]}
  r=m.usage_summary(t);self.assertEqual(r['modelCalls'],1);self.assertEqual(r['callsWithUsage'],1)
 def test_missing_usage_is_not_zero_usage(self):
  r=m.usage_summary({'messages':[{'role':'assistant','extra':{'response':{}}}]});self.assertEqual(r['modelCalls'],1);self.assertEqual(r['callsWithUsage'],0);self.assertFalse(r['usageComplete'])
 def test_invalid_no_responses(self):
  for t in [{},{'messages':[]},{'messages':[{'role':'user'}]}]:
   with self.assertRaises(ValueError):m.usage_summary(t)
if __name__=='__main__':unittest.main()
