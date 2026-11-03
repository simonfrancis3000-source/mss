import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
import {coalesceTranscriptTurns,bestUserTranscript,isServiceErrorText} from '../src/transcript-turns.js';
import {isUsefulStandalonePreference} from '../src/persona-memory.js';
test('partial device snapshots collapse to the complete utterance and keep separate real turns',()=>{
 const timestamp='2026-11-03T00:00:00Z';
 const messages=coalesceTranscriptTurns([{role:'user',timestamp,content:'If'},{role:'user',timestamp,content:'If you are unsure, leave the glasses by the sink.'},{role:'user',timestamp,content:'If you'},{role:'assistant',timestamp:'2026-11-03T00:00:01Z',content:'I can’t generate a reply right now. Please try again shortly.'},{role:'user',timestamp:'2026-11-03T00:00:02Z',content:'Yes'},{role:'user',timestamp:'2026-11-03T00:00:03Z',content:'Yes'}]);
 assert.equal(messages.length,3);assert.match(messages[0].content,/glasses by the sink/);
 assert.equal(bestUserTranscript('If','If I am away, wait for me.'),'If I am away, wait for me.');
 assert.equal(bestUserTranscript('On the table.','Move the glasses.'),'On the table.');
});
test('final transcripts outrank stale longer drafts and live drafts are not saved',()=>{
 const id='turn-one';const result=coalesceTranscriptTurns([{role:'user',voice_turn_id:id,content:'No, leave them outside the dishwasher.',transcript_final:true},{role:'user',voice_turn_id:id,content:'No, leave them outside the dishwasher because maybe I',transcript_final:false}]);
 assert.equal(result.length,1);assert.equal(result[0].content,'No, leave them outside the dishwasher.');
 for(const value of ['Are you back up','Can you talk now','Why can’t you generate a reply'])assert.equal(isUsefulStandalonePreference(value),false);
 assert.equal(isUsefulStandalonePreference('Ask me before moving the papers on my desk.'),true);
 assert.equal(isServiceErrorText('I can’t generate a reply right now.'),true);
});
test('a live user bubble updates by stable identity across a reordering and saves only its final text',async()=>{
 const source=await readFile(new URL('../src/synqme.js',import.meta.url),'utf8');const fn=source.match(/function syncPhonicTranscriptItems\([^]*?\n\}/)[0];
 const saved=[];const state={messages:[{role:'assistant',content:'Where should I leave the dishes?'}],preferences:[]};let ids=0;
 const context=vm.createContext({state,phonicItemMap:new Map(),phonicTurnMetadata:new Map(),phonicTranscriptRenderPending:false,crypto:{randomUUID:()=>String(++ids)},Date,Set,globalThis:null,window:{requestAnimationFrame:fn=>fn()},todoCommandForMessage:()=>null,voiceBreakTracker:{awaiting:()=>false},breakResponse:()=> 'other',resolvePendingClarification:()=>false,isClarificationRequest:()=>false,savePreference:value=>saved.push(value),shouldExtractPersonaMemory:()=>true,persist(){},renderAll(){},renderMessages(){}});context.globalThis=context;
 vm.runInContext(fn,context);context.items=[{role:'user',itemIdx:3,text:'By'}];vm.runInContext('syncPhonicTranscriptItems(items)',context);assert.equal(saved.length,0);assert.equal(state.messages.length,2);
 state.messages.unshift({role:'assistant',content:'Older synchronized message.'});context.items=[{role:'user',itemIdx:3,text:'By the sink.'}];vm.runInContext('syncPhonicTranscriptItems(items,{finalize:true})',context);
 assert.deepEqual(saved,['By the sink.']);assert.equal(state.messages.filter(m=>m.role==='user').length,1);assert.equal(state.messages.find(m=>m.role==='user').content,'By the sink.');
 context.items=[{role:'user',itemIdx:3,text:'By'}];vm.runInContext('syncPhonicTranscriptItems(items)',context);assert.equal(state.messages.find(m=>m.role==='user').content,'By the sink.');
});
