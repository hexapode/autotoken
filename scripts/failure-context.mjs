export const FAILURE_CONTEXT_POLICY=Object.freeze({before:20,after:20,maxPointers:4,maxLines:160,maxInputChars:1048576});
const safePath=path=>/^[A-Za-z0-9_./-]+\.py$/.test(path)&&path.length<=300&&!path.startsWith('/')&&!path.startsWith('-')&&!path.split('/').some(p=>p==='..'||p.startsWith('.'));

// Accept only completed prior output, never following actions or patched files.
// Returns a read plan, not reconstructed historical source or executable shell.
export function planFailureContext(output){
 if(typeof output!=='string'||output.length>FAILURE_CONTEXT_POLICY.maxInputChars)return {status:'unsupported_output',ranges:[]};
 if(!/\b[1-9]\d* (?:failed|errors?)\b|^FAILED\s|^ERROR\s/m.test(output))return {status:'no_failure_evidence',ranges:[]};
 const pointers=[];
 for(const line of output.split('\n')){
  if(/warning/i.test(line))continue;
  const m=line.match(/^([\w./-]+\.py):(\d+):/)||line.match(/^\s*File "([\w./-]+\.py)", line (\d+)/);
  if(!m||!safePath(m[1]))continue;
  const point={path:m[1],line:Number(m[2])};
  if(!Number.isSafeInteger(point.line)||point.line<1||point.line>1000000)continue;
  if(!pointers.some(p=>p.path===point.path&&p.line===point.line))pointers.push(point);
  if(pointers.length===FAILURE_CONTEXT_POLICY.maxPointers)break;
 }
 if(!pointers.length)return {status:'no_supported_pointers',ranges:[]};
 const windows=pointers.map(p=>({path:p.path,start:Math.max(1,p.line-FAILURE_CONTEXT_POLICY.before),end:p.line+FAILURE_CONTEXT_POLICY.after})).sort((a,b)=>a.path.localeCompare(b.path)||a.start-b.start);
 const merged=[];for(const window of windows){const last=merged.at(-1);if(last&&last.path===window.path&&window.start<=last.end+1)last.end=Math.max(last.end,window.end);else merged.push({...window});}
 let budget=FAILURE_CONTEXT_POLICY.maxLines;const ranges=[];
 for(const range of merged){if(budget<=0)break;const end=Math.min(range.end,range.start+budget-1);ranges.push({...range,end});budget-=end-range.start+1;}
 return {status:'planned',pointers,ranges,proposedLines:FAILURE_CONTEXT_POLICY.maxLines-budget};
}
export function rangeCoverage(proposed,requested){
 let covered=0,total=0;
 for(const read of requested){
  total+=read.end-read.start+1;
  const intervals=proposed.filter(p=>p.path===read.path&&p.start<=read.end&&read.start<=p.end).map(p=>({start:Math.max(read.start,p.start),end:Math.min(read.end,p.end)})).sort((a,b)=>a.start-b.start);
  let last=read.start-1;for(const p of intervals){covered+=Math.max(0,p.end-Math.max(last,p.start-1));last=Math.max(last,p.end);}
 }
 return {requestedLines:total,coveredLines:covered,allCovered:total>0&&covered===total};
}
