"""Discovery-only retrospective test-file locator; never runs trace commands."""
import json,pathlib,re,subprocess,shlex,collections
POLICY={'maxSourceFiles':4,'maxSuggestions':4,'minimumSimilarity':0.5,'maxTreeBytes':4*1024*1024}
# Trusted local Git snapshots only: stdout is captured before size validation.
# The tree limit below is a post-read acceptance bound, not a process memory cap.
def git(repo,*args):
 return subprocess.run(['git','-C',str(repo),*args],check=True,capture_output=True,timeout=5).stdout

def file_tree(repo,commit):
 if not re.fullmatch('[a-f0-9]{40}',commit):raise ValueError('Invalid commit')
 raw=git(repo,'ls-tree','-rz',commit)
 if len(raw)>POLICY['maxTreeBytes']:raise ValueError('Tree too large')
 files=[]
 for entry in raw.decode().split('\0'):
  if not entry:continue
  meta,path=entry.split('\t',1)
  if meta.split()[0] in ('100644','100755'):files.append(path)
 return files

def is_test(path):return bool(re.match(r'(?:test_|unittest_).*\.py$',path.rsplit('/',1)[-1]))
def words(path):
 stem=path.rsplit('/',1)[-1][:-3]
 stem=re.sub(r'^(?:unittest_|test_)','',stem)
 return set(x.lower() for x in stem.split('_') if len(x)>=3)

def locate(source_files,tree,already_mentioned=()):
 valid=set(tree);tests=[p for p in tree if is_test(p)]
 sources=[]
 for p in source_files:
  if p in valid and not is_test(p) and p.endswith('.py') and not p.endswith('/__init__.py') and p not in sources:sources.append(p)
 sources=sources[:POLICY['maxSourceFiles']]
 ranked={}
 for source in sources:
  source_words=words(source)
  for test in tests:
   target_words=words(test);union=source_words|target_words
   score=len(source_words&target_words)/len(union) if union else 0
   if score>=POLICY['minimumSimilarity'] and test not in already_mentioned:ranked[test]=max(ranked.get(test,0),score)
 return [p for p,_ in sorted(ranked.items(),key=lambda x:(-x[1],x[0]))[:POLICY['maxSuggestions']]]

# Extract explicit file operands from recognized shell invocations only. Ignore
# Python heredoc bodies, wildcard operands, substitutions and path generation.
def requested_files(command):
 paths=[];skip=None
 for line in command.splitlines():
  if skip:
   if line.strip()==skip:skip=None
   continue
  heredoc=re.search(r'<<\s*[\"\x27]?(\w+)[\"\x27]?',line)
  if heredoc:skip=heredoc[1];continue
  for segment in re.split(r';|&&|\|\||\|',line):
   try:tokens=shlex.split(segment)
   except ValueError:continue
   if not tokens:continue
   recognized=tokens[0] in ('rg','grep','sed','cat','head','tail','pytest') or (tokens[0] in ('python','python3') and tokens[1:3]==['-m','pytest'])
   if not recognized:continue
   operands=tokens[1:]
   if tokens[0] in ('rg','grep'):
    positional=[];has_pattern=False;skip=False;bad=False
    for j,token in enumerate(operands):
     if skip:skip=False;continue
     if token in ('-e','--regexp'):
      has_pattern=True;skip=True;continue
     if token in ('-A','-B','-C','-m','--max-count','--glob','-g','--include','--exclude'):
      skip=True;continue
     if token.startswith('-'):
      if not re.fullmatch(r'-(?:[nriIEFHhwlvs]+|[ABCm]\d+)',token):bad=True
      continue
     positional.append(token)
    if bad:continue
    operands=positional if has_pattern else positional[1:]
   elif tokens[0]=='sed':
    # Only common sed -n RANGE FILE reads; do not interpret edit scripts.
    if len(tokens)!=4 or tokens[1]!='-n' or not re.fullmatch(r'\d+(?:,\d+)?p',tokens[2]):continue
    operands=tokens[3:]
   if tokens[0]=='pytest' or tokens[:3] in (['python','-m','pytest'],['python3','-m','pytest']):
    operands=tokens[1:] if tokens[0]=='pytest' else tokens[3:]
    filtered=[];skip=False
    for token in operands:
     if skip:skip=False;continue
     if token in ('-k','-m','-p','-n','--ignore','--ignore-glob','--maxfail','--tb','--rootdir','--confcutdir','--override-ini','-o'):skip=True;continue
     if token.startswith('-'):continue
     filtered.append(token)
    operands=filtered
   for token in operands:
    m=re.fullmatch(r'((?:[\w.-]+/)*[\w.-]+\.py)(?:::[\w\[\].-]+)*',token)
    if m and m[1] not in paths:paths.append(m[1])
 return paths

