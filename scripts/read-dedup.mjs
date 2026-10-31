const valid=r=>r&&typeof r.path==='string'&&/^[A-Za-z0-9_./-]+$/.test(r.path)&&!r.path.startsWith('/')&&!r.path.split('/').some(p=>p==='..'||p.startsWith('.'))&&Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=1&&r.end>=r.start&&r.end<=1000000;
export function unionReadRanges(ranges){
 if(!Array.isArray(ranges)||ranges.length>40||!ranges.every(valid))return {status:'abstained',reason:'unsupported_ranges'};
 const requestedLines=ranges.reduce((s,r)=>s+r.end-r.start+1,0);
 if(requestedLines>10000)return {status:'abstained',reason:'line_limit'};
 const merged=[];
 for(const range of ranges.map(r=>({...r})).sort((a,b)=>a.path.localeCompare(b.path)||a.start-b.start)){
  const last=merged.at(-1);
  if(last&&last.path===range.path&&range.start<=last.end+1)last.end=Math.max(last.end,range.end);else merged.push(range);
 }
 const uniqueLines=merged.reduce((s,r)=>s+r.end-r.start+1,0);
 return {status:'planned',ranges:merged,requestedLines,uniqueLines,duplicateRequestedLines:requestedLines-uniqueLines};
}

// Same immutable source snapshot required for union reads. Across turns, require
// BOTH matching whole-file content fingerprint and prior source provenance.
// Emits references only for already-covered ranges, never deletes new content.
// Caller MUST additionally verify referenced text remains available to the model
// (sourceId alone does not prove retention after compaction). If unavailable,
// resend full current content instead of the reference. This is a planner only.
export function planOutputReferences(current,previous){
 if(!Array.isArray(current)||!Array.isArray(previous)||current.length>40||previous.length>100)return {status:'abstained',reason:'item_limit'};
 const validItem=r=>valid(r)&&typeof r.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(r.fingerprint)&&typeof r.sourceId==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(r.sourceId);
 if(!current.every(validItem)||!previous.every(validItem))return {status:'abstained',reason:'missing_fingerprint_or_provenance'};
 return {status:'planned',items:current.map(r=>{const prior=previous.find(p=>p.path===r.path&&p.fingerprint===r.fingerprint&&p.start<=r.start&&p.end>=r.end);return prior?{kind:'reference',path:r.path,start:r.start,end:r.end,sourceId:prior.sourceId}:{kind:'read',...r};})};
}
