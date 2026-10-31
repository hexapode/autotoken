import importlib.util,pathlib,unittest
p=pathlib.Path(__file__).with_name('summarize-program-round.py');s=importlib.util.spec_from_file_location('round',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Checks(unittest.TestCase):
 def test_percentages_use_corpus_not_proposals(self):
  es=[{'instance':'a','usage':{'inputTokens':90,'outputTokens':10,'totalTokens':100,'cachedInputTokens':80},'reportedCost':0.02}]
  r=m.figures(es,{'calls':1000,'totalTokens':100000,'sourceReportedCostSum':20})
  self.assertEqual(r['callPercent'],0.1);self.assertEqual(r['tokenPercent'],0.1);self.assertEqual(r['matchedUsage']['totalTokens'],100)
 def test_empty_zero_denominator(self):
  r=m.figures([],{'calls':0,'totalTokens':0,'sourceReportedCostSum':0});self.assertEqual((r['callPercent'],r['tokenPercent']),(0,0))
 def test_duplicate_target_counted_once(self):
  common={'cohort':'m','instance':'x','sourceOrdinal':0,'targetOrdinal':1}
  selected,d,c=m.agg.select_union([{**common,'program':'a'},{**common,'program':'b'}]);self.assertEqual((len(selected),d,c),(1,1,0))
if __name__=='__main__':unittest.main()
