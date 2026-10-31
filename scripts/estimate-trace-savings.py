"""Counterfactual replay estimates, never measured avoided API calls.

Reruns frozen inert planners, then accounts for deduplicated whole assistant
turns. No recorded shell command or script is executed. Requires tiktoken 0.12.0.
"""
import argparse, collections, hashlib, importlib.metadata, json, pathlib, re, subprocess
import tiktoken

ROOT=pathlib.Path(__file__).resolve().parents[1]

def payload(message):
    """Visible generated payload once: content plus structured function payloads."""
    content=message.get('content') or ''
    text=content if isinstance(content,str) else json.dumps(content,ensure_ascii=False,separators=(',',':'))
    for call in message.get('tool_calls') or []:
        f=call.get('function') or {};args=f.get('arguments','')
        args=args if isinstance(args,str) else json.dumps(args,ensure_ascii=False,separators=(',',':'))
        text+='\n'+str(f.get('name',''))+'\n'+args
    return text

def action_only(turn):
    if len(turn.get('actions',[]))!=1:return False
    text=turn.get('content') or ''
    if not isinstance(text,str):return False
    action=turn['actions'][0]
    if action.get('arguments') is not None:return not text.strip()
    command=action.get('command','').strip()
    match=re.fullmatch(r'\s*```(?:bash|sh)?\n(.*?)\n```\s*',text,re.S)
    return bool(command and ((match and match[1].strip()==command) or text.strip()==command))

def select_nonoverlapping(events, conservative=False):
    """A removed turn cannot also supply the next policy trigger. First wins."""
    chosen=[];seen=set()
    for e in sorted(events,key=lambda e:(e['record'],e['sourceOrdinal'],e['program'])):
        if conservative and (not e['exact'] or not e['actionOnly'] or e['requiresUnobservedOptIn']):continue
        source=(e['record'],e['sourceOrdinal']);target=(e['record'],e['targetOrdinal'])
        if target in seen or source in seen:continue
        seen.add(target);chosen.append(e)
    return chosen

def accounting(events, records):
    return {'potentialAssistantTurnsReplaced':len(events),'trajectories':len({e['record'] for e in events}),'issues':len({e['issue'] for e in events}),'repoBaseGroups':len({records[e['record']]['groupKey'] for e in events}),'visibleOutputTokenProxy':sum(e['outputTokenProxy'] for e in events),'skippedRequestInputTokenProxy':sum(e['requestInputTokenProxy'] for e in events),'totalGrossTokenProxy':sum(e['outputTokenProxy']+e['requestInputTokenProxy'] for e in events),'nonemptyReasoningOrProseTurns':sum(not e['actionOnly'] for e in events)}

