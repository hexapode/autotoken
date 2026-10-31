import importlib.util,pathlib,unittest,json
s=importlib.util.spec_from_file_location('continuation',pathlib.Path(__file__).with_name('candidate-read-continuation-v4.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def output(lines,code=0):return f'<returncode>{code}</returncode>\n<output>\n'+ '\n'.join(lines)+'\n</output>'
LINES=['def example():']+['    x = 1']*19
class Checks(unittest.TestCase):
 def test_filled_indented_window_predicts_fixed_overlap(self):
  p=m.plan("sed -n '1,20p' package/a.py",output(LINES));self.assertEqual((p['start'],p['end']),(20,120));self.assertEqual(p['path'],'/testbed/package/a.py')
 def test_short_eof_or_nonindented_end_abstains(self):
  self.assertIsNone(m.plan("sed -n '1,20p' a.py",output(LINES[:-1])));self.assertIsNone(m.plan("sed -n '1,20p' a.py",output(LINES[:-1]+['class Other:'])))
 def test_full_file_failed_truncated_and_tiny_reads_abstain(self):
  for cmd,out in [('cat a.py',output(LINES)),("sed -n '1,20p' a.py",output(LINES,1)),("sed -n '1,20p' a.py",output(LINES[:-1]+['    output truncated'])),("sed -n '1,3p' a.py",output(LINES[:3]))]:self.assertIsNone(m.plan(cmd,out))
 def test_paths_bundles_and_repeat_guard(self):
  for cmd in ["sed -n '1,20p' ../a.py","sed -n '1,20p' /etc/a.py","sed -n '1,20p' .git/a.py","sed -n '1,20p' a.py; true"]:self.assertIsNone(m.plan(cmd,output(LINES)))
  self.assertIsNone(m.plan("head -n 20 a.py",output(LINES),continuations=1))
 def test_head_canonical_same_policy(self):self.assertEqual(m.plan('head -20 a.py',output(LINES))['end'],120)
 def test_size_bound(self):self.assertIsNone(m.plan('head -20 a.py',output(['    '+'x'*1000]*20)))
 def test_exact_call_usage_and_multitool_exclusion(self):
  def assistant(id,cmd):return {'role':'assistant','tool_calls':[{'id':id,'function':{'name':'bash','arguments':json.dumps({'command':cmd})}}],'extra':{'response':{'usage':{'prompt_tokens':100,'completion_tokens':10}},'cost':0.01}}
  raw={'instance_id':'example__repo-1','messages':[assistant('a',"sed -n '1,20p' a.py"),{'role':'tool','tool_call_id':'a','content':output(LINES)},assistant('b',"sed -n '20,120p' a.py"),{'role':'tool','tool_call_id':'b','content':output(['    x = 1']*101)}]}
  es=m.analyze(raw,'fixture')[2];self.assertEqual(len(es),1);self.assertEqual(es[0]['matchType'],'exact');self.assertEqual(es[0]['usage']['totalTokens'],110)
  raw['messages'][2]['tool_calls'].append({'id':'c','function':{'name':'bash','arguments':'{"command":"true"}'}});self.assertEqual(m.analyze(raw,'fixture')[2],[])
 def test_issue_partition_stable(self):self.assertEqual(m.group('example__repo-1'),m.group('example__repo-1'))
if __name__=='__main__':unittest.main()
