import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {searchTextContext,expandMatchRanges} from '../src/context-core.js';
import {expandMatchRanges as nodeRanges} from '../src/search-context.js';
test('browser core runs real bounded matching and shares server expansion',()=>{
 const text='intro\ndef total(values):\n    result = sum(values)\n    return result\nfooter';
 const result=searchTextContext({text,query:'^def total',mode:'regex',before:1,after:2});
 assert.equal(result.status,'ok');assert.deepEqual(result.matches,[{path:'checkout.py',line:2}]);assert.deepEqual(result.ranges[0].lines.map(l=>l.number),[1,2,3,4]);
 assert.equal(nodeRanges,expandMatchRanges);assert.equal(searchTextContext({text,query:'sum.*',mode:'regex'}).status,'abstained');
});
test('browser core refuses oversized text and limits real outputs',()=>{
 assert.equal(searchTextContext({text:'x'.repeat(32769),query:'x'}).status,'abstained');
 const result=searchTextContext({text:Array.from({length:100},()=> 'match').join('\n'),query:'match',before:0,after:0,maxLines:10});
 assert.equal(result.truncated,true);assert.ok(result.ranges.reduce((n,r)=>n+r.lines.length,0)<=10);assert.ok(result.reasons.includes('match_limit'));
});
test('browser module has no Node imports or hidden services',async()=>{
 const source=await readFile(new URL('../src/context-core.js',import.meta.url),'utf8');
 assert.ok(!source.includes('node:'));assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(source));
});
