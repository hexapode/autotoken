"""Replay existing mini write/run policy against recorded per-response usage.

No commands execute. Native Responses objects remain one call even when they
contain several tool calls. No shell syntax is broadened to improve coverage.
"""
import argparse,collections,hashlib,importlib.util,json,pathlib,re
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('mini',ROOT/'scripts/mine-public-mini.py');mini=importlib.util.module_from_spec(spec);spec.loader.exec_module(mini)

def usage_fields(u):
    if not isinstance(u,dict):return None
    if 'input_tokens' in u and 'prompt_tokens' not in u and ('cache_read_input_tokens' in u or 'cache_creation_input_tokens' in u):raise ValueError('Native Anthropic input excludes cache: explicit adapter required')
    inp=u.get('input_tokens',u.get('prompt_tokens'));out=u.get('output_tokens',u.get('completion_tokens'))
    if any(type(v)is not int or v<0 for v in [inp,out]):return None
    details=u.get('input_tokens_details') or u.get('prompt_tokens_details') or {}
    od=u.get('output_tokens_details') or u.get('completion_tokens_details') or {}
    cached=u.get('cache_read_input_tokens',details.get('cached_tokens'))
    creation=u.get('cache_creation_input_tokens',details.get('cache_creation_tokens'))
    return {'inputTokens':inp,'outputTokens':out,'totalTokens':inp+out,'cachedInputTokens':cached,'cacheCreationInputTokens':creation,'reasoningOutputTokens':od.get('reasoning_tokens')}

def normalize(r):
    msgs=r['messages'];turns=[]
    for i,m in enumerate(msgs):
        responses=m.get('object')=='response'
        if not responses and m.get('role')!='assistant':continue
        response=m if responses else m.get('extra',{}).get('response',{})
        usage=usage_fields(response.get('usage'))
        actions=[]
        rawcalls=[x for x in m.get('output',[]) if x.get('type')=='function_call'] if responses else m.get('tool_calls',[])
        for raw in rawcalls:
            f=raw if responses else raw.get('function',{});args=f.get('arguments',{})
            if isinstance(args,str):
                try:args=json.loads(args)
                except ValueError:args={}
            if not isinstance(args,dict):args={}
            callid=raw.get('call_id') if responses else raw.get('id')
            results=[]
            for following in msgs[i+1:]:
                if following.get('object')=='response' or following.get('role')=='assistant':break
                if callid is not None and (following.get('call_id')==callid or following.get('tool_call_id')==callid):
                    content=following.get('output',following.get('content',''))
                    if isinstance(content,str):results.append(content)
            actions.append({'name':f.get('name'),'command':args.get('command'),'results':results})
        cost=m.get('extra',{}).get('cost')
        turns.append({'ordinal':len(turns),'actions':actions,'usage':usage,'reportedCost':cost if type(cost)in(int,float) and cost>=0 else None,'sourceMessageIndex':i,'usageFormat':'responses_input_output' if responses else 'chat_prompt_completion' if 'prompt_tokens' in (response.get('usage') or {}) else 'unknown'})
    return turns

def analyze(r):
    turns=normalize(r);events=[];proposals=0;multitool=0
    diagnostics=collections.Counter()
    for t in turns:
        diagnostics['nativeToolActions']+=len(t['actions'])
        for a in t['actions']:
            if a['name']=='bash' and isinstance(a['command'],str):diagnostics['recognizedBashCommandActions']+=1
        if len(t['actions'])!=1:continue
        a=t['actions'][0]
        if a['name']!='bash' or not isinstance(a['command'],str):continue
        diagnostics['singletonBashCalls']+=1
        if len(a['results'])!=1:diagnostics['singletonMissingOrAmbiguousResult']+=1;continue
        diagnostics['singletonBashWithAlignedResult']+=1
        if mini.success(a['results'][0]):diagnostics['singletonSuccessfulBashResult']+=1
        if re.search(r'\bcat\b',a['command']) and '<<' in a['command']:
            diagnostics['singletonCatHeredocSyntax']+=1
            if not mini.parse_write(a['command']):diagnostics['catHeredocRejectedByFrozenGrammarOrPath']+=1
        if mini.parse_write(a['command']):
            diagnostics['parsedFrozenWrite']+=1
            if not mini.success(a['results'][0]):diagnostics['parsedWriteWithoutSuccessfulObservation']+=1
    for i,t in enumerate(turns[:-1]):
        if len(t['actions'])!=1:continue
        a=t['actions'][0]
        if a['name']!='bash' or not isinstance(a['command'],str) or len(a['results'])!=1:continue
        proposal=mini.plan_script_run(a['command'],a['results'][0],'python')
        if not proposal:continue
        proposals+=1;nextturn=turns[i+1]
        if len(nextturn['actions'])!=1:multitool+=1;continue
        n=nextturn['actions'][0]
        if n['name']!='bash' or not isinstance(n['command'],str) or len(n['results'])!=1:continue
        if mini.pure_python(n['command'])!=proposal['argv']:continue
        # Retain matches regardless of process exit; matching a script run is
        # not a claim of passing tests, authorized deployment, or bug success.
        events.append({'sourceOrdinal':i,'targetOrdinal':i+1,'usage':nextturn['usage'],'reportedCost':nextturn['reportedCost'],'requiresExplicitRunAfterWritePolicy':True})
    # Source write and target run cannot overlap for this policy; assert it.
    targets=[e['targetOrdinal'] for e in events]
    if len(set(targets))!=len(targets) or any(e['sourceOrdinal'] in targets for e in events):raise ValueError('Overlapping replacements')
    return turns,events,{'proposals':proposals,'nextMultiToolTurnsExcluded':multitool,'diagnostics':dict(diagnostics)}