def run():
 s=json.load(open('data/experiments/router-all-traces-v2/snapshot.json'));folds=json.load(open('data/experiments/router-all-traces-v2/report.json'))['assignments']
 events=[];runs=0;errors=[]
 for run in s['runs']:
  if run['arm']!='baseline' or folds[run['instanceId']] not in (2,3,4):continue
  runs+=1
  try:
   task=json.load(open(pathlib.Path(run['directory'])/'task.json'));tree=file_tree(pathlib.Path(run['directory'])/'checkout',task['base_commit'])
  except Exception as e:errors.append({'issue':run['instanceId'],'error':str(e).split('\n')[0]});continue
  seen_files=set()
  for i,t in enumerate(run['turns'][:-1]):
   prior=requested_files('\n'.join(a.get('command')or'' for a in t['actions']))
   seen_files.update(prior)
   if not t['valid'] or not t['tags'] or not all(x in ('search','file-read','workspace-inspection') for x in t['tags']):continue
   suggestions=locate(prior,tree,seen_files)
   if not suggestions:continue
   # Proposal is frozen before looking at the next turn. All future fields below
   # are retrospective labels only, never arguments to locate().
   nxt=run['turns'][i+1];target=requested_files('\n'.join(a.get('command')or'' for a in nxt['actions'])) if nxt['valid'] else []
   target_tests=[p for p in target if is_test(p)];hits=sorted(set(suggestions)&set(target_tests))
   events.append({'issue':run['instanceId'],'traceId':t['id'],'nextTraceId':nxt['id'],'sources':[p for p in prior if not is_test(p)],'suggestions':suggestions,'targetTests':target_tests,'hits':hits,'nextIncludesEdit':'edit' in nxt['tags'],'nextReadOrSearchOnly':bool(nxt['tags']) and all(x in ('search','file-read') for x in nxt['tags']),'allNextExplicitFilesSuggested':bool(target) and set(target)<=set(suggestions),'suggestionBytes':len(('\n'.join(suggestions)+'\n').encode())})
 summary={'runs':runs,'treeErrors':len(errors),'proposalTurns':len(events),'proposalIssues':len(set(e['issue'] for e in events)),'suggestedFiles':sum(len(e['suggestions']) for e in events),'turnsWithNextExplicitTests':sum(bool(e['targetTests']) for e in events),'turnsWithAnyFileHit':sum(bool(e['hits']) for e in events),'hitIssues':len(set(e['issue'] for e in events if e['hits'])),'matchedFiles':sum(len(e['hits']) for e in events),'unmatchedSuggestedFiles':sum(len(e['suggestions'])-len(e['hits']) for e in events),'hitTurnsAlsoEditing':sum(bool(e['hits']) and e['nextIncludesEdit'] for e in events),'hitTurnsReadOrSearchOnly':sum(bool(e['hits']) and e['nextReadOrSearchOnly'] for e in events),'turnsAllExplicitFilesSuggested':sum(e['allNextExplicitFilesSuggested'] for e in events),'totalSuggestionBytes':sum(e['suggestionBytes'] for e in events)}
 out=pathlib.Path('data/analysis/test-locator-v1');out.mkdir(parents=True,exist_ok=True)
 report={'policy':POLICY,'scope':'Baseline discovery folds2/3/4 only','summary':summary,'events':events,'errors':errors,'limitations':['Filename matching only; no semantic relevance or test execution demonstrated.','Future commands label coverage only; suggestions use prior operands and original base tree.','No pristine heldout result; policy is exploratory and needs frozen independent evaluation.','Suggestion list does not supply test content or replace reads, searches, edits or model judgment.','Only explicit supported shell file operands are labeled; heredoc bodies, wildcard paths and unknown search flags excluded.','Tree byte limit is post-read validation of trusted local Git output, not a hard process-memory cap.','Unmatched suggestions may still be relevant; they are not proven false positives.','Path byte overhead omits instruction wrappers, contents and tokenizer effects.']}
 (out/'report.json').write_text(json.dumps(report,indent=2));(out/'report.json').chmod(0o600);print(json.dumps(summary,indent=2))
if __name__=='__main__':run()
