#!/usr/bin/env node
import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {loadEnvFile} from 'node:process';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRecordingServer} from '../src/recording-proxy.js';
import {proxyConfig} from '../src/cli-config.js';
const [command='help',...args]=process.argv.slice(2);
const help=`Autotoken — record LLM traffic and test reusable programs

Usage:
  autotoken init                         Create local config and proxy token
  autotoken demo                         Run the offline learning demo
  autotoken proxy [options]              Start the recording proxy
  autotoken traces DIRECTORY             Summarize recorded requests
  autotoken eval                         Run the scripted evaluation
  autotoken --version

Proxy options:
  --provider openai|anthropic|compatible|ollama   Default: openai
  --upstream URL                        Provider API base, including /v1
  --port NUMBER                         Default: 3001, bound to loopback
  --trace-dir PATH                      Default: .autotoken/traces
  --env-file PATH                       Default: .autotoken.env (if present)

Set LLM_API_KEY (or OPENAI_API_KEY / ANTHROPIC_API_KEY) and PROXY_TOKEN.
The Ollama preset needs no upstream key; your client still needs PROXY_TOKEN.
The client's model ID passes through unchanged. No API format conversion.
Recording endpoints: /v1/chat/completions, /v1/responses, /v1/messages.
This proxy records traffic; automatic substitution is experimental.
`;
try {
 if(['help','--help','-h'].includes(command)){console.log(help);}
 else if(['--version','version','-v'].includes(command)){console.log(JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version);}
 else if(command==='init') {
  if(args.length)throw new Error('Usage: autotoken init');
  await writeFile('.autotoken.env',`# Keep this file private. The provider key stays on the proxy.\nLLM_API_KEY=\nPROXY_TOKEN=${randomBytes(24).toString('hex')}\n# AUTOTOKEN_PROVIDER=openai\n# LLM_BASE_URL=https://api.openai.com/v1\n`,{flag:'wx',mode:0o600});
  let ignore='';try{ignore=await readFile('.gitignore','utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  const missing=['.autotoken.env','.autotoken/'].filter(rule=>!ignore.split(/\r?\n/).includes(rule));
  if(missing.length)await appendFile('.gitignore','\n'+missing.join('\n')+'\n');
  console.log('Created .autotoken.env and Git exclusions. Add your provider key, then run autotoken proxy. Use PROXY_TOKEN as your client API key.');
 } else {
  const envIndex=args.indexOf('--env-file');const file=envIndex>=0?args[envIndex+1]:'.autotoken.env';
  if(!file)throw new Error('Missing --env-file path');
  try{loadEnvFile(file);}catch(e){if(e.code!=='ENOENT'||envIndex>=0)throw new Error('Cannot read environment file');}
  if(command==='proxy') {
   const config=proxyConfig(args);const server=createRecordingServer(config);
   server.on('error',e=>{console.error(`Proxy failed: ${e.code || 'SERVER_ERROR'}`);process.exitCode=1;});
   server.listen(config.port,'127.0.0.1',()=>console.log(`Autotoken recording proxy (${config.provider}): http://127.0.0.1:${config.port}\nTraces: ${config.directory}\nNo model restrictions; use your provider's model ID.`));
   const stop=()=>{server.closeAllConnections();server.close();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  } else if(['demo','traces','eval'].includes(command)) {
   if((command==='traces'&&args.length!==1)||(command!=='traces'&&args.length))throw new Error(`Invalid ${command} arguments`);
   const script={demo:'demo.js',traces:'trace.js',eval:'evaluate.js'}[command];
   const child=spawn(process.execPath,[fileURLToPath(new URL('../src/'+script,import.meta.url)),...args],{stdio:'inherit',env:process.env});
   child.on('error',()=>{console.error('Could not start command');process.exitCode=1;});
   child.on('exit',(code)=>{process.exitCode=code ?? 1;});
  } else throw new Error('Unknown command. Run autotoken --help');
 }
}catch(e){console.error(e.code==='EEXIST'?'Config already exists; keeping it unchanged.':e.message);process.exitCode=1;}
