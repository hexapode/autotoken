import importlib.util,pathlib,unittest
s=importlib.util.spec_from_file_location('candidate',pathlib.Path(__file__).with_name('candidate-write-run-v2.py'));c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
OK='<returncode>0</returncode>\n<output>\n</output>'
class Checks(unittest.TestCase):
 def test_orders_and_cd(self):
  for cmd in ["cat > /testbed/a.py << 'EOF'\nprint(1)\nEOF", "cat <<'EOF' > a.py\nprint(1)\nEOF\n", "cd /testbed && cat > a.py <<'EOF'\nprint(1)\nEOF"]:self.assertEqual(c.plan(cmd,OK)['argv'],['python','/testbed/a.py'])
 def test_bundled_run_rejected(self):
  self.assertIsNone(c.parse_write("cat > a.py <<'EOF'\nprint(1)\nEOF\npython a.py"))
 def test_early_delimiter_rejected(self):
  self.assertIsNone(c.parse_write("cat > a.py <<'EOF'\nEOF\nrm a\nEOF"))
 def test_unquoted_and_expansion_rejected(self):
  for p in ["cat > a.py <<EOF\nx\nEOF", "cat > $(pwd)/a.py <<'EOF'\nx\nEOF", "cat > a.py <<'EOF' && true\nx\nEOF"]:self.assertIsNone(c.parse_write(p))
 def test_paths_and_size(self):
  for path in ['/etc/a.py','../a.py','/testbed/../tmp/a.py','/testbed/.secret.py']:
   self.assertIsNone(c.parse_write("cat > "+path+" <<'EOF'\nx\nEOF"))
  self.assertIsNone(c.parse_write("cat > a.py <<'EOF'\n"+'x'*65536+'\nEOF'))
 def test_failure_and_interpreter(self):
  cmd="cat > a.py <<'EOF'\nx\nEOF"
  self.assertIsNone(c.plan(cmd,OK.replace('>0<','>1<')));self.assertIsNone(c.plan(cmd,OK,'python3'))
 def test_next_exact_whole_call(self):
  self.assertEqual(c.parse_run('cd /testbed && python /tmp/a.py'),{'argv':['python','/tmp/a.py'],'cwd':'/testbed'})
  for cmd in ['python3 a.py','python a.py && true','python a.py x','python a.py; echo x','python -c x']:self.assertIsNone(c.parse_run(cmd))
 def test_cwd_and_hash(self):
  p=c.plan("cd /tmp && cat > a.py <<'EOF'\nx\nEOF",OK)
  self.assertEqual(p['cwd'],'/tmp');self.assertNotEqual(c.parse_run('python /tmp/a.py')['cwd'],p['cwd']);self.assertEqual(len(p['sha256']),64)
 def test_replay_whole_response_and_recorded_usage(self):
  import json
  def assistant(ident,command):return {'role':'assistant','tool_calls':[{'id':ident,'function':{'name':'bash','arguments':json.dumps({'command':command})}}],'extra':{'response':{'usage':{'prompt_tokens':20,'completion_tokens':11}},'cost':0.001}}
  source=assistant('a',"cat > a.py <<'EOF'\nx\nEOF");target=assistant('b','python a.py')
  raw={'instance_id':'example__repo-1','messages':[source,{'role':'tool','tool_call_id':'a','content':OK},target,{'role':'tool','tool_call_id':'b','content':OK.replace('>0<','>1<')}]}
  turns,proposals,events,counts=c.analyze(raw,'fixture')
  self.assertEqual(len(events),1);self.assertEqual(events[0]['usage']['totalTokens'],31);self.assertEqual(events[0]['targetExitCode'],1)
  target['tool_calls'].append({'id':'c','function':{'name':'bash','arguments':'{"command":"true"}'}})
  self.assertEqual(len(c.analyze(raw,'fixture')[2]),0)
if __name__=='__main__':unittest.main()
