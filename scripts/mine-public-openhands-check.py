import importlib.util,pathlib,copy
spec=importlib.util.spec_from_file_location('miner',pathlib.Path(__file__).with_name('mine-public-openhands.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
a={'name':'str_replace_editor','arguments':{'command':'view','path':'/workspace/demo/source.py','view_range':[152,200]}}
o='ERROR:\nInvalid `view_range` parameter: [152, 200]. Its second element `200` should be smaller than the number of lines in the file: `189`.'
p=m.repair_view(a,o);assert p['arguments']['view_range']==[152,189]
source='\n'.join('line '+str(i) for i in range(1,190));start,end=p['arguments']['view_range'];assert len(source.splitlines()[start-1:end])==38
assert m.repair_view(a,o,retries=1)is None
assert m.repair_view(a,o.replace('`189`','`100`'))is None
assert m.repair_view(a,o.replace('`189`','`201`'))is None
assert m.repair_view(a,o.replace('[152, 200]','[151, 200]'))is None
assert m.repair_view(a,o.replace('second element `200`','second element `199`'))is None
assert m.repair_view(a,'ERROR: Invalid path')is None
b=copy.deepcopy(a);b['arguments']['path']='/workspace/demo/../secret';assert m.repair_view(b,o)is None
b=copy.deepcopy(a);b['arguments']['command']='str_replace';assert m.repair_view(b,o)is None
b=copy.deepcopy(a);b['arguments']['view_range']=[1,1000];assert m.repair_view(b,o)is None
b=copy.deepcopy(a);b['arguments']['view_range']=[152,'200'];assert m.repair_view(b,o)is None
b=copy.deepcopy(a);b['arguments']['new_str']='unexpected';assert m.repair_view(b,o)is None
assert m.pytest_command({'name':'execute_bash','arguments':{'command':'cd /workspace/demo && python -m pytest tests/test_x.py -q'}})
assert m.pytest_command({'name':'execute_bash','arguments':{'command':'python -m pytest | tail -5'}})is None
assert m.pytest_command({'name':'execute_bash','arguments':{'command':'python -m pytest; rm x'}})is None
# Missing nonfinish observations must never produce next-action success labels.
b=copy.deepcopy(p);b['results']=[]
r={'instanceId':'fixture','turns':[{'actions':[{**a,'results':[{'content':o}]}]},{'actions':[b]}]}
assert not m.mine([r])['events']['view_range_repair']
b['results']=[{'content':"Here's the result of running `cat -n` on /workspace/demo/source.py:\n"+'\n'.join(f'{i}\tline {i}' for i in range(152,190))}]
assert m.mine([r])['events']['view_range_repair'][0]['nextSucceeded']
b['results']=[{'content':'Something unexpected happened'}]
assert not m.mine([r])['events']['view_range_repair'][0]['nextSucceeded']
print('19 checks passed: bounded repair, fixture source read, one-retry limit, malformed/unsafe inputs, pytest syntax, terminal gap exclusion')
