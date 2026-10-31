"""Verify candidate replay events against original per-call usage and deduplicate.

These are gross conditional opportunities, never measured savings. Programs
remain responsible for their proposal/label checks; this verifies accounting.
"""
import argparse, hashlib, importlib.util, json, pathlib, collections
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('usage',ROOT/'scripts/estimate-recorded-usage.py')
usage=importlib.util.module_from_spec(spec);spec.loader.exec_module(usage)

def select_union(events):
    unique={};duplicates=0
    for e in sorted(events,key=lambda e:(e['cohort'],e['instance'],e['targetOrdinal'],e['program'])):
        key=(e['cohort'],e['instance'],e['targetOrdinal'])
        if key in unique:duplicates+=1
        else:unique[key]=e
    kept=[];removed=set();chains=0
    for key,e in unique.items():
        if (e['cohort'],e['instance'],e['sourceOrdinal']) in removed:chains+=1;continue
        kept.append(e);removed.add(key)
    return kept,duplicates,chains

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest',required=True,type=pathlib.Path)
    p.add_argument('--candidate',nargs=2,action='append',required=True,metavar=('REPORT','EVENTS'))
    p.add_argument('--out',required=True,type=pathlib.Path);a=p.parse_args()
    manifest=json.loads(a.manifest.read_text());lookup={};allturns=[];trajectories=0
    for f in manifest['files']:
        path=pathlib.Path(f['local']) if 'local' in f else a.manifest.parent/f['path']
        if not str(path).endswith('.traj.json'):continue
        data=path.read_bytes()
        if hashlib.sha256(data).hexdigest()!=f['sha256']:raise ValueError('Source checksum mismatch')
        trajectories+=1
        r=json.loads(data);label=f.get('label') or f['path'].split('/')[1]
        turns=usage.normalize(r);allturns.extend(turns)
        for t in turns:lookup[(label,r['instance_id'],t['ordinal'])]=t
    candidates=[];events=[]
    for reportpath,eventpath in a.candidate:
        report=json.loads(pathlib.Path(reportpath).read_text());private=json.loads(pathlib.Path(eventpath).read_text())
        if not isinstance(private,list):raise ValueError('Expected event list')
        matched=[];coverage=[];seen=set()
        for e in private:
            key=(e['cohort'],e['instance'],e['targetOrdinal'])
            if key in seen:raise ValueError('Duplicate within candidate')
            seen.add(key)
            if e['targetOrdinal']!=e['sourceOrdinal']+1:raise ValueError('Expected immediate next response')
            target=lookup[key];source=lookup[(e['cohort'],e['instance'],e['sourceOrdinal'])]
            if len(target['actions'])!=1 or len(target['actions'][0]['results'])!=1:raise ValueError('Not a whole singleton call with result')
            if not target['usage']:raise ValueError('Missing recorded usage')
            if e.get('usage')!=target['usage']:raise ValueError('Candidate usage differs from source')
            if e.get('matchType') not in [None,'exact','coverage_only']:raise ValueError('Unknown match type')
            destination=coverage if e.get('matchType')=='coverage_only' else matched
            destination.append({'program':report['program'],'cohort':e['cohort'],'instance':e['instance'],'sourceOrdinal':source['ordinal'],'targetOrdinal':target['ordinal'],'usage':target['usage'],'reportedCost':target['reportedCost']})
        if len(coverage)!=report.get('coverageOnly',{}).get('matchedCalls',0):raise ValueError('Coverage count mismatch')
        if len(matched)!=report['matchedCalls']:raise ValueError('Public/private count mismatch')
        candidates.append({'program':report['program'],'title':report['title'],'proposals':report['proposals'],'matchedCalls':len(matched),'matchedIssues':len({e['instance'] for e in matched}),'matchPercent':100*len(matched)/report['proposals'] if report['proposals'] else 0,'matchedUsage':usage.sums(matched),'sourceReport':pathlib.Path(reportpath).name})
        if coverage:candidates[-1]['coverageOnly']={'calls':len(coverage),'matchedIssues':len({e['instance'] for e in coverage}),'matchedUsage':usage.sums(coverage),'excludedFromUnion':True,'extraContextCostMeasured':False}
        events.extend(matched)
    selected,duplicates,chains=select_union(events);denominator=usage.sums(allturns);total=usage.sums(selected)
    result={'version':1,'kind':'conditional-gross-replay-estimates-with-recorded-usage','trajectories':trajectories,'uniqueIssues':len({k[1] for k in lookup}),'denominator':denominator,'candidates':candidates,'union':{'matchedUsage':total,'matchedIssues':len({e['instance'] for e in selected}),'duplicateTargetsRemoved':duplicates,'dependentChainsExcluded':chains,'callPercent':100*total['calls']/denominator['calls'],'tokenPercent':100*total['totalTokens']/denominator['totalTokens']},'limitations':['Discovery analysis, not held-out task-quality validation.','Only exact supported next whole-response matches are credited; unmatched proposals are not safe to deploy automatically.','Recorded usage is exact for original calls; avoiding those calls and their reasoning is a counterfactual assumption.','Input includes cache reads/creation; output includes reasoning. These subsets are never added again.','Gross estimates exclude router/program overhead, false positives, changed context and future cache behavior.','Per-program estimates overlap; use the deduplicated union for combined totals.','No recorded command was executed and no new paid model request was made.','Reported source costs are not independently reconciled invoices.']}
    a.out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'candidates':candidates,'union':result['union']},indent=2))
if __name__=='__main__':main()
