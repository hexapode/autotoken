"""Sample discovery-only public traces without executing any recorded content.

One trajectory per issue, deterministic repository round-robin, pinned source
files. Original messages are retained; source costs/timing remain unknown.
"""
import argparse,collections,hashlib,json,pathlib,re
import pyarrow.parquet as pq
SEED='autotoken-public-v1'
def digest(text):return hashlib.sha256(text.encode()).hexdigest()
def group_key(instance):
    # SWE-smith mutations sharing a base repository/commit stay together.
    parts=instance.split('.')
    return '.'.join(parts[:2]) if len(parts)>2 and re.fullmatch('[a-f0-9]{7,40}',parts[1]) else instance

def text_content(value):
    if value is None:return ''
    if isinstance(value,str):return value
    if isinstance(value,list):return '\n'.join(x.get('text','') if isinstance(x,dict) and x.get('type')=='text' else json.dumps(x,ensure_ascii=False) for x in value)
    return json.dumps(value,ensure_ascii=False)

def normalize(row,source,index,fold):
    original=row.get('trajectory',row.get('messages'))
    if isinstance(original,str):original=json.loads(original)
    if not isinstance(original,list) or not all(isinstance(m,dict) for m in original):raise ValueError('Unsupported message array')
    messages=[]
    for m in original:
        role='assistant' if m.get('role')=='ai' else m.get('role')
        content=m.get('content') if 'content' in m else m.get('text') or m.get('system_prompt') or ''
        messages.append({'role':role,'content':content,**{k:m[k] for k in ('tool_calls','tool_call_id','name') if m.get(k) is not None}})
    turns=[];unsupported=0
    for i,m in enumerate(messages):
        if m['role']!='assistant':continue
        observations=[]
        for following in messages[i+1:]:
            if following['role']=='assistant':break
            if following['role'] in ('user','tool','environment'):observations.append(following)
        actions=[]
        for call in m.get('tool_calls') or []:
            function=call.get('function') or {};arguments=function.get('arguments',{})
            if isinstance(arguments,str):
                try:arguments=json.loads(arguments)
                except json.JSONDecodeError:arguments={'unparsed':arguments}
            if not isinstance(arguments,dict):arguments={'unparsed':arguments}
            command=arguments.get('command') if isinstance(arguments.get('command'),str) else None
            matches=[o for o in observations if o.get('tool_call_id')==call.get('id') and call.get('id') is not None]
            actions.append({'name':function.get('name') or call.get('name') or 'unknown','callId':call.get('id'),'arguments':arguments,'command':command,'results':matches,'alignment':'tool_call_id' if matches else 'terminal_finish' if function.get('name')=='finish' and not observations and all(x['role']!='assistant' for x in messages[i+1:]) else 'unmatched'})
        if not actions:
            fences=re.findall(r'```(?:bash|sh)?\s*\n(.*?)```',text_content(m['content']),re.S)
            if len(fences)==1:
                actions=[{'name':'swe_agent_action' if source['harness']=='swe-agent' else 'bash','command':fences[0].strip(),'results':observations,'alignment':'following_observation_messages'}]
            elif observations:unsupported+=1
        turns.append({'ordinal':len(turns),'sourceMessageIndex':i,'content':m['content'],'actions':actions,'observations':observations})
    iid=row['instance_id'];identity=source['dataset']+'@'+source['revision']+':'+source['remotePath']+':'+str(index)
    return {'id':digest(identity),'instanceId':iid,'groupKey':group_key(iid),'partition':'discovery','fold':fold,'harness':source['harness'],'provenance':{k:source[k] for k in ('dataset','revision','license','remotePath')},'sourceRow':index,'sourceTrajectoryId':row.get('trajectory_id'),'model':row.get('model_name'),'reportedResolved':row.get('resolved',row.get('target')),'exitStatus':row.get('exit_status'),'tools':row.get('tools'),'sourceMessages':original,'messages':messages,'turns':turns,'unsupportedActionTurns':unsupported,'usage':None,'latencyMs':None,'limits':['Imported source content without local truncation; original provider truncation/completeness unverified.','Reported outcomes are source labels, not independently rerun checks.','Assistant turns are not measured API request counts.','SWE-agent custom commands remain custom actions, not executable bash.']}

