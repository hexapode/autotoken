import importlib.util,pathlib,unittest
p=pathlib.Path(__file__).with_name('aggregate-candidate-estimates.py');s=importlib.util.spec_from_file_location('aggregate',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def event(program,source,target,instance='issue',cohort='model'):
 return dict(program=program,sourceOrdinal=source,targetOrdinal=target,instance=instance,cohort=cohort)
class Accounting(unittest.TestCase):
 def test_same_target_counted_once(self):
  es,duplicates,chains=m.select_union([event('b',0,1),event('a',0,1)])
  self.assertEqual((len(es),duplicates,chains),(1,1,0));self.assertEqual(es[0]['program'],'a')
 def test_chained_opportunity_not_compounded(self):
  es,d,c=m.select_union([event('a',0,1),event('b',1,2),event('a',2,3)])
  self.assertEqual([e['targetOrdinal'] for e in es],[1,3]);self.assertEqual(c,1)
 def test_models_and_issues_stay_separate(self):
  es,d,c=m.select_union([event('a',0,1),event('a',0,1,cohort='other'),event('a',0,1,instance='other')])
  self.assertEqual((len(es),d,c),(3,0,0))
if __name__=='__main__':unittest.main()
