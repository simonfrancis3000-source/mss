import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
async function harness(){
 const source=await readFile(new URL('../src/synqme.js',import.meta.url),'utf8');
 const code=['updateVoiceExperience','showVoiceAudioPause','showVoiceWaitingForUser'].map(name=>source.match(new RegExp('function '+name+'\\([^]*?\\n\\}'))[0]).join('\n');
 const pending=new Map();let next=0;
 const elements={voiceOrb:{dataset:{}},voiceExperienceStatus:{textContent:''},conversationStatus:{textContent:''},voiceStatus:{textContent:''}};
 const context=vm.createContext({document:{},elements,state:{profile:{ownerName:'Simon'}},assistantIsSpeaking:true,voiceAudioPauseTimer:null,voiceModeActive:true,voiceInputMuted:false,phonicAssistantSpeechStartedAt:0,phonicAssistantSpeechMs:0,Date,
   selectedCompanionDisplayName:()=> 'Freddie',companionThinkingMessage:()=> 'Freddie is thinking…',syncRobotSpeaking(){},armVoiceIdle(){},
   window:{setTimeout(fn){const id=++next;pending.set(id,fn);return id;},clearTimeout(id){pending.delete(id);}}});
 vm.runInContext(code,context);
 return {context,elements,run:code=>vm.runInContext(code,context),tick(){for(const [id,fn] of [...pending]){pending.delete(id);fn();}}};
}
test('brief playback gaps keep the speech label and waiting cancels a pending thinking transition',async()=>{
 const h=await harness();h.run('updateVoiceExperience("speaking", "Freddie is speaking.");showVoiceAudioPause();');
 assert.equal(h.elements.voiceOrb.dataset.state,'speech-pause');assert.equal(h.elements.voiceExperienceStatus.textContent,'Freddie is speaking.');
 h.run('showVoiceWaitingForUser();');h.tick();
 assert.equal(h.elements.voiceOrb.dataset.state,'listening');assert.equal(h.elements.voiceExperienceStatus.textContent,'Waiting on Simon.');
 assert.equal(h.elements.conversationStatus.textContent,'Waiting on Simon.');
});
test('speech resumes without flashing thinking and an interruption cancels the old pause timer',async()=>{
 const h=await harness();h.run('updateVoiceExperience("speaking", "Freddie is speaking.");showVoiceAudioPause();assistantIsSpeaking=true;updateVoiceExperience("speaking", "Freddie is speaking.");');h.tick();
 assert.equal(h.elements.voiceExperienceStatus.textContent,'Freddie is speaking.');
 h.run('showVoiceAudioPause();updateVoiceExperience("user-speaking", "Listening to you…");');h.tick();
 assert.equal(h.elements.voiceOrb.dataset.state,'user-speaking');assert.equal(h.elements.voiceExperienceStatus.textContent,'Listening to you…');
});
test('a genuine stream stall can still show thinking after the grace period',async()=>{
 const h=await harness();h.run('updateVoiceExperience("speaking", "Freddie is speaking.");showVoiceAudioPause();');h.tick();
 assert.equal(h.elements.voiceOrb.dataset.state,'thinking');
});
