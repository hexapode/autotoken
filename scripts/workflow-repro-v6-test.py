"""Synthetic state-machine fixtures; never execute a script or corpus command."""
import importlib.util,pathlib,unittest
p=pathlib.Path(__file__).with_name('workflow-repro-v6.py');s=importlib.util.spec_from_file_location('workflow',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def result(code,text=''):return f'<returncode>{code}</returncode>\n<output>\n{text}\n</output>'
class Tests(unittest.TestCase):
 def state(self):return m.start("cat > repro.py <<'EOF'\nraise ValueError('bad')\nEOF",result(0))
 def test_bound_identity(self):
  st=self.state();self.assertEqual(st['argv'],['python','/testbed/repro.py']);self.assertEqual(len(st['sha256']),64)
  self.assertIsNone(m.advance(st,'python other.py',result(0)));self.assertIsNone(m.advance(st,'cd /tmp && python /testbed/repro.py',result(0)))
 def test_stops_on_success(self):self.assertEqual(m.advance(self.state(),'python repro.py',result(0))['state'],'stop')
 def test_import_does_not_install(self):
  r=m.advance(self.state(),'python repro.py',result(1,"ModuleNotFoundError: No module named 'missing'"));self.assertEqual(r['classification'],'environment-or-import-failure');self.assertIsNone(r['context'])
 def test_application_context(self):
  r=m.advance(self.state(),'python repro.py',result(1,'Traceback (most recent call last):\n  File "/testbed/repro.py", line 1, in <module>\n  File "/testbed/pkg/core.py", line 120, in compute\nValueError: bad'))
  self.assertEqual(r['context']['path'],'/testbed/pkg/core.py');self.assertEqual((r['context']['start'],r['context']['end']),(70,170))
 def test_bad_inputs(self):
  self.assertIsNone(m.start("cat > patch.py <<'EOF'\npass\nEOF",result(0)))
  self.assertIsNone(m.start("cat > ../repro.py <<'EOF'\npass\nEOF",result(0)))
  self.assertIsNone(m.start("cat > repro.py <<EOF\npass\nEOF",result(0)))
  self.assertEqual(m.classify('x'*65537),'unusable');self.assertEqual(m.classify(result(-1)),'unusable');self.assertEqual(m.classify(result(1,'output truncated')),'unusable')
 def test_chains_and_no_future_leak(self):
  write="cat > repro.py <<'EOF'\nraise ValueError('bad')\nEOF";fail='Traceback (most recent call last):\n  File "/testbed/pkg/core.py", line 120, in compute\nValueError: bad'
  def turn(i,cmd,obs):return {'sourceMessageIndex':i,'actions':[{'name':'bash','command':cmd,'results':[obs]}],'usage':None,'reportedCost':None}
  turns=[turn(0,write,result(0)),turn(1,'python repro.py',result(1,fail)),turn(2,"sed -n '70,170p' pkg/core.py",result(0,'line'))]
  old=m.normalize;m.normalize=lambda raw:turns
  try:
   _,ps,es,_=m.analyze({'instance_id':'synthetic','messages':[{'content':''}]*3},'synthetic')
   self.assertEqual(len(es),2);self.assertEqual(es[1]['dependencyTargetOrdinal'],1);self.assertEqual(es[0]['workflowId'],es[1]['workflowId']);self.assertEqual(es[1]['sourceOrdinal']+1,es[1]['targetOrdinal'])
   turns[2]['actions'][0]['command']="sed -n '1,5p' pkg/other.py"
   _,ps2,es2,_=m.analyze({'instance_id':'synthetic','messages':[{'content':''}]*3},'synthetic')
   self.assertEqual(len(es2),1);self.assertEqual(len(ps2),len(ps))
  finally:m.normalize=old
if __name__=='__main__':unittest.main()
