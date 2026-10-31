import importlib.util,pathlib,tempfile,subprocess
spec=importlib.util.spec_from_file_location('locator',pathlib.Path(__file__).with_name('test-locator-probe.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
assert m.locate(['src/pkg/fields.py'],['src/pkg/fields.py','tests/test_fields.py'])==['tests/test_fields.py']
assert m.locate(['src/pkg/fields.py'],['src/pkg/fields.py','tests/test_fields.py'],['tests/test_fields.py'])==[]
assert m.locate(['src/pkg/unknown.py'],['src/pkg/fields.py','tests/test_fields.py'])==[]
assert m.locate(['src/pkg/__init__.py'],['src/pkg/__init__.py','tests/test_init.py'])==[]
assert len(m.locate(['src/pkg/fields.py'],['src/pkg/fields.py']+[f'tests/group{i}/test_fields.py' for i in range(10)]))==4
assert m.requested_files("python - <<'PY'\nopen('tests/test_hidden.py').read()\nPY\npython -m pytest tests/test_real.py::test_case") == ['tests/test_real.py']
assert m.requested_files("rg something tests/test_*.py") == []
assert m.requested_files("rg 'tests/test_pattern.py' src/fields.py") == ['src/fields.py']
assert m.requested_files("rg -e 'tests/test_pattern.py' src/fields.py") == ['src/fields.py']
assert m.requested_files("rg --unknown value src/fields.py") == []
assert m.requested_files("pytest -k 'tests/test_pattern.py' tests/test_actual.py") == ['tests/test_actual.py']
with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d);(root/'src/pkg').mkdir(parents=True);(root/'tests').mkdir()
 (root/'src/pkg/fields.py').write_text('pass\n');(root/'tests/test_fields.py').write_text('pass\n');(root/'tests/test_link.py').symlink_to('../src/pkg/fields.py')
 def git(*args):return subprocess.run(['git','-C',d,*args],capture_output=True,check=True).stdout.decode().strip()
 git('init','-q');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');commit=git('rev-parse','HEAD')
 (root/'tests/test_future.py').write_text('pass\n')
 tree=m.file_tree(d,commit)
 assert 'tests/test_future.py' not in tree and 'tests/test_link.py' not in tree
 assert m.locate(['src/pkg/fields.py'],tree)==['tests/test_fields.py']
print('13 checks passed: exact match, known/missing/init abstention, cap, heredoc/wildcard exclusion, original-base and symlink exclusion')
