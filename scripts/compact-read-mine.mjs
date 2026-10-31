import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {parseCompactReads,compactArguments} from './compact-read.mjs';
const snapshot=JSON.parse(await readFile('data/experiments/router-all-traces-v2/snapshot.json','utf8'));
const assignments=JSON.parse(await readFile('data/experiments/router-all-traces-v2/report.json','utf8')).assignments;
const events=[];let decisions=0;
for(const run of snapshot.runs){
 if(run.arm!=='baseline'||![2,3,4].includes(assignments[run.instanceId]))continue;
 for(const t of run.turns){
  decisions++;if(!t.valid||t.actions.length!==1)continue;
  const a=t.actions[0];if(!['local_bash','container_bash'].includes(a.name))continue;
  const ranges=parseCompactReads(a.command);if(!ranges)continue;
  const size=x=>Buffer.byteLength(JSON.stringify(x));
  events.push({issue:run.instanceId,traceId:t.id,rangeCount:ranges.length,distinctFiles:new Set(ranges.map(r=>r[0])).size,bareCommandBytes:Buffer.byteLength(a.command),originalArgumentBytes:size({command:a.command}),compactArgumentBytes:size(compactArguments(ranges)),verboseArgumentBytes:size({reads:ranges.map(([path,start,end])=>({path,start,end}))}),unboundedCat:ranges.some(r=>r[2]===null),recordedSuccess:a.result?.startsWith('Exit code: 0; timed out: false\n')===true});
 }
}
const summarize=rows=>({turns:rows.length,issues:new Set(rows.map(r=>r.issue)).size,originalArgumentBytes:rows.reduce((n,r)=>n+r.originalArgumentBytes,0),compactArgumentBytes:rows.reduce((n,r)=>n+r.compactArgumentBytes,0),verboseArgumentBytes:rows.reduce((n,r)=>n+r.verboseArgumentBytes,0),compactSmaller:rows.filter(r=>r.compactArgumentBytes<r.originalArgumentBytes).length,unboundedCat:rows.filter(r=>r.unboundedCat).length,recordedSuccess:rows.filter(r=>r.recordedSuccess).length});
const summary={discoveryDecisions:decisions,all:summarize(events),singleRange:summarize(events.filter(r=>r.rangeCount===1)),multiRange:summarize(events.filter(r=>r.rangeCount>1)),multipleFiles:summarize(events.filter(r=>r.distinctFiles>1))};
const report={scope:'Baseline discovery folds 2,3,4 only',summary,events,limits:['UTF-8 byte sizes, not tokenizer measurements or provider billing.','Both sides include argument JSON envelopes; tool names, schemas and unchanged execution metadata excluded.','Tuple schema r uses null path to repeat immediately previous path; null end means through EOF subject to runtime caps.','Parser coverage is syntactic only; historical content is not reconstructed.','Model still chooses every path and range; no model calls eliminated.','Numbered output differs from raw sed/head formatting and may increase input tokens.','Cat includes files of unknown historical length; runtime would truncate/abstain under limits.','Multi-range shell commands already batch reads; the proposed benefit is argument compression only.','Runtime is for trusted, quiescent repositories; concurrent directory replacement is outside the guarantee.','Runtime response is capped by serialized JSON bytes as well as file and line budgets.']};
const dir='data/analysis/compact-read-v1';await mkdir(dir,{recursive:true,mode:0o700});await writeFile(`${dir}/report.json`,JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(summary,null,2));
