"""Inert discovery mining for public mini-swe-agent-plus observations.

No imported commands or Python bodies are executed. The bounded script-run
planner requires an explicitly registered interpreter; it does not infer intent
from a file write alone or enable automatic execution.
"""
import argparse,hashlib,json,pathlib,re,shlex
PATH=re.compile(r'[A-Za-z0-9_][A-Za-z0-9_./-]{0,199}\.py$')
WRITE=re.compile(r"\Acat <<'([A-Z][A-Z0-9_]{0,15})' > ([^\n]+)\n(.*)\n\1\n?\Z",re.S)
EDIT=re.compile(r"\Aold=\$\(cat <<'OLD'\n(.*?)\nOLD\n\) && new=\$\(cat <<'NEW'\n(.*?)\nNEW\n\) && python edit_via_str_replace ([A-Za-z0-9_./-]+) -- \"\$old\" \"\$new\"\s*\Z",re.S)
FINISH='echo MINI_SWE_AGENT_FINAL_OUTPUT && git add -A && git diff --cached'

def safe_path(path):return bool(PATH.fullmatch(path)) and '..' not in path.split('/') and all(p and not p.startswith('.') for p in path.split('/'))
def success(observation):return len(re.findall(r'<returncode>',observation))==1 and observation.startswith('<returncode>0</returncode>\n<output>')
def parse_write(command):
    if len(command.encode())>65536:return None
    match=WRITE.fullmatch(command)
    if not match or not safe_path(match[2]) or match[1] in match[3].splitlines():return None
    return {'path':match[2],'body':match[3]+'\n'}
def pure_python(command):
    try:args=shlex.split(command)
    except ValueError:return None
    return args if len(args)==2 and args[0] in ['python','python3','python3.10','python3.11','python3.12'] and safe_path(args[1]) else None

def plan_script_run(command,observation,registered_interpreter=None):
    write=parse_write(command)
    if not write or not success(observation):return None
    if registered_interpreter not in ['python','python3','python3.10','python3.11','python3.12']:return None
    return {'argv':[registered_interpreter,write['path']],'sha256':hashlib.sha256(write['body'].encode()).hexdigest(),'requiresExplicitRunAfterWritePolicy':True,'requiresCurrentFileHashCheck':True,'executionTimeoutSeconds':10,'maxOutputBytes':16000}

