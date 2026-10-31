"""Discovery-only AST audit; no recorded Python code or imports are executed."""
import ast,collections,json,pathlib,re
HEREDOC=re.compile(r"(?:^|[;\n])\s*python(?:3)?\s+-\s+<<\s*['\"]?(\w+)['\"]?\s*\n(.*?)\n\1(?=\n|$)",re.S)
INSPECT_METHODS={'signature','getsource','getfile','getsourcefile','getmodule','getmembers'}

def audit(source):
 tree=ast.parse(source);imports={};calls=[];writes=[]
 for n in ast.walk(tree):
  if isinstance(n,ast.Import):
   for alias in n.names:imports[alias.asname or alias.name]=alias.name
  if isinstance(n,ast.ImportFrom):
   for alias in n.names:imports[alias.asname or alias.name]=(n.module or '')+'.'+alias.name
 for n in ast.walk(tree):
  if isinstance(n,ast.Attribute) and n.attr=='__file__':calls.append('module_location')
  if not isinstance(n,ast.Call):continue
  name=n.func.id if isinstance(n.func,ast.Name) else n.func.attr if isinstance(n.func,ast.Attribute) else ''
  if name in ('write','write_text','write_bytes','unlink','remove','rename','replace'):
   # replace() may be string-only; conservatively disqualify it from read-only.
   writes.append(name)
  if name=='open':
   mode=n.args[1] if len(n.args)>1 else next((k.value for k in n.keywords if k.arg=='mode'),None)
   if isinstance(mode,ast.Constant) and isinstance(mode.value,str) and any(x in mode.value for x in 'wax+'):writes.append('open_write')
  if isinstance(n.func,ast.Attribute) and isinstance(n.func.value,ast.Name):
   if imports.get(n.func.value.id)=='inspect' and name in INSPECT_METHODS:calls.append('inspect.'+name)
   elif imports.get(n.func.value.id)=='typing' and name=='get_type_hints':calls.append('typing.get_type_hints')
  elif isinstance(n.func,ast.Name):
   qualified=imports.get(name,name)
   if qualified.startswith('inspect.') and qualified.split('.')[-1] in INSPECT_METHODS:calls.append(qualified)
   elif qualified=='typing.get_type_hints':calls.append(qualified)
   elif name in ('type','dir','getattr'):calls.append('builtin.'+name)
 return {'inspectionCalls':calls,'possibleWrites':sorted(set(writes))}

def main():
 snapshot=json.load(open('data/experiments/router-all-traces-v2/snapshot.json'));folds=json.load(open('data/experiments/router-all-traces-v2/report.json'))['assignments']
 blocks=[];errors=0;runs=0;decisions=0
 for run in snapshot['runs']:
  if run['arm']!='baseline' or folds[run['instanceId']] not in (2,3,4):continue
  runs+=1
  for turn in run['turns']:
   if not turn['valid']:continue
   decisions+=1;command='\n'.join(a.get('command')or'' for a in turn['actions'])
   for m in HEREDOC.finditer(command):
    try:result=audit(m[2])
    except SyntaxError:errors+=1;continue
    blocks.append({'issue':run['instanceId'],'traceId':turn['id'],'scriptBytes':len(m[2].encode()),**result})
 readonly=[b for b in blocks if not b['possibleWrites']];interesting=[b for b in readonly if b['inspectionCalls']]
 groups={}
 for name in sorted(set(c for b in interesting for c in b['inspectionCalls'])):
  matches=[b for b in interesting if name in b['inspectionCalls']]
  groups[name]={'blocks':len(matches),'issues':len(set(b['issue'] for b in matches)),'scriptBytes':sum(b['scriptBytes'] for b in matches)}
 summary={'discoveryBaselineRuns':runs,'validDecisions':decisions,'parsedPythonHeredocBlocks':len(blocks),'syntaxErrors':errors,'blocksWithoutRecognizedWrites':len(readonly),'inspectionBearingBlocksWithoutRecognizedWrites':len(interesting),'inspectionIssues':len(set(b['issue'] for b in interesting)),'procedures':groups,'supportedASTOnlyInspectionProcedures':0}
 out=pathlib.Path('data/analysis/python-inspection-v1');out.mkdir(parents=True,exist_ok=True)
 report={'scope':'Baseline discovery folds2/3/4 only','summary':summary,'inspectionEvents':interesting,'decision':'Reject reusable Python inspection candidate for now: no repeated narrow procedure across independent issues; observed runtime MRO/type-hint checks are not equivalent to static AST source inspection.','limitations':['No recognized write call does not prove absence of side effects; imports/runtime calls may execute arbitrary code.','Heredoc syntax recognition excludes python -c, alternative launchers, dynamic delimiters and malformed scripts.','AST inspection identifies syntax only, not runtime equivalence.','Zero observed procedures matching safe static inspect.signature/getsource replacement; no compact invocation byte saving claimed.','No paid calls, heldout/calibration inspection, or recorded code execution.']}
 (out/'report.json').write_text(json.dumps(report,indent=2));(out/'report.json').chmod(0o600);print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
