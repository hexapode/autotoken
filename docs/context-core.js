// Browser-compatible deterministic text operations. No filesystem, network or shell access.
const OMIT=new Set(['node_modules','__pycache__']);
export function insist(ok,message){if(!ok)throw Error(message);}
export function portablePath(path){
 insist(typeof path==='string'&&path.length>0&&path.length<=240&&!path.includes('\0')&&!path.includes('\\')&&!path.startsWith('/')&&!/^[A-Za-z]:\//.test(path),'unsupported_path');
 const parts=path.split('/');
 insist(!parts.some(p=>p==='..'||(p!=='.'&&p.startsWith('.'))||OMIT.has(p)),'unsupported_path');
 return parts.filter(p=>p&&p!=='.').join('/')||'.';
}
export function integer(value,min,max){return Number.isInteger(value)&&value>=min&&value<=max;}

/** Pure proposed windows. Does not inspect source or a future read action. */
export function expandMatchRanges(matches,{before=20,after=20,maxRanges=40,maxLines=400,maxFiles=5}={}){
 insist(Array.isArray(matches)&&matches.length<=1000,'invalid_matches');
 insist(integer(before,0,100)&&integer(after,0,100)&&integer(maxRanges,1,100)&&integer(maxLines,1,1000)&&integer(maxFiles,1,128),'invalid_range_limits');
 const sorted=matches.map(match=>{
  insist(match&&integer(match.line,1,10_000_000),'invalid_match_line');
  const path=portablePath(match.path);insist(path!=='.','invalid_match_path');return {path,line:match.line};
 }).sort((a,b)=>a.path.localeCompare(b.path,'en')||a.line-b.line);
 const merged=[];
 for(const match of sorted){
  const start=Math.max(1,match.line-before),end=match.line+after,last=merged.at(-1);
  if(last&&last.path===match.path&&start<=last.end+1)last.end=Math.max(last.end,end);
  else merged.push({path:match.path,start,end});
 }
 const ranges=[],files=new Set(),reasons=new Set();let remaining=maxLines;
 for(const range of merged){
  if(!files.has(range.path)&&files.size>=maxFiles){reasons.add('file_limit');continue;}
  if(ranges.length>=maxRanges){reasons.add('range_limit');break;}
  if(!remaining){reasons.add('line_limit');break;}
  const count=Math.min(remaining,range.end-range.start+1);files.add(range.path);
  ranges.push({...range,end:range.start+count-1});remaining-=count;
  if(count<range.end-range.start+1)reasons.add('line_limit');
 }
 return {ranges,truncated:reasons.size>0,reasons:[...reasons]};
}

// Restricted regex grammar: alternatives of literal text, with optional ^/$ anchors.
// No regex engine, groups, character classes, repetition, lookaround or backreferences.
export function createTextMatcher(query,mode,caseSensitive){
 insist(typeof query==='string'&&query.length>0&&query.length<=256&&!/[\r\n\0]/.test(query),'invalid_query');
 insist(['literal','regex'].includes(mode)&&typeof caseSensitive==='boolean','unsupported_search_mode');
 if(!caseSensitive)query=query.toLowerCase();
 if(mode==='literal')return line=>(caseSensitive?line:line.toLowerCase()).includes(query);
 const terms=[];let text='',start=false,end=false,atStart=true;
 for(let i=0;i<query.length;i++){
  const ch=query[i];
  if(ch==='\\'){
   const next=query[++i];insist(next&&'\\.^$|?*+()[]{}'.includes(next),'unsupported_regex');insist(!end,'unsupported_regex');text+=next;atStart=false;
  }else if(ch==='|'){
   insist(text.length>0,'unsupported_regex');terms.push({text,start,end});text='';start=false;end=false;atStart=true;
  }else if(ch==='^'&&atStart){start=true;atStart=false;}
  else if(ch==='$'&&(i===query.length-1||query[i+1]==='|'))end=true;
  else{insist(!'.^$?*+()[]{}'.includes(ch)&&!end,'unsupported_regex');text+=ch;atStart=false;}
 }
 insist(text.length>0&&terms.length<16,'unsupported_regex');terms.push({text,start,end});
 return line=>{line=caseSensitive?line:line.toLowerCase();return terms.some(t=>t.start&&t.end?line===t.text:t.start?line.startsWith(t.text):t.end?line.endsWith(t.text):line.includes(t.text));};
}

/** Run the same bounded search/context logic on text supplied in a browser. */
export function searchTextContext({text,path='checkout.py',query,mode='literal',caseSensitive=true,before=2,after=4,maxLines=200}={}){
 try{
  insist(typeof text==='string'&&new TextEncoder().encode(text).length<=32*1024&&!text.includes('\0'),'invalid_text');
  insist(integer(maxLines,1,200),'invalid_line_limit');const normalized=portablePath(path);insist(normalized!=='.','unsupported_path');
  const matchesLine=createTextMatcher(query,mode,caseSensitive),lines=text.split(/\r?\n/);if(lines.at(-1)==='')lines.pop();
  const matches=[];let matchLimit=false;
  for(let i=0;i<lines.length;i++)if(matchesLine(lines[i])){if(matches.length===40){matchLimit=true;break;}matches.push({path:normalized,line:i+1});}
  const expanded=expandMatchRanges(matches,{before,after,maxRanges:40,maxFiles:1,maxLines});
  const result={status:'ok',mode,matches,ranges:expanded.ranges.map(r=>({...r,end:Math.min(r.end,lines.length),lines:lines.slice(r.start-1,Math.min(r.end,lines.length)).map((text,i)=>({number:r.start+i,text}))})),truncated:matchLimit||expanded.truncated,reasons:[...expanded.reasons,...(matchLimit?['match_limit']:[])]};
  while(new TextEncoder().encode(JSON.stringify(result)).length>32*1024){
   result.truncated=true;if(!result.reasons.includes('output_bytes'))result.reasons.push('output_bytes');
   if(result.ranges.length){const last=result.ranges.at(-1);last.lines.pop();last.end--;if(!last.lines.length)result.ranges.pop();}
   else if(result.matches.length)result.matches.pop();else break;
  }
  return result;
 }catch(error){return {status:'abstained',reason:error.message,matches:[],ranges:[],truncated:false,reasons:[]};}
}
