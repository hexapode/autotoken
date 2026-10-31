"""Static AST recognizer. Never eval, execute, import, or read trace file paths."""
import ast,json,re,pathlib,collections
class Unsupported(Exception):pass
class Text:
 def __init__(self,path,ops=None):self.path=path;self.ops=ops or []
def recognize(source):
 env={};writes=[]
 def val(n):
  if isinstance(n,ast.Constant) and type(n.value) in (str,int):return n.value
  if isinstance(n,ast.Name) and n.id in env:return env[n.id]
  if isinstance(n,ast.BinOp) and isinstance(n.op,ast.Add):
   a,b=val(n.left),val(n.right)
   if isinstance(a,str) and isinstance(b,str):return a+b
  if isinstance(n,ast.Call) and not n.keywords:
   if isinstance(n.func,ast.Name) and n.func.id=='Path' and len(n.args)==1:
    x=val(n.args[0])
    if isinstance(x,str):return ('path',x)
   if isinstance(n.func,ast.Name) and n.func.id=='open' and len(n.args) in (1,2):
    x=val(n.args[0]);mode=val(n.args[1]) if len(n.args)==2 else 'r'
    if isinstance(x,str) and mode in ('r','w'):return ('open',x,mode)
   if isinstance(n.func,ast.Attribute):
    receiver=val(n.func.value);method=n.func.attr
    if method=='read_text' and not n.args and isinstance(receiver,tuple) and receiver[0]=='path':return Text(receiver[1])
    if method=='read' and not n.args and isinstance(receiver,tuple) and receiver[0]=='open' and receiver[2]=='r':return Text(receiver[1])
    if method=='replace' and isinstance(receiver,Text) and len(n.args) in (2,3):
     old,new=val(n.args[0]),val(n.args[1]);limit=val(n.args[2]) if len(n.args)==3 else None
     if isinstance(old,str) and old and isinstance(new,str) and limit is None and max(len(old.encode()),len(new.encode()))<=65536:
      return Text(receiver.path,receiver.ops+[{'old':old,'new':new}])
    if method in ('write','write_text') and len(n.args)==1:
     text=val(n.args[0]);path=receiver[1] if isinstance(receiver,tuple) else None
     valid=(method=='write_text' and receiver[0]=='path') or (method=='write' and receiver[0]=='open' and receiver[2]=='w') if isinstance(receiver,tuple) else False
     if valid and isinstance(text,Text) and text.path==path and text.ops:
      parts=path.split('/')
      if any(p in ('','.','..') or p.startswith('.') or '\\' in p for p in parts):raise Unsupported()
      writes.append({'path':path,'replacements':text.ops});return None
  raise Unsupported()
 for stmt in ast.parse(source).body:
  if isinstance(stmt,ast.ImportFrom) and stmt.module=='pathlib' and all(a.name=='Path' and not a.asname for a in stmt.names):continue
  if isinstance(stmt,ast.Assign) and len(stmt.targets)==1 and isinstance(stmt.targets[0],ast.Name):env[stmt.targets[0].id]=val(stmt.value)
  elif isinstance(stmt,ast.Expr):val(stmt.value)
  elif isinstance(stmt,ast.Assert):
   # Accept only static occurrence/membership assertions; do not claim they
   # supply a current content hash or enforce the new program's exact count.
   test=stmt.test
   if not isinstance(test,ast.Compare) or len(test.ops)!=1:raise Unsupported()
   if isinstance(test.ops[0],ast.In):
    if not isinstance(val(test.left),str) or not isinstance(val(test.comparators[0]),Text):raise Unsupported()
   elif isinstance(test.ops[0],ast.Eq):
    call=test.left
    if not isinstance(call,ast.Call) or not isinstance(call.func,ast.Attribute) or call.func.attr!='count' or len(call.args)!=1 or call.keywords or not isinstance(val(call.func.value),Text) or not isinstance(val(call.args[0]),str) or type(val(test.comparators[0])) is not int:raise Unsupported()
   else:raise Unsupported()
  else:raise Unsupported()
 if not writes:raise Unsupported()
 return writes
s=json.load(open('data/experiments/router-all-traces-v2/snapshot.json'));folds=json.load(open('data/experiments/router-all-traces-v2/report.json'))['assignments']
pattern=re.compile(r"(?:^|\n)python(?:3)?\s+-\s+<<\s*['\"]?(\w+)['\"]?\s*\n(.*?)\n\1(?=\n|$)",re.S)
rows=[];opportunities=[];blocks=0
for run in s['runs']:
 if run['arm']!='baseline' or folds[run['instanceId']] not in (2,3,4):continue
 for turn in run['turns']:
  if not turn['valid']:continue
  command='\n'.join(a.get('command')or'' for a in turn['actions'])
  if '.replace(' not in command or not re.search(r'write_text\(|\.write\(|open\([^\n]+[\"\']w[\"\']',command):continue
  opportunities.append({'issue':run['instanceId'],'traceId':turn['id']})
  matches=list(pattern.finditer(command));supported=[]
  for m in matches:
   if '.replace(' not in m[2]:continue
   blocks+=1
   try:
    writes=recognize(m[2]);payload={'edits':[{'path':w['path'],'replacements':[{**o,'expected_count':'REQUIRED'} for o in w['replacements']],'expected_sha256':'REQUIRED'} for w in writes]}
    supported.append({'writes':writes,'scriptBytes':len(m[2].encode()),'operationJsonBytes':len(json.dumps(payload,separators=(',',':'),ensure_ascii=False).encode())})
   except (Unsupported,SyntaxError,TypeError,IndexError):pass
  if supported:rows.append({'issue':run['instanceId'],'traceId':turn['id'],'supportedBlocks':supported,'mixedWithOtherCommands':bool(pattern.sub('',command).strip()),'preEditFingerprintVerified':False,'occurrenceCountVerified':False})
summary={'opportunityTurns':len(opportunities),'opportunityIssues':len(set(x['issue'] for x in opportunities)),'replacementHeredocBlocks':blocks,'supportedTurns':len(rows),'supportedIssues':len(set(x['issue'] for x in rows)),'supportedBlocks':sum(len(x['supportedBlocks']) for x in rows),'supportedReplacementOperations':sum(len(w['replacements']) for r in rows for b in r['supportedBlocks'] for w in b['writes']),'supportedTurnsMixedWithOtherCommands':sum(x['mixedWithOtherCommands'] for x in rows),'scriptBytes':sum(b['scriptBytes'] for r in rows for b in r['supportedBlocks']),'operationJsonBytesWithRequiredGuardPlaceholders':sum(b['operationJsonBytes'] for r in rows for b in r['supportedBlocks'])}
out=pathlib.Path('data/analysis/guarded-edit-v1');out.mkdir(parents=True,exist_ok=True);(out/'report.json').write_text(json.dumps({'summary':summary,'scope':'baseline discovery folds2/3/4 only','rows':rows,'limitations':['Static literal syntax support only; recorded code never executed.','Historical occurrence counts and pre-edit content fingerprints are unverified.','Model must still provide edit intent; zero model-call savings established.','Multiple writes are sequential operations, not a multi-file atomic transaction.','JSON contains required guard placeholders; real hashes/counts and surrounding API envelope add bytes.','Byte comparison is not token usage or causal savings.','Prototype requires serialized workspace writes; fingerprint checks are not concurrent compare-and-swap.']},indent=2));(out/'report.json').chmod(0o600)
print(json.dumps(summary,indent=2))
