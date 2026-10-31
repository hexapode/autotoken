import importlib.util,json,pathlib,unittest
s=importlib.util.spec_from_file_location('candidate',pathlib.Path(__file__).with_name('candidate-diff-check-v3.py'));c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
OK='<returncode>0</returncode>\n<output>\n</output>'
class Checks(unittest.TestCase):
 def test_known_syntax_commands(self):
  for cmd in ['python -m py_compile src/a.py','cd /testbed && python3 -m compileall -q src/a.py','python -m py_compile /testbed/a.py b.py']:
   self.assertEqual(c.plan(cmd,OK)['argv'],['git','status','--porcelain'])
 def test_failed_syntax_no_plan(self):self.assertIsNone(c.plan('python -m py_compile a.py',OK.replace('>0<','>1<')))
 def test_escape_shell_and_nonfiles_refused(self):
  for cmd in ['python -m py_compile ../a.py','python -m py_compile /tmp/a.py','python -m py_compile .secret/a.py','python -m compileall -q .','python -m py_compile a.py && true','python -m py_compile a.py | cat','python -m py_compile a.py;true','python -m py_compile $(pwd)/a.py']:
   self.assertIsNone(c.plan(cmd,OK),cmd)
 def test_fixed_status_only(self):
  for cmd in ['git status --porcelain','cd /testbed && git status --porcelain','git -C /testbed status --porcelain']:self.assertTrue(c.status_command(cmd))
  for cmd in ['git status --short','git status --porcelain > a','git status --porcelain && git diff','git -C /tmp status --porcelain']:self.assertFalse(c.status_command(cmd))
 def test_no_future_action_needed(self):
  first=c.plan('python -m py_compile a.py',OK);second=c.plan('python -m py_compile b.py',OK);self.assertEqual(first['argv'],second['argv']);self.assertEqual(first['cwd'],second['cwd'])
 def test_whole_response_accounting(self):
  def assistant(i,cmd):return {'role':'assistant','tool_calls':[{'id':i,'function':{'name':'bash','arguments':json.dumps({'command':cmd})}}],'extra':{'response':{'usage':{'prompt_tokens':100,'completion_tokens':20}}}}
  raw={'instance_id':'repo__one-1','messages':[assistant('a','python -m py_compile a.py'),{'tool_call_id':'a','content':OK},assistant('b','git status --porcelain'),{'tool_call_id':'b','content':OK}]}
  _,ps,es,_=c.analyze(raw,'fixture');self.assertEqual((len(ps),len(es),es[0]['usage']['totalTokens']),(1,1,120))
  raw['messages'][2]['tool_calls'].append({'id':'c','function':{'name':'bash','arguments':'{"command":"true"}'}});self.assertEqual(c.analyze(raw,'fixture')[2],[])
 def test_partition_does_not_relabel_inspected_issues(self):
  import hashlib
  for i in range(100):
   issue=f'repo__one-{i}'
   if int(hashlib.sha256(('diff-check-v3:'+issue).encode()).hexdigest(),16)%5==0:self.assertEqual(c.group(issue),'discovery')
if __name__=='__main__':unittest.main()
