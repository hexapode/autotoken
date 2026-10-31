import importlib.util,tempfile,pathlib,hashlib,os
spec=importlib.util.spec_from_file_location('program',pathlib.Path(__file__).with_name('guarded-edit-program.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
sha=lambda b:hashlib.sha256(b).hexdigest()
with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside:
 r=pathlib.Path(root);f=r/'sample.py';original=b'alpha alpha\n';f.write_bytes(original)
 def rejected(path='sample.py',**kw):
  args=dict(old='alpha',new='beta',expected_count=2,expected_sha256=sha(original));args.update(kw)
  try:p.guarded_edit(root,path,**args)
  except (ValueError,OSError,UnicodeError):pass
  else:raise AssertionError('Expected rejection')
  assert f.read_bytes()==original
 rejected(expected_count=1);rejected(expected_sha256='0'*64);rejected(old='');rejected('../escape');rejected('/tmp/escape');rejected('.env');rejected(new='x'*65537)
 target=pathlib.Path(outside)/'target.py';target.write_bytes(original)
 (r/'linked.py').symlink_to(target);rejected('linked.py')
 (r/'linked-dir').symlink_to(outside,target_is_directory=True);rejected('linked-dir/target.py')
 os.link(f,r/'hard.py');rejected();(r/'hard.py').unlink()
 large=r/'large.py';large.write_bytes(b'x'*(p.MAX_FILE+1));rejected('large.py')
 fifo=r/'fifo';os.mkfifo(fifo);rejected('fifo')
 os.chmod(f,0o640);before=f.stat().st_ino
 previous_umask=os.umask(0o077)
 result=p.guarded_edit(root,'sample.py','alpha','βeta',2,sha(original))
 os.umask(previous_umask)
 assert f.read_text()=='βeta βeta\n' and result['replacements']==2
 assert f.stat().st_ino!=before and f.stat().st_mode&0o777==0o640
 assert target.read_bytes()==original and not list(r.glob('.autotoken-edit-*'))
 print('13 rejection cases (including FIFO) preserve target; exact UTF-8 replacement, atomic rename, permissions and temp cleanup passed')