def estimate(records, reports, count):
    byid={r['id']:r for r in records};byissue={(r['harness'],r['instanceId']):r for r in records};events=[];plans=collections.Counter()
    def add(program,harness,event,source,target,exact,matched,requires_optin=False):
        plans[program]+=1
        if not matched:return
        r=byissue[(harness,event['issue'])]
        if source<0 or target>=len(r['turns']):raise ValueError('Invalid replay turn')
        s,t=r['turns'][source],r['turns'][target]
        if target!=source+1 or len(s['actions'])!=1 or len(t['actions'])!=1 or not t['actions'][0].get('results'):raise ValueError('Whole adjacent observed turn required')
        events.append({'program':program,'harness':harness,'record':r['id'],'issue':r['instanceId'],'sourceOrdinal':source,'targetOrdinal':target,'exact':bool(exact),'actionOnly':action_only(t),'requiresUnobservedOptIn':requires_optin})
    for key in ['unique_file_navigation','unique_match_navigation']:
        for e in reports['swe-agent']['events'][key]:add(key,'swe-agent',e,e['turn'],e['nextTurn'],True,e['wholeNextActionMatches'] and e['nextDisplayMatches'] and not e['nextExplicitError'])
    for e in reports['openhands']['events']['view_range_repair']:add('view_range_repair','openhands',e,e['sourceOrdinal'],e['targetOrdinal'],e['exactNextAction'],e['sameReadToEOF'] and e['nextSucceeded'])
    for e in reports['mini']['events']['write_then_run']:add('write_then_run','mini-swe-agent-plus',e,e['ordinal'],e['ordinal']+1,True,e['wholeNextActionMatch'] and e['nextObservedExitCode'] is not None,True)
    totals={'assistantTurns':0,'actions':0,'visibleOutputTokenProxy':0,'requestInputTokenProxy':0};lookup={}
    for r in records:
        # Content/function payload only. Framing, IDs, hidden reasoning, caching,
        # compaction and provider retries are unavailable and not invented.
        prefix=count(json.dumps(r['tools'],ensure_ascii=False,separators=(',',':'))) if r.get('tools') else 0;prefixes=[]
        for m in r['messages']:
            prefixes.append(prefix);prefix+=count(payload(m))
        for i,t in enumerate(r['turns']):
            mi=t['sourceMessageIndex'];out=count(payload(r['messages'][mi]));inp=prefixes[mi]
            lookup[(r['id'],i)]=(out,inp)
            totals['assistantTurns']+=1;totals['actions']+=len(t['actions']);totals['visibleOutputTokenProxy']+=out;totals['requestInputTokenProxy']+=inp
    for e in events:e['outputTokenProxy'],e['requestInputTokenProxy']=lookup[(e['record'],e['targetOrdinal'])]
    conservative=select_nonoverlapping(events,True);scenario=select_nonoverlapping(events)
    rows=[]
    for name in plans:
        es=[e for e in events if e['program']==name]
        rows.append({'program':name,'harness':es[0]['harness'] if es else None,'proposals':plans[name],'matchedWholeActions':len(es),'exactMatchedWholeActions':sum(e['exact'] for e in es),'equivalentEOFMatches':sum(not e['exact'] for e in es),'conservative':accounting([e for e in conservative if e['program']==name],byid),'optimisticScenario':accounting([e for e in scenario if e['program']==name],byid)})
    aggregate={name:accounting(es,byid) for name,es in [('conservative',conservative),('optimisticScenario',scenario)]}
    for a in aggregate.values():
        a['assistantTurnPercent']=100*a['potentialAssistantTurnsReplaced']/totals['assistantTurns']
        a['grossTokenProxyPercent']=100*a['totalGrossTokenProxy']/(totals['visibleOutputTokenProxy']+totals['requestInputTokenProxy'])
    return {'denominator':{'trajectories':len(records),'issues':len({r['instanceId'] for r in records}),'repoBaseGroups':len({r['groupKey'] for r in records}),'recordsWithUsage':sum(r.get('usage') is not None for r in records),**totals},'programs':rows,'aggregate':aggregate,'matchedEventsBeforeDeduplication':len(events),'eventsRemovedByOverlap':len(events)-len(scenario),'byHarness':{h:{'assistantTurns':sum(len(r['turns']) for r in records if r['harness']==h),'optimisticScenario':accounting([e for e in scenario if e['harness']==h],byid)} for h in sorted({r['harness'] for r in records})}},events

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True);p.add_argument('--public',type=pathlib.Path,required=True);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    commands=[['node',str(ROOT/'scripts/mine-public-swe-agent.mjs'),str(a.input),str(a.out/'swe-agent')],['python3',str(ROOT/'scripts/mine-public-openhands.py'),'--input',str(a.input),'--output',str(a.out/'openhands')],['python3',str(ROOT/'scripts/mine-public-mini.py'),'--input',str(a.input),'--output',str(a.out/'mini')]]
    for cmd in commands:subprocess.run(cmd,cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
    records=[json.loads(l) for l in a.input.open()];records=[r for r in records if r['partition']=='discovery']
    reports={h:json.loads((a.out/h/'report.json').read_text()) for h in ['swe-agent','openhands','mini']}
    encoding=tiktoken.get_encoding('cl100k_base');report,events=estimate(records,reports,lambda s:len(encoding.encode(s,disallowed_special=())))
    report.update(version=1,kind='counterfactual_replay_estimate_not_measured_savings',tokenMethod={'referenceEncoding':'cl100k_base','tiktokenVersion':importlib.metadata.version('tiktoken'),'nativeModelTokenizer':False,'recordedUsageAvailable':False,'input':'Sum reference-token lengths of visible prior message payloads plus tool schema, assuming full history at every assistant turn. Excludes chat framing/hidden reasoning; actual context compaction and caching unknown.','output':'Reference tokens in visible assistant text and structured function name/arguments, counted once. Not provider billing tokens.'},scenarios={'conservative':'Exact whole action, no extra assistant prose/reasoning, observed result, and no unobserved script-execution opt-in. Still a conditional turn-replacement estimate; hidden reasoning and task outcomes are unknown.','optimisticScenario':'Whole action matches including equivalent EOF reads, assuming accompanying reasoning is dispensable and script write-and-run is explicitly enabled. An opportunity ceiling among supported matches, not a statistical bound or deployment forecast.'},limitations=['Zero causally demonstrated saved calls in this replay; assistant turns are only a one-call-per-turn proxy.','Planners see prior tool results; future actions are labels only. Nonmatching proposals may change behavior and are not scored as savings.','Deduplicates target turns and rejects chains that depend on an already removed source turn.','Token estimates are gross: router/discovery cost, fallback, extra schema/output, cache pricing and changed trajectories are not modeled.','Tool results must still be returned to the model; their bytes are not counted as saved output.','No downstream context-shortening benefit is added; hypothetical future input savings would otherwise compound uncertain assumptions.','These are discovery traces used to develop the policies, not held-out evaluation; issue variants share repository/base groups.','Write-and-run requires opt-in, registered interpreter and file-hash checks; these policies are not observed in the source traces. Recorded scripts are never executed.','Other local programs are not credited on incompatible native harness tools.'],sourceSha256=hashlib.sha256(a.input.read_bytes()).hexdigest(),plannerSha256={str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in [ROOT/'scripts/mine-public-swe-agent-plan.mjs',ROOT/'scripts/mine-public-openhands.py',ROOT/'scripts/mine-public-mini.py']})
    (a.out/'events.json').write_text(json.dumps(events,indent=2));(a.out/'events.json').chmod(0o600)
    a.public.parent.mkdir(parents=True,exist_ok=True);a.public.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'denominator':report['denominator'],'aggregate':report['aggregate'],'programs':report['programs']},indent=2))
if __name__=='__main__':main()
