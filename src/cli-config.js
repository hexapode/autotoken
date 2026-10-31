export function proxyConfig(args,env=process.env) {
 const options={provider:env.AUTOTOKEN_PROVIDER || 'openai'};
 const allowed=['--provider','--upstream','--port','--trace-dir','--env-file'];
 for(let i=0;i<args.length;i++) {
  if(!allowed.includes(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Unknown or incomplete option: ${args[i]}`);
  options[args[i].slice(2)]=args[++i];
 }
 const defaults={openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com/v1',ollama:'http://127.0.0.1:11434/v1'};
 if(!['openai','anthropic','ollama','compatible'].includes(options.provider))throw new Error('Provider must be openai, anthropic, ollama, or compatible');
 const upstreamBase=options.upstream || env.LLM_BASE_URL || defaults[options.provider];
 if(!upstreamBase)throw new Error('Compatible providers require --upstream https://YOUR_PROVIDER/v1');
 const url=new URL(upstreamBase);if(options.provider==='ollama'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Ollama preset is local only; use compatible for remote servers');
 const port=Number(options.port || env.PROXY_PORT || 3001);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Port must be 1..65535');
 const upstreamKey=env.LLM_API_KEY || (options.provider==='anthropic'?env.ANTHROPIC_API_KEY:options.provider==='openai'?env.OPENAI_API_KEY:null);
 return {port,provider:options.provider,upstreamBase,upstreamKey,upstreamAuth:options.provider==='anthropic'?'x-api-key':options.provider==='ollama'?'none':'bearer',proxyToken:env.PROXY_TOKEN,directory:options['trace-dir'] || env.TRACE_DIR || './.autotoken/traces',timeoutMs:Number(env.PROXY_TIMEOUT_MS || 300000)};
}