def stats(events):return {'events':len(events),'issues':len({e['issue'] for e in events}),'repoBaseGroups':len({e['group'] for e in events})}
def mine(input_path,output_dir):
    rows=[]
    for line in input_path.open():
        row=json.loads(line)
        if row['harness']=='mini-swe-agent-plus' and row['partition']=='discovery':rows.append(row)
    candidates={k:[] for k in ['write_then_run','source_edit_then_rerun','compact_edit_wrapper','terminal_handoff']}
    turn_count=sum(len(r['turns']) for r in rows);action_count=sum(len(t['actions']) for r in rows for t in r['turns']);unsupported=sum(r['unsupportedActionTurns'] for r in rows)
    for r in rows:
        last_script=None
        for i,t in enumerate(r['turns']):
            if len(t['actions'])!=1:continue
            action=t['actions'][0];cmd=action.get('command') or '';obs='\n'.join(x['content'] for x in action.get('results',[]));base={'issue':r['instanceId'],'group':r['groupKey'],'record':r['id'],'ordinal':i}
            # Fixed policy: the harness's default Python command is registered.
            # Both proposals are formed before the future command is inspected.
            write_plan=plan_script_run(cmd,obs,'python')
            edit=EDIT.fullmatch(cmd);rerun_plan=last_script if edit and last_script and safe_path(edit[3]) and edit[3]!=last_script[-1] and not pathlib.PurePosixPath(edit[3]).name.startswith('test_') and success(obs) and last_script else None
            nxt=r['turns'][i+1] if i+1<len(r['turns']) else None
            nextcmd=nxt['actions'][0].get('command','') if nxt and len(nxt['actions'])==1 else ''
            next_script=pure_python(nextcmd)
            nextobs='\n'.join(x['content'] for x in nxt['actions'][0].get('results',[])) if nxt and len(nxt['actions'])==1 else ''
            rc=re.match(r'<returncode>(-?\d+)</returncode>',nextobs)
            if write_plan:
                expected=write_plan['argv'];whole=next_script==expected
                fragment=bool(re.search(r'(?:^|&&\s*)'+re.escape(' '.join(expected))+r'(?:\s*&&|\s*$)',nextcmd))
                candidates['write_then_run'].append({**base,'path':expected[1],'wholeNextActionMatch':whole,'nextRunsSamePathDifferentInterpreter':bool(next_script and next_script[1]==expected[1] and not whole),'containsExpectedRunFragment':fragment,'nextObservedExitCode':int(rc[1]) if rc else None,'proposalArgumentBytes':len(json.dumps({'argv':expected},separators=(',',':')).encode())})
            if rerun_plan:
                candidates['source_edit_then_rerun'].append({**base,'wholeNextActionMatch':next_script==rerun_plan,'containsExpectedRunFragment':bool(re.search(r'(?:^|&&\s*)'+re.escape(' '.join(rerun_plan))+r'(?:\s*&&|\s*$)',nextcmd))})
            if edit:
                original=len(json.dumps({'command':cmd},separators=(',',':')).encode());compact=len(json.dumps({'p':edit[3],'o':edit[1],'n':edit[2]},separators=(',',':')).encode())
                candidates['compact_edit_wrapper'].append({**base,'originalArgumentBytes':original,'compactArgumentBytes':compact,'existingToolAlreadyDoesReplacement':True})
            if 'MINI_SWE_AGENT_FINAL_OUTPUT' in cmd:
                candidates['terminal_handoff'].append({**base,'exactStandardCommand':cmd==FINISH,'hasCleanup':cmd.startswith('rm '),'isLastTurn':i==len(r['turns'])-1})
            current=pure_python(cmd)
            if current:last_script=current
    summary={}
    for name,events in candidates.items():
        item=stats(events)
        if name in ['write_then_run','source_edit_then_rerun']:
            matched=[e for e in events if e['wholeNextActionMatch']];item['wholeNextActionMatches']=stats(matched);item['substepOnlyMatches']=sum(e['containsExpectedRunFragment'] and not e['wholeNextActionMatch'] for e in events)
        if name=='write_then_run':item['wholeMatchExitZero']=sum(e['wholeNextActionMatch'] and e['nextObservedExitCode']==0 for e in events);item['wholeMatchExitNonzero']=sum(e['wholeNextActionMatch'] and e['nextObservedExitCode'] is not None and e['nextObservedExitCode']!=0 for e in events);item['wholeMatchExitUnknown']=sum(e['wholeNextActionMatch'] and e['nextObservedExitCode'] is None for e in events);item['differentInterpreterSamePath']=sum(e['nextRunsSamePathDifferentInterpreter'] for e in events);item['proposalArgumentBytes']=sum(e['proposalArgumentBytes'] for e in events)
        if name=='compact_edit_wrapper':item['originalArgumentBytes']=sum(e['originalArgumentBytes'] for e in events);item['compactArgumentBytes']=sum(e['compactArgumentBytes'] for e in events)
        if name=='terminal_handoff':item['exactStandardCommand']=sum(e['exactStandardCommand'] for e in events);item['cleanupVariants']=sum(e['hasCleanup'] for e in events);item['lastTurns']=sum(e['isLastTurn'] for e in events)
        summary[name]=item
    report={'denominator':{'records':len(rows),'issues':len({r['instanceId'] for r in rows}),'repoBaseGroups':len({r['groupKey'] for r in rows}),'assistantTurns':turn_count,'actions':action_count,'unsupportedActionTurns':unsupported},'scope':'Public mini-swe-agent-plus discovery records only','summary':summary,'events':candidates,'limitations':['Synthetic issue variants share repository/base groups; counts are not independent trials.','Reported outcomes, model identities, token usage, latency and costs are absent.','Assistant turns are not measured API query counts.','Source observations are inert evidence; no imported commands executed and no bug success independently verified.','Write-run policy fixes registered interpreter python before labels; runtime must register actual environment and require explicit opt-in.','A file write is not authorization to execute arbitrary code; planner stays inactive without explicit run-after-write policy.','Whole-next-command matches are observational opportunities, not causally proven calls saved.','Script hash must be checked before execution and may be stale; script contents are not statically proven safe.','Terminal handoff needs explicit completion intent; cannot infer completion from previous test success.','Compact edit utility already exists; replacing its shell wrapper may reduce generated bytes, not a whole turn.','Byte comparisons include argument JSON, exclude tool names/schema, and do not establish token savings.']}
    output_dir.mkdir(parents=True,exist_ok=True);(output_dir/'report.json').write_text(json.dumps(report,indent=2));(output_dir/'report.json').chmod(0o600)
    print(json.dumps({'denominator':report['denominator'],'summary':summary},indent=2))
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input',type=pathlib.Path,required=True);parser.add_argument('--output',type=pathlib.Path,required=True);args=parser.parse_args();mine(args.input,args.output)
