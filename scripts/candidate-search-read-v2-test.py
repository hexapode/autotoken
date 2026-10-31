import importlib.util,pathlib,unittest
s=importlib.util.spec_from_file_location('candidate',pathlib.Path(__file__).with_name('candidate-search-read-v2.py'));c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
def obs(s):return '<returncode>0</returncode>\n<output>\n'+s+'\n</output>'
class Tests(unittest.TestCase):
 def test_unique_line(self):
  p=c.plan("grep -n 'def foo' /testbed/a.py",obs('245:def foo():'));self.assertEqual((p['start'],p['end']),(145,345));self.assertEqual(p['path'],'/testbed/a.py')
 def test_recursive_filename(self):
  p=c.plan("cd /testbed && rg -n foo src",obs('src/a.py:20:foo()'));self.assertEqual((p['path'],p['start'],p['end']),('/testbed/src/a.py',1,120))
 def test_multiple_hits_and_partial_search(self):
  for cmd,o in [("grep -n foo a.py",obs('1:foo\n3:foo')),("grep -n foo a.py | head -1",obs('1:foo')),("grep -A 1 -n foo a.py",obs('1:foo')),("grep -n foo a.py",obs('truncated'))]:self.assertIsNone(c.plan(cmd,o))
 def test_paths_chains_and_failed_search(self):
  for cmd in ['grep -n foo ../a.py','grep -n foo /etc/passwd','grep -n foo a.py && echo ok','grep -n foo $(pwd)/a.py']:
   self.assertIsNone(c.plan(cmd,obs('1:foo')))
  self.assertIsNone(c.plan('grep -n foo a.py',obs('1:foo').replace('returncode>0','returncode>1')))
 def test_unique_file(self):
  p=c.plan('find /testbed -name a.py -type f',obs('/testbed/src/a.py'));self.assertEqual((p['start'],p['end']),(1,200))
  self.assertIsNone(c.plan('find /testbed -name a.py -delete',obs('/testbed/a.py')))
 def test_exact_and_cover_are_separate(self):
  p=c.plan('grep -n foo a.py',obs('245:foo'))
  self.assertEqual(c.classify(p,c.read("sed -n '145,345p' a.py",obs('a'))),'exact')
  self.assertEqual(c.classify(p,c.read("sed -n '230,250p' a.py",obs('a'))),'coverage_only')
  self.assertIsNone(c.classify(p,c.read("sed -n '1,250p' a.py",obs('a'))))
 def test_bundles_multitool_and_caps_not_credited(self):
  for cmd in ["cat a.py && echo done","sed -n '1,251p' a.py",'head -100 a.py | tail -50']:
   self.assertIsNone(c.read(cmd,obs('a')))
  self.assertIsNone(c.read('cat a.py',obs('')))
  self.assertIsNone(c.read('cat a.py',obs('a'*16001)))
 def test_cat_eof_not_exact(self):
  p=c.plan('find /testbed -name a.py',obs('/testbed/a.py'));self.assertEqual(c.classify(p,c.read('cat /testbed/a.py',obs('line1\nline2'))),'coverage_only')
if __name__=='__main__':unittest.main()
