"""Experimental exact-text edit for a quiescent workspace; no shell execution.

Fingerprint checks detect stale inputs. They are not an atomic compare-and-swap
against an uncooperative concurrent writer. Callers must serialize workspace
writes. Directory FDs and O_NOFOLLOW prevent following symlinks.
"""
import hashlib, os, secrets, stat
MAX_FILE = 1024 * 1024
MAX_FRAGMENT = 65536

def guarded_edit(root, relative_path, old, new, expected_count, expected_sha256):
    if not isinstance(relative_path, str) or not relative_path or relative_path.startswith('/'):
        raise ValueError('Relative path required')
    parts = relative_path.split('/')
    if any(p in ('', '.', '..') or p.startswith('.') or '\\' in p or '\x00' in p for p in parts):
        raise ValueError('Unsupported path')
    if not isinstance(old, str) or not old or not isinstance(new, str):
        raise ValueError('Nonempty old text and string replacement required')
    if max(len(old.encode()), len(new.encode())) > MAX_FRAGMENT:
        raise ValueError('Fragment exceeds limit')
    if type(expected_count) is not int or not 1 <= expected_count <= 100:
        raise ValueError('Explicit occurrence count required')
    if not isinstance(expected_sha256, str) or len(expected_sha256) != 64 or any(c not in '0123456789abcdef' for c in expected_sha256):
        raise ValueError('SHA256 required')
    fds=[]; temp=None
    try:
        directory=os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW); fds.append(directory)
        for component in parts[:-1]:
            directory=os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory); fds.append(directory)
        fd=os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory); fds.append(fd)
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > MAX_FILE:
            raise ValueError('Unsupported file')
        data=os.read(fd, MAX_FILE+1)
        if len(data)>MAX_FILE or hashlib.sha256(data).hexdigest()!=expected_sha256:
            raise ValueError('Content fingerprint mismatch')
        text=data.decode('utf-8')
        if '\x00' in text or text.count(old)!=expected_count:
            raise ValueError('Text/occurrence guard failed')
        result=text.replace(old,new).encode('utf-8')
        if len(result)>MAX_FILE: raise ValueError('Result exceeds limit')
        temp='.autotoken-edit-'+secrets.token_hex(16)
        out=os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, info.st_mode & 0o777, dir_fd=directory)
        try:
            os.fchmod(out, info.st_mode & 0o777)
            with os.fdopen(out,'wb') as stream:
                stream.write(result);stream.flush();os.fsync(stream.fileno())
        except BaseException: raise
        # Recheck identity and contents immediately before atomic rename. The
        # workspace must still exclude concurrent uncooperative writes.
        check=os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            now=os.fstat(check)
            current=os.read(check,MAX_FILE+1)
            if (now.st_dev,now.st_ino)!=(info.st_dev,info.st_ino) or current!=data:
                raise ValueError('File changed during edit')
        finally: os.close(check)
        os.replace(temp,parts[-1],src_dir_fd=directory,dst_dir_fd=directory);temp=None
        return {'replacements':expected_count,'sha256':hashlib.sha256(result).hexdigest(),'bytes':len(result)}
    finally:
        if temp is not None:
            try: os.unlink(temp,dir_fd=directory)
            except FileNotFoundError: pass
        for fd in reversed(fds): os.close(fd)
