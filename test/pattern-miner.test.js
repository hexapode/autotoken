import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReadCommand,parseSearchCommand,searchHits,proposeSearchContext,coversReads,minePatterns} from '../src/pattern-miner.js';
const turn=(id,command,result='Exit code: 0; timed out: false\n')=>({id,valid:true,actions:[{name:'local_bash',command,result}]});
test('read parser accepts fixed read ranges and abstains on modifying or ambiguous shell',()=>{
 assert.deepEqual(parseReadCommand("sed -n '10,20p' src/a.py; head -5 tests/test_a.py"),[{file:'src/a.py',start:10,end:20},{file:'tests/test_a.py',start:1,end:5}]);
 assert.deepEqual(parseReadCommand('cat setup.cfg'),[{file:'setup.cfg',start:1,end:null}]);
 for(const command of ['sed -i s/a/b/ file.py','cat ../secret','head -5 /etc/passwd','sed -n 1,20p file.py; rm file','cat $(pwd)','cat file | python -c x','cat file && echo ok'])assert.equal(parseReadCommand(command),null,command);
});
test('search output inference uses only unambiguous filenames and actual match lines',()=>{
 const command="grep -n 'def foo' src/a.py | head -20";
 assert.ok(parseSearchCommand(command));
 assert.deepEqual(searchHits(command,'Exit code: 0; timed out: false\n10:def foo\n11-context\n'),[{file:'src/a.py',line:10}]);
 assert.deepEqual(searchHits('rg -n foo src/a.py src/b.py','Exit code: 0; timed out: false\n10:ambiguous\nsrc/b.py:30:foo'),[{file:'src/b.py',line:30}]);
 assert.deepEqual(searchHits(command,'Exit code: 1; timed out: false\n10:def foo'),[]);
 assert.equal(parseSearchCommand('grep -n foo file.py; python edit.py'),null);
});
test('search proposals never depend on target action and report full-range coverage only',()=>{
 const previous=turn('first','grep -n foo src/a.py','Exit code: 0; timed out: false\n100:foo');
 const proposal=proposeSearchContext(previous);
 assert.deepEqual(proposal.ranges,[{file:'src/a.py',start:60,end:140}]);
 assert.equal(coversReads(proposal,[{file:'src/a.py',start:90,end:120}]),true);
 assert.equal(coversReads(proposal,[{file:'src/a.py',start:90,end:180}]),false);
 assert.equal(coversReads(proposal,[{file:'src/a.py',start:1,end:null}]),false);
});
test('mining keeps issue partitions frozen and treatment arms excluded',()=>{
 const previous=turn('first','grep -n foo src/a.py','Exit code: 0; timed out: false\n100:foo');
 const runs=[{instanceId:'a',arm:'baseline',model:'m',directory:'a',turns:[previous,turn('second','sed -n 90,110p src/a.py')]},{instanceId:'b',arm:'workflow',model:'m',directory:'b',turns:[previous,turn('second','sed -n 90,110p src/a.py')]}];
 const first=minePatterns({runs,createdAt:'test'},{a:0,b:2});
 assert.equal(first.baselineRuns,1);assert.equal(first.candidates[0].partitions.heldout.wholeReadTurnsCovered,1);
 runs[0].turns[1]=turn('second','sed -n 900,910p src/a.py');
 const changed=minePatterns({runs,createdAt:'test'},{a:0,b:2});
 assert.deepEqual(first.candidates[0].events[0].proposal,changed.candidates[0].events[0].proposal);
 assert.equal(changed.candidates[0].partitions.heldout.wholeReadTurnsCovered,0);
});
