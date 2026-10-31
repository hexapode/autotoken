import hashlib,importlib.util,json,pathlib
spec=importlib.util.spec_from_file_location('mini',pathlib.Path(__file__).with_name('mine-public-mini.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
cmd="cat <<'EOF' > reproduce.py\nprint('fixture')\nEOF";ok='<returncode>0</returncode>\n<output>\n</output>'
checks=[]
p=m.plan_script_run(cmd,ok,'python');assert p['argv']==['python','reproduce.py'];assert p['sha256']==hashlib.sha256(b"print('fixture')\n").hexdigest();checks.append('immediate successful write yields exact bounded argv and script hash')
for bad in [cmd+' && python reproduce.py',cmd.replace('reproduce.py','../escape.py'),cmd.replace('reproduce.py','a.py;touch marker'),cmd.replace("print('fixture')","EOF\ntouch marker\nEOF\nprint('fixture')"),cmd.replace('reproduce.py','/tmp/escape.py')]:assert m.plan_script_run(bad,ok,'python') is None
checks.append('mixed shell, traversal, absolute paths and embedded terminators abstain')
assert m.plan_script_run(cmd,ok,None) is None;assert m.plan_script_run(cmd,ok,'python -c bad') is None;checks.append('registered interpreter required')
assert m.plan_script_run(cmd,ok.replace('>0<','>1<'),'python') is None;assert m.plan_script_run(cmd,'','python') is None;checks.append('failed or missing write observation abstains')
assert m.plan_script_run(cmd.replace("print('fixture')",'x'*65536),ok,'python') is None;checks.append('script size bounded')
assert m.pure_python('python reproduce.py && echo done') is None;assert m.pure_python('source env/bin/activate && python reproduce.py') is None;checks.append('bundled setup never labeled exact whole action')
# This script constructs strings only: neither fixture bodies nor source bodies run.
print(json.dumps({'passed':len(checks),'checks':checks,'noScriptBodiesExecuted':True},indent=2))