def sums(turns):
    used=[t['usage'] for t in turns if t['usage'] is not None]
    result={'calls':len(turns),'callsWithUsage':len(used)}
    for key in ['inputTokens','outputTokens','totalTokens','cachedInputTokens','cacheCreationInputTokens','reasoningOutputTokens']:
        vals=[u[key] for u in used if type(u.get(key)) is int];result[key]=sum(vals);result[key+'ReportedCalls']=len(vals)
    costs=[t['reportedCost'] for t in turns if t.get('reportedCost') is not None]
    result['sourceReportedCostSum']=sum(costs);result['callsWithReportedCost']=len(costs)
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest',type=pathlib.Path,required=True);p.add_argument('--public',type=pathlib.Path,required=True);p.add_argument('--private',type=pathlib.Path,required=True);a=p.parse_args();manifest=json.loads(a.manifest.read_text());cohorts=collections.defaultdict(list);events=[]
    for f in manifest['files']:
        if not (f.get('local') or f.get('path','')).endswith('.traj.json'):continue
        path=pathlib.Path(f['local']) if 'local'in f else a.manifest.parent/f['path'];data=path.read_bytes()
        if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Source checksum mismatch')
        r=json.loads(data);label=f.get('label') or f['path'].split('/')[1];turns,es,counts=analyze(r)
        reported=r.get('info',{}).get('model_stats',{}).get('api_calls')
        row={'instance':r['instance_id'],'turns':turns,'events':es,**counts,'reportedApiCalls':reported,'apiCallCountMatches':reported==len(turns)};cohorts[label].append(row)
        for e in es:events.append({'cohort':label,'instance':r['instance_id'],**e})
    summaries={}
    for label,rows in cohorts.items():
        allturns=[t for r in rows for t in r['turns']];es=[e for r in rows for e in r['events']]
        summaries[label]={'trajectories':len(rows),'issues':len({r['instance'] for r in rows}),'usage':sums(allturns),'reportedApiCalls':sum(r['reportedApiCalls'] or 0 for r in rows),'trajectoriesWithMatchingApiCallCount':sum(r['apiCallCountMatches'] for r in rows),'multiToolCalls':sum(len(t['actions'])>1 for t in allturns),'diagnostics':dict(sum((collections.Counter(r['diagnostics']) for r in rows),collections.Counter())),'usageFormatCounts':dict(collections.Counter(t['usageFormat'] for t in allturns)),'proposals':sum(r['proposals'] for r in rows),'nextMultiToolTurnsExcluded':sum(r['nextMultiToolTurnsExcluded'] for r in rows),'optimisticMatchedCalls':sums(es),'matchedIssues':len({r['instance'] for r in rows if r['events']}),'conservativeMatchedCalls':0}
    report={'version':1,'kind':'recorded_usage_counterfactual_replay_not_measured_savings','sources':manifest.get('sources') or [{'dataset':manifest.get('source'),'revision':manifest.get('revision'),'license':manifest.get('license'),'url':manifest.get('url')}],'selection':manifest.get('selection','All source trajectories'),'program':'frozen mini write_then_run: python registered; exact whole singleton source and next action; observed results','plannerSha256':hashlib.sha256((ROOT/'scripts/mine-public-mini.py').read_bytes()).hexdigest(),'cohorts':summaries,'limitations':['Separate sample: do not combine with the original300 discovery traces or their token-proxy denominator.','Recorded input/output usage belongs to original model calls; saved tokens are conditional counterfactual estimates, not measured savings.','Input totals already include cached and cache-creation tokens; those details are reported separately and never added again.','One native Responses object is one model call, regardless of how many tool calls it contains.','Frozen shell grammar, paths and interpreter policy unchanged; incompatible commands are abstentions, not estimated savings.','Write-and-run requires explicit opt-in and unchanged-file hash check, absent from these historical traces. Conservative deployment credit is therefore zero.','No router/discovery/fallback overhead, downstream history effects or hypothetical cost recalculation included.','Reported costs are source metadata, not verified invoices; zero may mean unpriced.','Source task outcomes are not independently verified; no recorded commands executed.']}
    a.public.write_text(json.dumps(report,indent=2)+'\n');a.private.parent.mkdir(parents=True,exist_ok=True);a.private.write_text(json.dumps(events,indent=2));a.private.chmod(0o600);print(json.dumps(summaries,indent=2))
if __name__=='__main__':main()
