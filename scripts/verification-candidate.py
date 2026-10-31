"""Discovery-only, non-executing analysis of verification packet opportunities."""
import ast,json,pathlib,re,shlex
ROOT=pathlib.Path('data/analysis/verification-candidate-v1')
snapshot=json.load(open('data/experiments/router-all-traces-v2/snapshot.json'))
assign=json.load(open('data/experiments/router-all-traces-v2/report.json'))['assignments']

def invocations(command):
    # Observational extraction, never execution. Embedded Python is parsed, not run.
    calls=[]
    blocks=list(re.finditer(r"(?:python|python3)\s+-\s+<<['\"]?(\w+)['\"]?\n(.*?)\n\1(?=\n|$)",command,re.S))
    shell=command
    for match in reversed(blocks):
        shell=shell[:match.start()]+shell[match.end():]
        try: tree=ast.parse(match[2])
        except SyntaxError: continue
        for node in ast.walk(tree):
            if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and isinstance(node.func.value,ast.Name) and node.func.value.id=='pytest' and node.func.attr=='main' and node.args:
                try: args=ast.literal_eval(node.args[0])
                except (ValueError,TypeError): continue
                if isinstance(args,list) and all(isinstance(a,str) for a in args): calls.append({'kind':'python_wrapper','argv':args})
    for match in re.finditer(r'(?:^|[;\n])\s*(?:python(?:3)?\s+-m\s+)?pytest\s+([^;\n]+)',shell):
        try: tokens=shlex.split(match[1])
        except ValueError: continue
        argv=[]
        for token in tokens:
            if token in ['>','>>','|','&&','||'] or re.match(r'^\d*>',token): break
            argv.append(token)
        if '--version' not in argv: calls.append({'kind':'cli','argv':argv})
    return calls

# Parser fixture checks: only extract, never run these commands.
assert invocations("python -m pytest tests/test_x.py -q 2>&1 | tail -1; git diff --check") == [{'kind':'cli','argv':['tests/test_x.py','-q']}]
assert invocations("python -m pytest --version") == []
assert invocations("python - <<'PY'\nimport pytest\nraise SystemExit(pytest.main(['-q', 'tests/test_x.py']))\nPY")[0]['argv'] == ['-q','tests/test_x.py']
assert invocations("python - <<'PY'\nimport pytest\npytest.main(args)\nPY") == []

def signature(call):
    # Exact argv only. Output truncation wrappers excluded, selection/flags retained.
    return json.dumps(call['argv'])

def commands(t): return '\n'.join(a.get('command') or '' for a in t['actions'])

events=[]
for run in snapshot['runs']:
    if run['arm']!='baseline' or assign[run['instanceId']] not in [2,3,4]:continue
    prior=[]
    for i,t in enumerate(run['turns']):
        if not t['valid']:continue
        cmd=commands(t); tests=invocations(cmd)
        if {'test-run','diff-review'}.issubset(t['tags']) and 'edit' not in t['tags']:
            mutation=bool(re.search(r'git stash|\.write_bytes\(',cmd))
            nxt=run['turns'][i+1] if i+1<len(run['turns']) else None
            category='baseline_comparison_mutates_workspace' if mutation else 'custom_python_test_wrapper' if any(x['kind']=='python_wrapper' for x in tests) else 'plain_cli_test'
            events.append({'issue':run['instanceId'],'traceId':t['id'],'category':category,'testCalls':tests,'anyExactArgvSeenBefore':bool(tests) and any(signature(x) in prior for x in tests),'allExactArgvSeenBefore':bool(tests) and all(signature(x) in prior for x in tests),'nextIsFinalAnswer':bool(nxt and nxt['finalAnswer'] and not nxt['actions']),'fullSuiteCli':category=='plain_cli_test' and bool(tests) and all(all(a.startswith('-') for a in x['argv']) for x in tests)})
        prior.extend(signature(x) for x in tests)
summary={'observations':len(events),'distinctIssues':len({e['issue'] for e in events}),'categories':{c:sum(e['category']==c for e in events) for c in sorted({e['category'] for e in events})},'anyExactArgvSeenBefore':sum(e['anyExactArgvSeenBefore'] for e in events),'allExactArgvSeenBefore':sum(e['allExactArgvSeenBefore'] for e in events),'nonmutatingExactArgvSeenBefore':sum(e['allExactArgvSeenBefore'] and e['category']!='baseline_comparison_mutates_workspace' for e in events),'fullSuiteCli':sum(e['fullSuiteCli'] for e in events),'followedByFinalAnswer':sum(e['nextIsFinalAnswer'] for e in events)}
report={'scope':'baseline discovery folds 2,3,4 only','summary':summary,'events':events,'programDesign':{'input':'Explicit previously registered test argv + repository root + patch fingerprint','output':'Structured actual test exit status, bounded output, git diff --check, diff --stat, bounded diff, status','trigger':'Explicit verify request or calibrated completion classifier; no completion inferred solely from successful test','abstain':['Unregistered test selection','Python wrappers that change runtime data sources','Original/patched workspace swaps','Ambiguous environment or test configuration']},'limitations':['Counts are observations, not saved calls.','Tag no-edit is not reliable: 3 baseline-comparison turns mutate working tree.','Historical identical test argv does not prove identical environment or setup.','Whole-call substitution also requires predicting verification timing and retaining model review.','No commands executed, no paid calls, no heldout inspected.']}
ROOT.mkdir(parents=True,exist_ok=True);(ROOT/'report.json').write_text(json.dumps(report,indent=2));(ROOT/'report.json').chmod(0o600)
print(json.dumps(summary,indent=2))
for e in events:print(e['issue'],e['category'],e['allExactArgvSeenBefore'],e['fullSuiteCli'])
