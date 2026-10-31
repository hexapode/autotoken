"""Conservative offline pytest failed-node planner; never executes commands."""
import re,shlex
MAX_NODES=8
NODE=re.compile(r'[A-Za-z0-9_./-]+\.py(?:::[A-Za-z_][A-Za-z0-9_]*(?:\[[A-Za-z0-9_.,=+-]+\])?)+$')

def strip_heredocs(command):
    lines=command.splitlines();out=[];marker=None
    for line in lines:
        if marker:
            if line==marker:marker=None
            continue
        match=re.search(r"<<\s*['\"]?(\w+)['\"]?",line)
        if match:marker=match[1];continue
        out.append(line)
    return '\n'.join(out) if marker is None else None

def pytest_calls(command):
    shell=strip_heredocs(command)
    if shell is None:return []
    try:
        lex=shlex.shlex(shell,posix=True,punctuation_chars=';|&\n<>');lex.whitespace=' \t\r';lex.whitespace_split=True
        tokens=list(lex)
    except ValueError:return []
    segments=[];current=[]
    for token in tokens:
        if token and all(c in ';|&\n<>' for c in token):
            if current:segments.append(current)
            current=[]
        else:current.append(token)
    if current:segments.append(current)
    calls=[]
    for s in segments:
        if s[:3] in [['python','-m','pytest'],['python3','-m','pytest']]:prefix=s[:3];args=s[3:]
        elif s and s[0]=='pytest':prefix=['pytest'];args=s[1:]
        else:continue
        # Redirection's fd can remain a token immediately before a separator.
        if args and args[-1]=='2':args=args[:-1]
        if '--version' not in args:calls.append({'prefix':prefix,'args':args})
    return calls

def node_selection(args):
    return [a for a in args if NODE.fullmatch(a) and '..' not in a.split('::')[0].split('/')]

def plan(command,result):
    calls=pytest_calls(command)
    if len(calls)!=1:return {'status':'abstain','reason':'requires exactly one recognizable pytest invocation'}
    if 'pytest.main' in command or 'git stash' in command or ('HEAD:' in command and 'write_bytes' in command):return {'status':'abstain','reason':'custom environment or original/patched comparison'}
    if not re.match(r'^Exit code: \d+; timed out: false\n',result):return {'status':'abstain','reason':'missing completed-tool evidence'}
    if result.count('test session starts')>1 or len(re.findall(r'^=+ .*\d+ failed.*=+$',result,re.M))>1:return {'status':'abstain','reason':'multiple pytest sessions'}
    if re.search(r'\b(?:truncated|omitted)\b',result,re.I):return {'status':'abstain','reason':'possibly truncated evidence'}
    nodes=[]
    for line in result.splitlines():
        if not line.startswith('FAILED '):continue
        node=line[7:].split(' - ',1)[0].strip()
        if not NODE.fullmatch(node) or node.startswith('/') or '..' in node.split('::')[0].split('/'):return {'status':'abstain','reason':'unsupported or incomplete failed node ID'}
        if node not in nodes:nodes.append(node)
    if not nodes:return {'status':'abstain','reason':'no supported failed node IDs'}
    if len(nodes)>MAX_NODES:return {'status':'abstain','reason':'too many failure IDs'}
    # Preserve only known presentation/execution flags; selection is replaced by
    # explicit failed nodes. Unknown options could change test environment.
    flags=[];args=calls[0]['args'];i=0
    while i<len(args):
        arg=args[i]
        if arg in ['-q','-x','--disable-warnings','--tb=short','--tb=line','--tb=long']:flags.append(arg)
        elif arg in ['-k']:
            i+=1
            if i>=len(args):return {'status':'abstain','reason':'incomplete selector'}
        elif arg.startswith('-') or '$' in arg or '`' in arg:return {'status':'abstain','reason':'unknown flags or expansion'}
        elif not re.fullmatch(r'[A-Za-z0-9_./:\[\],=+-]+',arg):return {'status':'abstain','reason':'unsupported test operand'}
        i+=1
    argv=calls[0]['prefix']+nodes+flags
    return {'status':'planned','nodes':nodes,'argv':argv,'requiresRegisteredEnvironment':True,'requiresConfirmedPatchChange':True,'source':'completed prior pytest failure summary'}
