import importlib.util,pathlib
spec=importlib.util.spec_from_file_location('audit',pathlib.Path(__file__).with_name('python-inspection-audit.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
assert m.audit('import inspect as i\ni.signature(f)')['inspectionCalls']==['inspect.signature']
assert m.audit('from inspect import getsource as source\nsource(f)')['inspectionCalls']==['inspect.getsource']
assert m.audit("text='inspect.signature(f)'\nprint(text)")['inspectionCalls']==[]
assert m.audit('from typing import get_type_hints as hints\nhints(f)')['inspectionCalls']==['typing.get_type_hints']
assert m.audit("open('secret','w').write('changed')")['possibleWrites']==['open_write','write']
assert m.audit('import nonexistent_module\nraise RuntimeError()')['inspectionCalls']==[]
assert len(list(m.HEREDOC.finditer("cat x; python - <<'PY'\nprint(type(1))\nPY\n")))==1
assert m.audit('import typing as t\nt.get_type_hints(f)')['inspectionCalls']==['typing.get_type_hints']
assert m.audit("open('secret',mode='w')")['possibleWrites']==['open_write']
assert m.audit("open('source',mode='r')")['possibleWrites']==[]
print('10 static-recognizer checks passed; input code/imports never executed')
