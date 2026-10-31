import importlib.util,pathlib,json
spec=importlib.util.spec_from_file_location('rerun',pathlib.Path(__file__).with_name('targeted-rerun.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
prefix='Exit code: 1; timed out: false\n';cmd='python -m pytest tests/test_x.py -q'
checks=[]
p=m.plan(cmd,prefix+'FAILED tests/test_x.py::test_a - AssertionError\nFAILED tests/test_x.py::test_b[value-1]\n');assert p['nodes']==['tests/test_x.py::test_a','tests/test_x.py::test_b[value-1]'];assert p['argv'][-1]=='-q';checks.append('extract distinct safe IDs and preserve known flags')
assert m.plan(cmd,prefix+'FAILED tests/test_x.py::test_a\nFAILED tests/test_x.py::test_a')['nodes']==['tests/test_x.py::test_a'];checks.append('deduplicate')
for command,result in [(cmd+'; '+cmd,prefix+'FAILED tests/test_x.py::test_a'),('git stash; '+cmd,prefix+'FAILED tests/test_x.py::test_a'),(cmd,prefix+'FAILED ../tests/test_x.py::test_a'),(cmd,prefix+'FAILED tests/test_x.py::test_a[param with spaces]'),(cmd,prefix+'FAILED tests/test_x.py::test_a\noutput truncated'),(cmd,'Exit code: 1; timed out: true\nFAILED tests/test_x.py::test_a'),(cmd,prefix+'test session starts\ntest session starts\nFAILED tests/test_x.py::test_a')]:
 assert m.plan(command,result)['status']=='abstain'
checks.append('multiple sessions, stash, traversal, incomplete IDs, truncation and timeout abstain')
assert m.plan(cmd,prefix+'\n'.join('FAILED tests/test_x.py::test_'+str(i) for i in range(9)))['status']=='abstain';checks.append('failure count cap')
assert m.pytest_calls("python - <<'PY'\nprint('pytest fake.py')\nPY\n"+cmd)==[{'prefix':['python','-m','pytest'],'args':['tests/test_x.py','-q']}];checks.append('heredoc code ignored')
out=pathlib.Path('data/analysis/targeted-rerun-v1');out.mkdir(parents=True,exist_ok=True);(out/'fixture.json').write_text(json.dumps({'passed':len(checks),'checks':checks},indent=2));(out/'fixture.json').chmod(0o600);print(json.dumps(checks,indent=2))
