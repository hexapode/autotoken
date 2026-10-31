"""Synthetic normalizer checks; does not access public trajectory contents."""
import importlib.util,pathlib
spec=importlib.util.spec_from_file_location('normalizer',pathlib.Path(__file__).with_name('normalize-public-traces.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
source={'dataset':'fixture/source','revision':'a'*40,'license':'mit','remotePath':'fixture.parquet','harness':'swe-agent'}
original=[{'role':'system','system_prompt':'Rules','text':None},{'role':'user','text':'Task'},{'role':'ai','text':'```\nopen file.py\n```'},{'role':'user','text':'Observed output'},{'role':'ai','text':'```\nsubmit\n```'}]
r=m.normalize({'instance_id':'repo__pkg-1','trajectory':original,'target':False},source,0,2)
assert r['sourceMessages']==original and r['messages'][0]['content']=='Rules'
assert len(r['turns'])==2 and r['turns'][0]['actions'][0]['name']=='swe_agent_action'
assert r['turns'][0]['observations'][0]['content']=='Observed output' and not r['turns'][1]['observations']
source={**source,'harness':'openhands'}
messages=[{'role':'assistant','content':None,'tool_calls':[{'id':'c1','function':{'name':'execute_bash','arguments':'{"command":"pwd"}'}}]},{'role':'tool','tool_call_id':'c1','content':'/fixture'},{'role':'assistant','content':'done','tool_calls':[{'id':'c2','function':{'name':'finish','arguments':'{}'}}]}]
r=m.normalize({'instance_id':'repo__pkg-2','trajectory':messages,'resolved':1},source,1,3)
assert r['turns'][0]['actions'][0]['alignment']=='tool_call_id' and r['turns'][0]['actions'][0]['command']=='pwd'
assert r['turns'][1]['actions'][0]['alignment']=='terminal_finish'
messages[-1]['tool_calls'][0]['function']['name']='execute_bash'
assert m.normalize({'instance_id':'repo__pkg-2','trajectory':messages},source,1,3)['turns'][1]['actions'][0]['alignment']=='unmatched'
source={**source,'harness':'mini-swe-agent-plus'}
r=m.normalize({'instance_id':'repo__pkg.abcdef0.mutation_x','messages':[{'role':'assistant','content':'```bash\ncat a.py\n```\n```bash\ncat b.py\n```'},{'role':'user','content':'unclear'}]},source,2,4)
assert r['unsupportedActionTurns']==1 and not r['turns'][0]['actions']
assert m.group_key('repo__pkg.abcdef0.mutation_x')==m.group_key('repo__pkg.abcdef0.mutation_y')=='repo__pkg.abcdef0'
assert m.group_key('repo__pkg-123')=='repo__pkg-123'
print('9 normalizer checks passed: original preservation, roles, custom actions, observations, tool IDs, terminal finish, missing result, ambiguous commands, grouped variants')
