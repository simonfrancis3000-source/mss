import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createVoiceBreakTracker,breakResponse,responseBeforeBreak,standardBreakPhrase,VOICE_BREAK_INTERVAL_MS} from '../src/voice-break.js';

test('break is offered once after 15 active minutes and resets when continuing',()=>{
 let now=1000;const tracker=createVoiceBreakTracker(()=>now);tracker.start();
 now+=VOICE_BREAK_INTERVAL_MS-1;assert.equal(tracker.due(),false);now++;assert.equal(tracker.due(),true);
 tracker.offered();assert.equal(tracker.due(),false);assert.equal(tracker.awaiting(),true);
 tracker.resume();assert.equal(tracker.awaiting(),false);assert.equal(tracker.due(),false);
 now+=VOICE_BREAK_INTERVAL_MS;assert.equal(tracker.due(),true);tracker.stop();assert.equal(tracker.due(),false);
});
test('the offer has one clear choice and break responses do not guess yes',()=>{
 assert.equal(breakResponse('Take a short break'),'pause'); assert.equal(breakResponse('carry on'),'continue');
 assert.equal(breakResponse('yes'),'clarify'); assert.equal(breakResponse('The dishwasher is quiet'),'other');
 assert.equal(responseBeforeBreak('Got it. Where should the glasses go?'),'Got it.');
 assert.match(standardBreakPhrase('en'),/15 minutes/);assert.match(standardBreakPhrase('es'),/15 minutos/);
});
test('repeated waiting events do not extend the 30-second microphone timeout',async()=>{
 const source=await readFile(new URL('../src/synqme.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('function clearVoiceIdle()'),source.indexOf('document.addEventListener("visibilitychange"'));
 let now=1000, sequence=0, stopped=0;const pending=new Map();
 const context=vm.createContext({voiceModeActive:true,voiceIdleDeadline:0,voiceIdleTimer:null,Date:{now:()=>now},clearTimeout:id=>pending.delete(id),setTimeout:(fn,ms)=>{let id=++sequence;pending.set(id,{fn,at:now+ms});return id;},stopVoiceConversation:()=>stopped++});
 vm.runInContext(code,context);context.armVoiceIdle();const deadline=context.voiceIdleDeadline;
 now+=20000;context.armVoiceIdle();assert.equal(context.voiceIdleDeadline,deadline);assert.equal(pending.size,1);
 now+=10000;for(const timer of pending.values()) if(timer.at<=now) timer.fn();assert.equal(stopped,1);
});