def sample(root,count,known_path):
    manifest=json.loads((root/'downloads.json').read_text());files=manifest['files']
    if not known_path.exists():raise ValueError('Known issue fold manifest required; pass --known-folds')
    known=json.loads(known_path.read_text())['assignments']
    candidates=collections.defaultdict(dict);excluded=collections.Counter();file_meta={};catalog=[]
    for source in files:
        pf=pq.ParquetFile(source['local']);ids=pf.read(columns=['instance_id']).column('instance_id').to_pylist();file_meta[source['local']]=source
        for index,iid in enumerate(ids):
            group=group_key(iid);fold=int(digest(SEED+':'+group.casefold())[:8],16)%5
            if iid in known:excluded['known_local_issue']+=1;continue
            if fold<2:excluded['reserved_calibration_or_evaluation']+=1;continue
            rank=digest(SEED+':'+source['dataset']+':'+iid+':'+source['remotePath']+':'+str(index))
            entry={'instanceId':iid,'groupKey':group,'fold':fold,'row':index,'local':source['local'],'rank':rank,'repo':iid.split('.')[0] if '.' in iid else re.sub(r'-[0-9]+$','',iid)}
            old=candidates[source['harness']].get(iid)
            if old is None or rank<old['rank']:candidates[source['harness']][iid]=entry
    chosen=[]
    for harness,by_issue in candidates.items():
        repos=collections.defaultdict(list)
        for entry in by_issue.values():repos[entry['repo']].append(entry)
        for entries in repos.values():entries.sort(key=lambda e:e['rank'])
        repo_order=sorted(repos,key=lambda repo:digest(SEED+':'+harness+':'+repo));selected=[]
        while len(selected)<count and any(repos.values()):
            for repo in repo_order:
                if repos[repo] and len(selected)<count:selected.append(repos[repo].pop(0))
        chosen.extend(selected)
        catalog.append({'harness':harness,'eligibleDistinctIssues':len(by_issue),'selected':len(selected),'repositories':len({e['repo'] for e in selected}),'splitGroups':len({e['groupKey'] for e in selected})})
    selection={'seed':SEED,'policy':'One row per issue; deterministic round-robin by repository among pinned shard candidates; discovery folds2/3/4 only; known local issues excluded; synthetic variants share repo/base-commit fold','excludedRows':dict(excluded),'catalog':catalog,'rows':chosen}
    (root/'selection.json').write_text(json.dumps(selection,indent=2));by_file=collections.defaultdict(dict)
    for entry in chosen:by_file[entry['local']][entry['row']]=entry
    counters=collections.defaultdict(lambda:collections.Counter());issues=collections.defaultdict(set);errors=[]
    with (root/'sample.jsonl').open('w') as dest:
        for filename,targets in by_file.items():
            pf=pq.ParquetFile(filename);source=file_meta[filename]
            cols=[c for c in ['instance_id','trajectory_id','trajectory','messages','tools','model_name','target','resolved','exit_status'] if c in pf.schema_arrow.names]
            offset=0
            for group in range(pf.num_row_groups):
                size=pf.metadata.row_group(group).num_rows
                if any(offset<=r<offset+size for r in targets):
                    batch_offset=offset
                    for batch in pf.iter_batches(batch_size=16,row_groups=[group],columns=cols,use_threads=False):
                        positions=[i for i in range(batch.num_rows) if batch_offset+i in targets]
                        if positions:
                            for position in positions:
                                index=batch_offset+position;row=batch.slice(position,1).to_pylist()[0];entry=targets[index]
                                try:record=normalize(row,source,index,entry['fold'])
                                except (ValueError,TypeError,KeyError) as error:errors.append({'source':source['harness'],'row':index,'error':str(error)});continue
                                dest.write(json.dumps(record,ensure_ascii=False,separators=(',',':'))+'\n')
                                c=counters[source['harness']];c['trajectories']+=1;c['messages']+=len(record['messages']);c['assistantTurns']+=len(record['turns']);c['actions']+=sum(len(t['actions']) for t in record['turns']);c['observationMessages']+=sum(len(t['observations']) for t in record['turns']);c['unsupportedActionTurns']+=record['unsupportedActionTurns'];c['reportedResolved']+=record['reportedResolved'] in (True,1);c['outcomeUnknown']+=record['reportedResolved'] is None;c['unmatchedNativeToolCalls']+=sum(a.get('alignment')=='unmatched' for t in record['turns'] for a in t['actions']);c['terminalFinishWithoutObservation']+=sum(a.get('alignment')=='terminal_finish' for t in record['turns'] for a in t['actions']);issues[source['harness']].add(row['instance_id'])
                        batch_offset+=batch.num_rows
                offset+=size
            print(json.dumps({'normalizedFile':source['harness'],'file':pathlib.Path(filename).name}),flush=True)
    summary={'sources':manifest['sources'],'selectionPolicy':selection['policy'],'seed':SEED,'catalog':catalog,'counts':{h:{**dict(c),'distinctIssues':len(issues[h])} for h,c in counters.items()},'downloadBytes':sum(x['bytes'] for x in files),'sampleBytes':(root/'sample.jsonl').stat().st_size,'excludedRows':dict(excluded),'errors':errors,'limitations':['Purposive shard selection, not an unbiased sample of full datasets.','One trajectory per issue; multiple synthetic issues may share a repository/base commit.','All imported trajectories are discovery-only; reserve separate tasks for evaluation.','Source labels are not independently verified; costs/latencies not available.','No recorded command or dataset-provided code is executed.']}
    (root/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
    if errors:raise SystemExit('Some rows failed normalization; see summary')
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--per-harness',type=int,default=100);parser.add_argument('--known-folds',default='data/experiments/router-all-traces-v2/report.json');args=parser.parse_args()
    if not 1<=args.per_harness<=1000:raise SystemExit('Sample bound is1..1000')
    sample(pathlib.Path(args.output).resolve(),args.per_harness,pathlib.Path(args.known_folds))
