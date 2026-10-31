// Normalization is for local analysis only. Forwarded response bytes never change.
export function anthropicUsage(raw) {
 if (!raw || !Number.isFinite(raw.input_tokens) || !Number.isFinite(raw.output_tokens)) return null;
 const cached=raw.cache_read_input_tokens || 0, written=raw.cache_creation_input_tokens || 0;
 const input=raw.input_tokens+cached+written;
 return {...raw,input_tokens:input,output_tokens:raw.output_tokens,total_tokens:input+raw.output_tokens,input_tokens_details:{cached_tokens:cached,cache_write_tokens:written},raw_usage:raw};
}
export function inspectAnthropicResponse(buffer,headers) {
 const text=buffer.toString('utf8');
 if(!String(headers['content-type']).includes('text/event-stream')) {
  try { const body=JSON.parse(text);return {usage:anthropicUsage(body.usage),output:body.content || [],status:body.error?'failed':body.type==='message'?'completed':null,error:body.error || null,stop_reason:body.stop_reason || null}; }
  catch{return {usage:null,parseError:'Non-JSON response'};}
 }
 let rawUsage={},done=false,error=null,stopReason=null,malformedEvents=0;
 const blocks=new Map(),partialJson=new Map();
 for(const event of text.split(/\r?\n\r?\n/)) {
  const data=event.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n');if(!data)continue;
  try {
   const value=JSON.parse(data);
   if(value.type==='message_start')rawUsage={...rawUsage,...value.message?.usage};
   if(value.type==='message_delta'){rawUsage={...rawUsage,...value.usage};stopReason=value.delta?.stop_reason ?? stopReason;}
   if(value.type==='message_stop')done=true;
   if(value.type==='error')error=value.error || value;
   if(!Number.isInteger(value.index)||value.index<0||value.index>1000)continue;
   if(value.type==='content_block_start')blocks.set(value.index,{...value.content_block});
   if(value.type==='content_block_delta') {
    const block=blocks.get(value.index);if(!block)continue;const delta=value.delta || {};
    if(delta.type==='text_delta')block.text=(block.text || '')+(delta.text || '');
    if(delta.type==='thinking_delta')block.thinking=(block.thinking || '')+(delta.thinking || '');
    if(delta.type==='signature_delta')block.signature=(block.signature || '')+(delta.signature || '');
    if(delta.type==='input_json_delta')partialJson.set(value.index,(partialJson.get(value.index)||'')+(delta.partial_json||''));
   }
   if(value.type==='content_block_stop'&&partialJson.has(value.index))blocks.get(value.index).input=JSON.parse(partialJson.get(value.index));
  }catch{malformedEvents++;}
 }
 return {usage:anthropicUsage(rawUsage),output:[...blocks.entries()].sort((a,b)=>a[0]-b[0]).map(([,b])=>b),status:error?'failed':done?'completed':'incomplete',error,stop_reason:stopReason,done,malformedEvents};
}
