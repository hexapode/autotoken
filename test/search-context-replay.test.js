import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSearchEvidence,parseReadRanges,proposeFromTurn,scoreRanges,evaluateSearchReplay} from '../src/search-context-replay.js';
const action=(command,output='20:match')=>({name:'local_bash',command,result:'Exit code: 0; timed out: false\n'+output});
const turn=(command,output)=>({id:'source',valid:true,tags:['search'],actions:[action(command,output)]});
test('numbered single-file grep infers path only from prior command',()=>{
 const result=parseSearchEvidence(action("grep -n 'function' src/a.py",'20:function'));
 assert.deepEqual(result.matches,[{path:'src/a.py',line:20}]);
 assert.equal(parseSearchEvidence(action("grep -n 'x' a.py b.py",'20:ambiguous')).supported,false);
 assert.equal(parseSearchEvidence(action("grep -n 'x' a.py; grep -n 'x' b.py",'20:ambiguous')).supported,false);
});
test('mixed search commands, substitutions, unnumbered or failed results abstain',()=>{
 for(const command of ["python -c 'print(1)'; grep -n x a.py",'grep -n x $(pwd)/a.py','grep -n x a.py && rm x'])assert.equal(parseSearchEvidence(action(command)).supported,false);
 assert.equal(parseSearchEvidence(action('grep -l x a.py','a.py')).supported,false);
 const failed=action('grep -n x a.py');failed.result='Exit code: 1; timed out: false\n';assert.equal(parseSearchEvidence(failed).supported,false);
});
test('prefixed multiple-file matches and context lines are separated',()=>{
 const parsed=parseSearchEvidence(action('rg -n x src', 'src/a.py:20:x\nsrc/a.py-21-context\nsrc/b.py:8:x'));
 assert.deepEqual(parsed.matches,[{path:'src/a.py',line:20},{path:'src/b.py',line:8}]);assert.equal(parsed.visible.length,3);
});
test('read labels accept bounded reads only, and coverage is whole-turn',()=>{
 const label=parseReadRanges({valid:true,actions:[action("sed -n '10,30p' src/a.py; head -n 5 src/b.py")]});assert.equal(label.supported,true);
 const metrics=scoreRanges(label.ranges,[{path:'src/a.py',start:1,end:40}]);assert.equal(metrics.wholeNextTurnCovered,false);assert.equal(metrics.partiallyCovered,true);
 assert.equal(parseReadRanges({valid:true,actions:[action('cat src/a.py')]}).supported,false);
 assert.equal(parseReadRanges({valid:true,actions:[action('sed -n 1,5p src/a.py; pytest')]}).supported,false);
});
test('target response cannot alter proposal; split and bounded overhead remain explicit',()=>{
 const source=turn('grep -n x src/a.py','50:x');const target={id:'target',valid:true,actions:[action('sed -n 45,55p src/a.py')]};
 const snapshot={runs:[{instanceId:'test-issue',arm:'baseline',turns:[source,target]}]};
 const first=evaluateSearchReplay(snapshot,{'test-issue':0});assert.equal(first.primary.test.wholeNextTurnsCovered,1);
 target.actions[0].command='sed -n 900,999p other.py';const second=evaluateSearchReplay(snapshot,{'test-issue':0});
 assert.deepEqual(first.rows[0].proposal,second.rows[0].proposal);assert.equal(second.primary.test.wholeNextTurnsCovered,0);
 assert.ok(proposeFromTurn(source).proposedLines<=200);
});
