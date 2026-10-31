"""Explicit failed-assertion variant of the registered-test rerun candidate.

Reuse the source-edit and test-command grammar unchanged. Never execute commands.
"""
import collections,hashlib,importlib.util,json,pathlib,re,sys
spec=importlib.util.spec_from_file_location('base',pathlib.Path(__file__).with_name('candidate-rerun-v2.py'));base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)

rejections=collections.Counter()

def assertion_failure(text):
 if not text.startswith('<returncode>1</returncode>\n<output>') or text.count('<returncode>')!=1:return False
 # Refuse infrastructure/collection/setup evidence even when another assertion
 # appears in the same output. These matches deliberately favor abstention.
 if re.search(r'ImportError|ModuleNotFoundError|SyntaxError|ERROR collecting|ERROR at setup|fixture .* not found|command not found|No module named|Failed to import',text,re.I):return False
 return bool(re.search(r'(?m)^(?:E\s+AssertionError\b|AssertionError\b|E\s+assert\s|E\s+Failed: DID NOT RAISE)',text))

def plan(history,current):
 a=base.singleton(current)
 if not a or not base.success(a['results'][0]):return None
 path=base.edited_source(a['command'])
 if not path:return None
 for old in reversed(history[-12:]):
  oa=base.singleton(old)
  if not oa:continue
  prior=base.test_command(oa['command'])
  if prior:
   if not assertion_failure(oa['results'][0]):
    rejections['priorTestNotAssertionFailure']+=1
    if re.search(r'ImportError|ModuleNotFoundError',oa['results'][0]):rejections['importErrorEvidence']+=1
    return None
   return {**prior,'editedPath':path,'testSourceOrdinal':old['ordinal'],'requiresRegisteredTestAndEnvironment':True,'requiresExplicitRerunAfterEditPolicy':True,'maxRuntimeSeconds':120,'maxOutputBytes':32000,'trigger':'prior_exit_1_assertion_failure'}
 return None

def main():
 base.plan=plan
 base.main()
 out=pathlib.Path(sys.argv[sys.argv.index('--public')+1]);report=json.loads(out.read_text())
 report.update(program='registered_failed_test_rerun_v2',title='Rerun a failed regression after a source edit',fixtureChecks=5,policy='Same bounded source-edit and registered-test grammar as successful-test rerun; latest recognized test within 12 responses must exit1 with terminal assertion evidence, with import/collection/setup errors excluded. Current source edit must succeed. Exact unchanged cwd/argv or inline-script hash match.',plannerSha256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),basePlannerSha256=hashlib.sha256(pathlib.Path(base.__file__).read_bytes()).hexdigest())
 report['limitations']=[s.replace('Successful prior test exit does not establish a useful regression or assertion coverage.','Assertion failure evidence does not establish that the source edit fixes the bug; task quality remains untested.') for s in report['limitations']]
 report['diagnostics']['failedVariantRejections']=dict(rejections)
 out.write_text(json.dumps(report,indent=2)+'\n')
if __name__=='__main__':main()
