import importlib.util,pathlib,unittest,json
s=importlib.util.spec_from_file_location('patch',pathlib.Path(__file__).with_name('candidate-patch-review-v4.py'));c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
OK='<returncode>0</returncode>\n<output>\n</output>'
EDIT="python - <<'PY'\nfrom pathlib import Path\np = Path('src/a.py')\np.write_text(p.read_text().replace('old', 'new'))\nPY"
class Checks(unittest.TestCase):
 def test_plan_uses_edited_file(self):self.assertEqual(c.plan(EDIT,OK)['argv'],['git','diff','--','/testbed/src/a.py'])
 def test_failure_and_unsupported_edit(self):
  self.assertIsNone(c.plan(EDIT,OK.replace('>0<','>1<')));self.assertIsNone(c.plan('echo x >> src/a.py',OK))
 def test_exact_path_and_optional_separator(self):
  for cmd in ['git diff src/a.py','git diff -- /testbed/src/a.py\n','cd /testbed && git diff -- src/a.py']:
   self.assertEqual(c.parse_diff(cmd),{'cwd':'/testbed','argv':['git','diff','--','/testbed/src/a.py']})
 def test_bundles_and_other_diff_forms_rejected(self):
  for cmd in ['git diff','git diff --stat src/a.py','git diff src/a.py | head','git diff src/a.py > out','git diff src/a.py\ngit status','git diff src/a.py src/b.py','git diff HEAD -- src/a.py']:
   self.assertIsNone(c.parse_diff(cmd))
 def test_paths_and_cwd(self):
  for cmd in ['git diff ../x.py','git diff /etc/x.py','git diff .hidden/x.py','git diff tests/test_a.py']:
   self.assertIsNone(c.parse_diff(cmd))
  self.assertNotEqual(c.parse_diff('cd /testbed/src && git diff a.py')['cwd'],c.plan(EDIT,OK)['cwd'])
 def test_literal_edit_only(self):
  self.assertIsNone(c.plan(EDIT.replace("Path('src/a.py')","Path(input())"),OK));self.assertIsNone(c.plan(EDIT.replace("p.write_text", "p.unlink(); p.write_text"),OK))
 def test_singleton_usage_and_multitool_exclusion(self):
  def assistant(i,cmd):return {'role':'assistant','tool_calls':[{'id':i,'function':{'name':'bash','arguments':json.dumps({'command':cmd})}}],'extra':{'response':{'usage':{'prompt_tokens':100,'completion_tokens':10}},'cost':.01}}
  raw={'instance_id':'a__b-1','messages':[assistant('a',EDIT),{'role':'tool','tool_call_id':'a','content':OK},assistant('b','git diff src/a.py'),{'role':'tool','tool_call_id':'b','content':OK}]}
  es=c.analyze(raw,'fixture')[2];self.assertEqual(len(es),1);self.assertEqual(es[0]['usage']['totalTokens'],110)
  raw['messages'][2]['tool_calls'].append({'id':'c','function':{'name':'bash','arguments':'{"command":"true"}'}});self.assertEqual(c.analyze(raw,'fixture')[2],[])
 def test_output_bounds_and_truncation(self):
  def assistant(i,cmd):return {'role':'assistant','tool_calls':[{'id':i,'function':{'name':'bash','arguments':json.dumps({'command':cmd})}}]}
  raw={'instance_id':'a__b-1','messages':[assistant('a',EDIT),{'role':'tool','tool_call_id':'a','content':OK},assistant('b','git diff src/a.py'),{'role':'tool','tool_call_id':'b','content':OK}]}
  for result in [OK.replace('\n</output>', 'x'*32769+'\n</output>'),OK.replace('\n</output>','output truncated\n</output>'),OK.replace('>0<','>1<')]:
   raw['messages'][3]['content']=result;self.assertEqual(c.analyze(raw,'fixture')[2],[])
if __name__=='__main__':unittest.main()
