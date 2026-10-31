import importlib.util,json,pathlib,subprocess,sys,tempfile
spec=importlib.util.spec_from_file_location('isolated',pathlib.Path(__file__).with_name('isolated-regression.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
checks=[]
with tempfile.TemporaryDirectory(prefix='autotoken-fixture-') as temp:
    root=pathlib.Path(temp)
    def git(*args):return subprocess.check_output(['/usr/bin/git',*args],cwd=root,stderr=subprocess.DEVNULL).decode().strip()
    git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture')
    (root/'calculator.py').write_text('def total(values):\n    return sum(values) - 1\n')
    git('add','calculator.py');git('commit','-m','fixture');base=git('rev-parse','HEAD')
    (root/'calculator.py').write_text('def total(values):\n    return sum(values)\n')
    regression=b'from calculator import total\nassert total([2, 3]) == 5, "regression: total must be 5"\nprint("regression passed")\n'
    (root/'test_regression.py').write_bytes(regression)
    before={str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
    result=m.compare(root,base,{'test_regression.py':regression},[sys.executable,'test_regression.py'])
    assert result['baseFailsPatchedPasses'];assert 'regression: total must be 5' in result['original']['output'];assert 'regression passed' in result['patched']['output']
    assert result['original']['regressionHashes']==result['patched']['regressionHashes']
    after={str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
    assert before==after;checks+=['original fails assertion / patch passes','identical regression hashes','worktree including Git metadata unchanged']
    timed=m.execute([sys.executable,'-c','import time; time.sleep(2)'],root,.1,1024);assert timed['timedOut'];checks.append('timeout stops child')
    huge=m.execute([sys.executable,'-c','print("x" * 100000)'],root,2,128);assert huge['truncated'] and len(huge['output'].encode())<=128;checks.append('output bounded')
    for bad in ['../outside.py','/tmp/outside.py','.git/config']:
        try:m.safe_path(bad)
        except ValueError:pass
        else:raise AssertionError(bad)
    checks.append('path escapes rejected')
    (root/'calculator.py').unlink();(root/'calculator.py').symlink_to('/etc/hosts')
    try:m.compare(root,base,{'test_regression.py':regression},[sys.executable,'test_regression.py'])
    except ValueError:pass
    else:raise AssertionError('Symlink accepted')
    checks.append('worktree symlink rejected')
report={'checks':checks,'syntheticEvidence':result,'limits':['Trusted code only: temporary copies are not a security sandbox.','Explicit added regression files must be supplied; historical pre-edit test state is not reconstructed.','No recorded shell commands executed.']}
out=pathlib.Path('data/analysis/isolated-regression-v1');out.mkdir(parents=True,exist_ok=True);(out/'fixture.json').write_text(json.dumps(report,indent=2));(out/'fixture.json').chmod(0o600)
print(json.dumps({'passed':len(checks),'checks':checks},indent=2))
