import importlib.util,pathlib,unittest,json
p=pathlib.Path(__file__).with_name('candidate-command-repair-v3.py');s=importlib.util.spec_from_file_location('repair',p);c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
ERR='<returncode>127</returncode>\n<output>\nbash: line 1: rg: command not found\n</output>'
class Checks(unittest.TestCase):
 def test_literal_repair(self):
  p=c.plan('cd /testbed && rg -n "class Thing" src/a.py',ERR);self.assertEqual(p['argv'],['grep','-n','--','class Thing','/testbed/src/a.py'])
 def test_native_error_only_once(self):
  cmd='rg -n foo a.py'
  for e in [ERR.replace('127','0'),ERR+'extra',ERR.replace('rg:','python:')]:self.assertIsNone(c.plan(cmd,e))
  self.assertIsNone(c.plan(cmd,ERR,retries=1))
 def test_pipes_and_bundles_refused(self):
  for cmd in ['rg -n foo a.py | head','rg -n foo a.py && cat a.py','rg -n foo a.py; true','rg -n foo a.py\ntrue']:self.assertIsNone(c.plan(cmd,ERR))
 def test_regex_and_implicit_directory_refused(self):
  for cmd in ["rg -n 'a|b' a.py",'rg -n foo','rg -n foo src','rg -n foo ../a.py','rg -n foo /etc/a.py',"rg -n 'x.*' a.py"]:self.assertIsNone(c.plan(cmd,ERR))
 def test_normalized_target(self):
  a=c.parse('rg -n "class A" a.py','rg');b=c.parse('grep "class A" -n -n /testbed/a.py','grep');self.assertEqual(a,b)
 def test_observed_result_limits(self):
  self.assertTrue(c.observed_search('<returncode>1</returncode>\n<output>\n</output>'))
  self.assertFalse(c.observed_search('<returncode>2</returncode>\n<output>x</output>'))
  self.assertFalse(c.observed_search('<returncode>0</returncode>\n<output>truncated</output>'))
 def test_whole_response_replay_usage_and_multitool_refusal(self):
  def turn(key,command):return {'role':'assistant','tool_calls':[{'id':key,'function':{'name':'bash','arguments':json.dumps({'command':command})}}],'extra':{'response':{'usage':{'prompt_tokens':100,'completion_tokens':12}},'cost':0.01}}
  target=turn('b','grep -n thing a.py')
  raw={'instance_id':'repo__name-1','messages':[turn('a','rg -n thing a.py'),{'role':'tool','tool_call_id':'a','content':ERR},target,{'role':'tool','tool_call_id':'b','content':'<returncode>0</returncode>\n<output>\n1:thing\n</output>'}]}
  turns,proposals,events,diag=c.analyze(raw,'fixture');self.assertEqual(len(events),1);self.assertEqual(events[0]['usage']['totalTokens'],112)
  target['tool_calls'].append({'id':'c','function':{'name':'bash','arguments':'{"command":"true"}'}})
  self.assertEqual(len(c.analyze(raw,'fixture')[2]),0)
if __name__=='__main__':unittest.main()
