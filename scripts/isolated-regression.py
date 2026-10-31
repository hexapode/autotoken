"""Bounded original/patched comparison for trusted local repositories and tests.

Temporary copies protect the input worktree from normal test writes, not malicious
code: this is not an OS sandbox. Explicit test argv is never passed to a shell.
"""
import hashlib,os,pathlib,selectors,signal,stat,subprocess,tarfile,tempfile,time


def execute(argv,cwd,timeout=10,max_output=32768):
    if not isinstance(argv,list) or not argv or not all(isinstance(a,str) and '\0' not in a for a in argv):raise ValueError('Explicit argv required')
    if not pathlib.Path(argv[0]).is_absolute():raise ValueError('Executable must be absolute')
    if not 0<timeout<=60 or not 0<max_output<=200000:raise ValueError('Invalid execution bounds')
    env={'PATH':'/usr/bin:/bin:/usr/local/bin','HOME':str(cwd),'LC_ALL':'C','PYTHONDONTWRITEBYTECODE':'1','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_OPTIONAL_LOCKS':'0'}
    p=subprocess.Popen(argv,cwd=cwd,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
    sel=selectors.DefaultSelector();sel.register(p.stdout,selectors.EVENT_READ);chunks=[];size=0;timed_out=False;truncated=False;deadline=time.monotonic()+timeout
    try:
        while sel.get_map():
            if time.monotonic()>=deadline:timed_out=True;break
            for key,_ in sel.select(min(.1,max(0,deadline-time.monotonic()))):
                chunk=os.read(key.fileobj.fileno(),8192)
                if not chunk:sel.unregister(key.fileobj);continue
                remaining=max_output-size;chunks.append(chunk[:remaining]);size+=min(len(chunk),remaining)
                if len(chunk)>remaining:truncated=True;break
            if truncated:break
        if not timed_out and not truncated:
            try:p.wait(timeout=max(.001,deadline-time.monotonic()))
            except subprocess.TimeoutExpired:timed_out=True
    finally:
        # Also remove descendants that retained pipes or survived their parent.
        try:os.killpg(p.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        p.wait();sel.close();p.stdout.close()
    return {'exitCode':p.returncode,'timedOut':timed_out,'truncated':truncated,'output':b''.join(chunks).decode('utf8','replace')}


def safe_path(name):
    p=pathlib.PurePosixPath(name)
    if not name or p.is_absolute() or '..' in p.parts or '.git' in p.parts or '\\' in name or str(p)!=name:raise ValueError('Unsafe relative path')
    return p


def compare(repo,base_commit,regressions,argv,*,added_files=(),timeout=10,max_files=2000,max_bytes=20_000_000,max_output=32768):
    repo=pathlib.Path(repo).resolve()
    if not (repo/'.git').exists():raise ValueError('Repository top level required')
    if not isinstance(base_commit,str) or not __import__('re').fullmatch('[0-9a-f]{40}',base_commit):raise ValueError('Full base commit required')
    if not 0<timeout<=60 or not 0<max_files<=5000 or not 0<max_bytes<=50_000_000 or not 0<max_output<=200000:raise ValueError('Invalid bounds')
    if not regressions:raise ValueError('Explicit regression files required')
    for name,content in regressions.items():
        p=safe_path(name)
        if not ('tests' in p.parts or p.name.startswith('test_')) or not isinstance(content,bytes):raise ValueError('Explicit test bytes required')
    if len(regressions)>max_files or sum(map(len,regressions.values()))>max_bytes:raise ValueError('Regression snapshot limit exceeded')
    # Read only a bounded Git archive. Git hooks and external filters are not run.
    with tempfile.TemporaryDirectory(prefix='autotoken-regression-') as tmp:
        tmp=pathlib.Path(tmp);archive=tmp/'base.tar'
        with archive.open('wb') as stream:
            proc=subprocess.Popen(['/usr/bin/git','-c','core.fsmonitor=false','archive','--format=tar',base_commit],cwd=repo,stdout=stream,stderr=subprocess.DEVNULL,env={'PATH':'/usr/bin:/bin','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'},start_new_session=True)
            deadline=time.monotonic()+timeout
            while proc.poll() is None:
                if time.monotonic()>deadline or archive.stat().st_size>max_bytes+max_files*2048:
                    os.killpg(proc.pid,signal.SIGKILL);proc.wait();raise ValueError('Archive limit exceeded')
                time.sleep(.01)
            if proc.returncode:raise ValueError('Base archive unavailable')
        original={};total=0
        with tarfile.open(archive) as tar:
            for member in tar:
                name=member.name.rstrip('/');safe_path(name)
                if member.isdir():continue
                if not member.isfile():raise ValueError('Symlinks/submodules unsupported')
                total+=member.size
                if len(original)>=max_files or total>max_bytes:raise ValueError('Snapshot limit exceeded')
                original[name]=tar.extractfile(member).read()
        patched={};patched_bytes=0
        for name in sorted(set(original)|set(added_files)):
            safe_path(name);path=repo/name
            # Inspect every component to reject symlink escapes.
            current=repo
            for part in pathlib.PurePosixPath(name).parts:
                current=current/part
                if current.is_symlink():raise ValueError('Symlink worktree path unsupported')
            if not path.exists():continue
            info=path.stat()
            if not stat.S_ISREG(info.st_mode):raise ValueError('Nonregular worktree file')
            patched_bytes+=info.st_size
            if patched_bytes>max_bytes:raise ValueError('Snapshot limit exceeded')
            patched[name]=path.read_bytes()
        if len(patched)>max_files or sum(map(len,patched.values()))>max_bytes:raise ValueError('Snapshot limit exceeded')
        hashes={k:hashlib.sha256(v).hexdigest() for k,v in regressions.items()}
        results={}
        for label,files in [('original',original),('patched',patched)]:
            files={**files,**regressions}
            if len(files)>max_files or sum(map(len,files.values()))>max_bytes:raise ValueError('Regression snapshot limit exceeded')
            dest=tmp/label;dest.mkdir()
            for name,content in files.items():
                path=dest/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(content)
            result=execute(argv,dest,timeout,max_output)
            result['regressionHashes']=hashes.copy()
            result['regressionUnchangedAfterRun']=all(not (dest/name).is_symlink() and (dest/name).is_file() and (dest/name).stat().st_size==len(regressions[name]) and hashlib.sha256((dest/name).read_bytes()).hexdigest()==digest for name,digest in hashes.items())
            results[label]=result
        ok=lambda r:not r['timedOut'] and not r['truncated'] and r['regressionUnchangedAfterRun']
        results['baseFailsPatchedPasses']=all(ok(r) for r in results.values()) and results['original']['exitCode']>0 and results['patched']['exitCode']==0
        results['interpretation']='Exit-code contrast only: inspect failure evidence to distinguish bug reproduction from environment failure.'
        return results
