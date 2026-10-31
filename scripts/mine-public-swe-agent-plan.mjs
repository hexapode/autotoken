import {posix} from 'node:path';
import {shellSegments} from '../src/pattern-miner.js';
// SWE-agent harness actions are NOT bash. This returns typed navigation plans;
// it never executes commands or treats arbitrary trace text as instructions.
function safeHarnessPath(path){return typeof path==='string'&&path.startsWith('/')&&path.length<300&&/^[A-Za-z0-9_./-]+$/.test(path)&&!path.split('/').some(p=>p==='..'||p.startsWith('.'));}
export function planUniqueNavigation({command,output}){
 if(typeof command!=='string'||typeof output!=='string'||output.length>32768||command.includes('\n'))return {status:'abstained'};
 const segments=shellSegments(command);
 if(!segments||segments.length!==1||segments[0].separator||segments[0].tokens.length<2||segments[0].tokens.length>3)return {status:'abstained'};
 const verb=segments[0].tokens[0];
 if(!['find_file','search_dir','search_file'].includes(verb))return {status:'abstained'};
 const header=output.match(/^Found 1 matches for "([^\n]*)" in ([^\n]+):\n/);
 const cwd=output.match(/^\(Current directory: ([^\n]+)\)$/m)?.[1];
 if(!header||header[1]!==segments[0].tokens[1]||!safeHarnessPath(cwd))return {status:'abstained'};
 const inside=path=>safeHarnessPath(path)&&(path===cwd||path.startsWith(cwd+'/'));
 const body=output.slice(header[0].length).split('\n');
 if(verb==='search_file'){
  const file=header[2],open=output.match(/^\(Open file: ([^\n]+)\)$/m)?.[1];
  const matches=body.filter(line=>/^Line \d+:/.test(line));
  if(file!==open||!inside(file)||matches.length!==1)return {status:'abstained'};
  if(segments[0].tokens[2]&&posix.resolve(cwd,segments[0].tokens[2])!==file)return {status:'abstained'};
  const line=Number(matches[0].match(/^Line (\d+):/)[1]);
  if(!Number.isInteger(line)||line<1||line>1000000)return {status:'abstained'};
  return {status:'planned',action:{name:'swe_agent_action',command:`goto ${line}`},file,line,reason:'unique_match_in_current_file'};
 }
 const paths=body.filter(line=>line.startsWith('/')).map(line=>verb==='search_dir'?line.replace(/ \(1 matches\)$/,''):line);
 if(paths.length!==1||!inside(paths[0]))return {status:'abstained'};
 return {status:'planned',action:{name:'swe_agent_action',command:`open ${paths[0]}`},file:paths[0],reason:'unique_file_result'};
}
