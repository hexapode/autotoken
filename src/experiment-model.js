// Frozen experiment profiles. The public recording proxy accepts arbitrary model IDs.
export function experimentModel(id='gpt-6.1-sol') {
 if(id==='gpt-6.1-sol')return {id,api:'openai-responses',provider:'openai',upstreamBase:'https://api.openai.com/v1',upstreamAuth:'bearer',inputRate:5,outputRate:10};
 if(id==='claude-opus-5-5')return {id,api:'anthropic-messages',provider:'anthropic',upstreamBase:'https://api.anthropic.com/v1',upstreamAuth:'x-api-key',inputRate:8,outputRate:20};
 throw new Error('No verified experimental budget profile for this model');
}
