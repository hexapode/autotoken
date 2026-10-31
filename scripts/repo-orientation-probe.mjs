import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {parseReadCommand,shellSegments} from '../src/pattern-miner.js';

// Read fixed Git objects only: never execute repository configuration or trace commands.
export const POLICY={configFiles:['pyproject.toml','setup.cfg','tox.ini','pytest.ini','setup.py','requirements_test.txt','requirements-test.txt'],maxConfigBytes:8192,maxConfigLines:140,maxRoots:12};
function git(repo,args){return execFileSync('git',['-C',repo,...args],{encoding:'utf8',maxBuffer:4*1024*1024,timeout:5000});}
export function orientation(repo,commit){
 if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Invalid base commit');
 const entries=git(repo,['ls-tree','-rz',commit]).split('\0').filter(Boolean).map(line=>{const [meta,path]=line.split('\t');return {mode:meta.split(' ')[0],path};});
 const files=entries.filter(e=>e.mode==='100644'||e.mode==='100755').map(e=>e.path);
 const sourceRoots=[...new Set(files.filter(p=>p.endsWith('/__init__.py')).map(p=>p.startsWith('src/')?p.split('/').slice(0,2).join('/'):p.split('/')[0]))].filter(p=>!['tests','test','docs','doc'].includes(p)).sort().slice(0,POLICY.maxRoots);
 const testRoots=[...new Set(files.filter(p=>/(?:^|\/)(?:test_|unittest_)[^/]*\.py$/.test(p)).map(p=>p.includes('/tests/')?p.split('/tests/')[0]+'/tests':p.split('/')[0]))].sort().slice(0,POLICY.maxRoots);
 let bytes=POLICY.maxConfigBytes,lines=POLICY.maxConfigLines;const configs=[];
 for(const path of POLICY.configFiles){
  if(!files.includes(path)||bytes<=0||lines<=0)continue;
  // Bound blobs before loading them; avoid symlinks and large executable files.
  const size=Number(git(repo,['cat-file','-s',`${commit}:${path}`]));if(size>65536)continue;
  const full=git(repo,['show',`${commit}:${path}`]),all=full.split('\n');if(all.at(-1)==='')all.pop();
  let chosen=[];for(const line of all){const cost=Buffer.byteLength(line+'\n');if(chosen.length>=lines||cost>bytes)break;chosen.push(line);bytes-=cost;}
  lines-=chosen.length;configs.push({path,text:chosen.join('\n'),lines:chosen.length,totalLines:all.length,truncated:chosen.length<all.length});
 }
 return {sourceRoots,testRoots,configs,configBytes:POLICY.maxConfigBytes-bytes,configLines:POLICY.maxConfigLines-lines};
}
function configReads(command){
 const segments=shellSegments(command);if(!segments)return [];
 const out=[];
 for(let i=0;i<segments.length;i++){
  const {tokens,separator}=segments[i];
  const quoted=tokens.map(x=>"'"+x.replaceAll("'","'\\''")+"'").join(' ');
  const reads=parseReadCommand(quoted);if(!reads)continue;
  for(const r of reads){if(!POLICY.configFiles.includes(r.file))continue;let end=r.end;
   if(separator==='|'&&segments[i+1]?.tokens[0]==='head'){const h=segments[i+1].tokens;end=h.length===1?10:/^-\d+$/.test(h[1])?Number(h[1].slice(1)):h[1]==='-n'?Number(h[2]):end;}
   out.push({...r,end});}
 }
 return out;
}
const snapshot=JSON.parse(await readFile('data/experiments/router-all-traces-v2/snapshot.json','utf8'));
const folds=JSON.parse(await readFile('data/experiments/router-all-traces-v2/report.json','utf8')).assignments;
const rows=[],packets=[],errors=[];
for(const run of snapshot.runs){
 if(run.arm!=='baseline'||![2,3,4].includes(folds[run.instanceId]))continue;
 let packet;
 try{const task=JSON.parse(await readFile(join(run.directory,'task.json'),'utf8'));packet=orientation(join(run.directory,'checkout'),task.base_commit);packets.push({issue:run.instanceId,run:run.directory,...packet});}
 catch(e){errors.push({issue:run.instanceId,run:run.directory,error:e.message.split('\n')[0]});continue;}
 for(let i=0;i<run.turns.length;i++){
  const t=run.turns[i];if(!t.valid||!t.tags.length||!t.tags.every(x=>['search','file-read','workspace-inspection'].includes(x)))continue;
  const c=t.actions.map(a=>a.command||'').join('\n');const reads=configReads(c);if(!reads.length)continue;
  const checked=reads.map(r=>{const p=packet.configs.find(p=>p.path===r.file);return {...r,exists:!!p,covered:!!p&&p.lines>=(r.end??p.totalLines)};});
  // Every config-bearing turn is retained, including mixed source/test inspection.
  const segments=shellSegments(c)||[];
  const onlyConfig=segments.length>0&&segments.every(s=>['head'].includes(s.tokens[0])||!!parseReadCommand(s.tokens.map(x=>"'"+x.replaceAll("'","'\\''")+"'").join(' '))?.every(r=>POLICY.configFiles.includes(r.file)));
  rows.push({issue:run.instanceId,traceId:t.id,ordinal:i,reads:checked,allRequestedConfigsCovered:checked.every(r=>r.covered),onlyConfig});
 }
}
const summary={runsWithPacket:packets.length,packetErrors:errors.length,configInspectionTurns:rows.length,distinctIssues:new Set(rows.map(r=>r.issue)).size,firstThreeTurns:rows.filter(r=>r.ordinal<3).length,configReadSubsteps:rows.reduce((s,r)=>s+r.reads.length,0),configReadsCovered:rows.reduce((s,r)=>s+r.reads.filter(x=>x.covered).length,0),turnsWithAllConfigReadsCovered:rows.filter(r=>r.allRequestedConfigsCovered).length,configOnlyTurns:rows.filter(r=>r.onlyConfig).length,medianPacketConfigBytes:packets.map(p=>p.configBytes).sort((a,b)=>a-b)[Math.floor(packets.length/2)],maxPacketConfigBytes:Math.max(...packets.map(p=>p.configBytes))};
const out='data/analysis/repo-orientation-v1';await mkdir(out,{recursive:true,mode:0o700});await writeFile(join(out,'report.json'),JSON.stringify({policy:POLICY,scope:'Baseline discovery folds2/3/4 only',summary,rows,packets,errors,limitations:['Static base objects preserve historical startup content but not later edited state.','Configuration content is quoted data, never executed. Root detection is heuristic.','Covered config read substeps do not replace mixed source inspection turns.','Packet adds context; token overhead and downstream benefit unmeasured.','No paid calls and no calibration/evaluation traces inspected.']},null,2),{mode:0o600});console.log(JSON.stringify(summary,null,2));
