import importlib.util,pathlib,unittest,json
spec=importlib.util.spec_from_file_location('estimate',pathlib.Path(__file__).with_name('estimate-recorded-usage.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def assistant(command,id='a',usage=None):
 return {'role':'assistant','content':'reasoning','tool_calls':[{'id':id,'function':{'name':'bash','arguments':json.dumps({'command':command})}}],'extra':{'response':{'usage':usage or {'prompt_tokens':100,'completion_tokens':10}},'cost':.01}}
def result(id='a',text='<returncode>0</returncode>\n<output>ok</output>'):return {'role':'tool','tool_call_id':id,'content':text}
class RecordedUsage(unittest.TestCase):
 def test_cache_is_subset_not_extra(self):
  u=m.usage_fields({'prompt_tokens':100,'completion_tokens':10,'cache_read_input_tokens':80,'cache_creation_input_tokens':15});self.assertEqual(u['totalTokens'],110);self.assertEqual(u['cachedInputTokens'],80)
 def test_response_multitools_are_one_call(self):
  r={'messages':[{'object':'response','output':[{'type':'reasoning'},{'type':'function_call','name':'bash','arguments':'{"command":"echo a"}','call_id':'a'},{'type':'function_call','name':'bash','arguments':'{"command":"echo b"}','call_id':'b'}],'usage':{'input_tokens':200,'output_tokens':20}}, {'type':'function_call_output','call_id':'b','output':'second'},{'type':'function_call_output','call_id':'a','output':'first'}]}
  ts=m.normalize(r);self.assertEqual(len(ts),1);self.assertEqual(len(ts[0]['actions']),2);self.assertEqual(ts[0]['actions'][0]['results'],['first']);self.assertEqual(ts[0]['usage']['totalTokens'],220)
 def test_exact_match_uses_target_whole_call_usage(self):
  r={'messages':[assistant("cat <<'EOF' > test.py\nprint(1)\nEOF"),result(),assistant('python test.py','b',{'prompt_tokens':230,'completion_tokens':12}),result('b')]}
  ts,es,counts=m.analyze(r);self.assertEqual(counts['proposals'],1);self.assertEqual(len(es),1);self.assertEqual(es[0]['usage']['totalTokens'],242)
 def test_multi_target_cannot_save_whole_call(self):
  target=assistant('python test.py','b');target['tool_calls'].append({'id':'c','function':{'name':'bash','arguments':'{"command":"echo other"}'}})
  r={'messages':[assistant("cat <<'EOF' > test.py\nprint(1)\nEOF"),result(),target,result('b'),result('c')]};_,es,c=m.analyze(r);self.assertEqual(es,[]);self.assertEqual(c['nextMultiToolTurnsExcluded'],1)
 def test_frozen_grammar_not_broadened(self):
  for cmd in ["cat > test.py <<'EOF'\nprint(1)\nEOF","cd /testbed && cat <<'EOF' > test.py\nprint(1)\nEOF"]:
   _,es,c=m.analyze({'messages':[assistant(cmd),result(),assistant('python test.py','b'),result('b')]});self.assertEqual(c['proposals'],0);self.assertEqual(es,[])
 def test_unknown_or_invalid_usage_not_fabricated(self):
  for value in [None,{}, {'prompt_tokens':-1,'completion_tokens':2},{'prompt_tokens':True,'completion_tokens':2}]:self.assertIsNone(m.usage_fields(value))
 def test_unaligned_result_not_credited(self):
  _,es,c=m.analyze({'messages':[assistant("cat <<'EOF' > test.py\nprint(1)\nEOF"),result(),assistant('python test.py','b'),result('wrong')]});self.assertEqual(c['proposals'],1);self.assertEqual(es,[])
if __name__=='__main__':unittest.main()
