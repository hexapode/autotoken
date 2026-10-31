import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {posix} from 'node:path';
import {shellSegments} from '../src/pattern-miner.js';
import {planUniqueNavigation} from './mine-public-swe-agent-plan.mjs';
const [path,out]=process.argv.slice(2);
if(!path||!out)throw Error('Usage: node scripts/mine-public-swe-agent.mjs INPUT_JSONL OUTPUT_DIRECTORY');
const records=(await readFile(path,'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(r=>r.harness==='swe-agent'&&r.partition==='discovery');
const events={unique_file_navigation:[],unique_match_navigation:[],repeated_invalid_command:[],repeated_rejected_edit:[],scroll_continuation:[]};
const one=t=>t?.actions?.length===1&&t.actions[0].name==='swe_agent_action'?t.actions[0]:null;
const result=a=>(a?.results||[]).map(r=>typeof r.content==='string'?r.content:'').join('\n');
const verb=a=>a?.command?.trim().split(/\s/)[0];
function sameNavigation(proposal,next,output){
 if(!next||next.command.includes('\n'))return false;
 const segments=shellSegments(next.command);if(!segments||segments.length!==1||segments[0].separator)return false;
 const args=segments[0].tokens;
 if(proposal.line)return args.length===2&&args[0]==='goto'&&args[1]===String(proposal.line);
 if(args.length!==2||args[0]!=='open')return false;
 const cwd=output.match(/^\(Current directory: ([^\n]+)\)$/m)?.[1];
 return posix.resolve(cwd,args[1])===proposal.file;
}
let turns=0,actions=0,unsupported=0,uniqueFilePlans=0,uniqueMatchPlans=0;
for(const record of records){
 turns+=record.turns.length;actions+=record.turns.reduce((n,t)=>n+t.actions.length,0);unsupported+=record.unsupportedActionTurns;
 for(let i=0;i<record.turns.length;i++){
  const t=record.turns[i],a=one(t);if(!a)continue;
  const output=result(a),proposal=planUniqueNavigation({command:a.command,output}); // Before next action consulted.
  const next=one(record.turns[i+1]),base={recordId:record.id,issue:record.instanceId,turn:t.ordinal,nextTurn:record.turns[i+1]?.ordinal};
  if(proposal.status==='planned'){
   const key=proposal.line?'unique_match_navigation':'unique_file_navigation';
   if(proposal.line)uniqueMatchPlans++;else uniqueFilePlans++;
   const wholeNextActionMatches=sameNavigation(proposal,next,output),nextOutput=result(next);
   const displayedFile=nextOutput.match(/^\[File: ([^\n]+) \(\d+ lines total\)\]/m)?.[1];
   const nextDisplayMatches=wholeNextActionMatches&&displayedFile===proposal.file;
   const nextExplicitError=wholeNextActionMatches&&/^(?:File .*not found|Error:|ERROR:|Invalid line|Line number .*out of|\/bin\/bash:.*command not found)/m.test(nextOutput);
   events[key].push({...base,sourceVerb:verb(a),proposal,wholeNextActionMatches,nextDisplayMatches,nextExplicitError,nextVerb:verb(next)||null});
  }
  if(/(?:command not found|Unknown command|unrecognized command)/i.test(output))events.repeated_invalid_command.push({...base,commandVerb:verb(a),identicalNextCommand:next?.command===a.command,nextVerb:verb(next)||null});
  if(verb(a)==='edit'&&/Your changes have NOT been applied|Your proposed edit has introduced new syntax error/i.test(output))events.repeated_rejected_edit.push({...base,identicalNextCommand:next?.command===a.command,nextIsEdit:verb(next)==='edit'});
  if(['scroll_down','scroll_up'].includes(a.command.trim()))events.scroll_continuation.push({...base,direction:a.command.trim(),nextSameScroll:next?.command.trim()===a.command.trim(),nextIsEdit:verb(next)==='edit'});
 }
}
const summary=Object.fromEntries(Object.entries(events).map(([name,rows])=>[name,{events:rows.length,issues:new Set(rows.map(e=>e.issue)).size,...(name.startsWith('unique_')?{wholeNextActionMatches:rows.filter(e=>e.wholeNextActionMatches).length,nextDisplayMatches:rows.filter(e=>e.nextDisplayMatches).length,nextExplicitErrors:rows.filter(e=>e.nextExplicitError).length,matchedWithoutDisplayEvidence:rows.filter(e=>e.wholeNextActionMatches&&!e.nextDisplayMatches&&!e.nextExplicitError).length,matchedIssues:new Set(rows.filter(e=>e.wholeNextActionMatches).map(e=>e.issue)).size,nextVerbCounts:Object.fromEntries([...new Set(rows.map(e=>e.nextVerb))].map(v=>[v,rows.filter(e=>e.nextVerb===v).length]))}:{}),...(name==='repeated_invalid_command'||name==='repeated_rejected_edit'?{identicalNextCommand:rows.filter(e=>e.identicalNextCommand).length,repeatIssues:new Set(rows.filter(e=>e.identicalNextCommand).map(e=>e.issue)).size}:{}),...(name==='scroll_continuation'?{nextSameScroll:rows.filter(e=>e.nextSameScroll).length,nextIsEdit:rows.filter(e=>e.nextIsEdit).length}:{})}]));
const report={scope:'public SWE-agent discovery sample only',modelRecords:Object.fromEntries([...new Set(records.map(r=>r.model))].map(model=>[model,records.filter(r=>r.model===model).length])),denominator:{records:records.length,issues:new Set(records.map(r=>r.instanceId)).size,turns,actions,unsupportedActionTurns:unsupported},summary,events,limitations:['SWE-agent custom commands are not bash; no recorded action executed.','Unique navigation proposals use only prior result and current harness state; next action is an offline label.','Navigation changes open-file state; deployment must use a harness adapter and preserve state/observations.','Exact next action matches are opportunities, not avoided calls or proven task outcomes.','Repeated failed actions may warrant cycle detection but returning the same error alone cannot repair model reasoning or save the generation already made.','Scroll continuation does not reveal a safe stop condition in prior information.','Sample is discovery-only:92 records use swe-agent-llama-70b,7 llama-8b,1 llama-405b; no token/timing usage. Failure loops are not evidence of modern model generality.']};
await mkdir(out,{recursive:true});await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({denominator:report.denominator,summary},null,2));
