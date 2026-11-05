import test from 'node:test';import assert from 'node:assert/strict';
import {cognitiveCases} from '../evals/cognitive-cases.mjs';
import {createCognitiveRuntime} from '../server/cognitive-runtime.js';
import {RuntimeError,validateTurnProposal} from '../server/cognitive-core.js';

// 150 distinct domain/behavior trajectories. Deterministic provider fixtures
// validate orchestration invariants; they are not live-model semantic scores.
for(const c of cognitiveCases)test('conversation/'+c.split+'/'+c.id,async()=>{
 let state={messages:[{role:'assistant',content:c.domain.question}],lastQuestion:c.domain.question},number=0,modelCalls=0,fail=false;
 const ledger=new Map(),effects=[],commits=[];const objectives=[{id:c.domain.id,title:c.domain.title}];
 const runtime=createCognitiveRuntime({
  store:{async claim(auth,input){const done=ledger.get(input.key);return done?{status:'completed',result:done}:{status:'claimed',lease:'lease',state:structuredClone(state)};},
   async commit(auth,input){if(fail)throw new RuntimeError('runtime_storage_unavailable');if(input.action)effects.push(input.action);state=input.state;commits.push(input);ledger.set(input.key,input.result);return {status:'completed',result:input.result};},async release(){},async reminders(){return [];}},
  contextStore:{async loadContext(){return {available:true,rules:[],appliances:['hob','dishwasher','washing machine','coffee machine'].map(type=>({type,brand:'Bosch',model:'ABC1234'}))};}},
  generate:async({context,correction})=>{
   modelCalls++;if(c.behavior==='invalid_json'&&number===3&&!correction)throw new RuntimeError('invalid_model_proposal',502);
   if(c.behavior==='truncated_reply'&&number===3&&!correction)throw new RuntimeError('incomplete_model_proposal',502);
   const offer=['accepted_reminder','cancelled_reminder','retry','failed_write'].includes(c.behavior)&&number===2;
   let reply=offer?'Would you like a reminder to review '+c.domain.title.toLowerCase()+'?':number===1?'What exception would change your preference for '+c.domain.title.toLowerCase()+'?':'For '+c.domain.title.toLowerCase()+', when should I ask you before continuing with step '+number+'?';
   if(c.behavior==='settled_question'&&number===3&&!correction)reply=c.domain.question;
   return validateTurnProposal({schema_version:1,reply,objective_id:c.domain.id,decision_key:c.domain.id+'.dimension_'+number,reminder_offer:offer?{title:'Review '+c.domain.title}:null,actions:[],memory_proposals:[]},objectives);
  }
 });
 const turn=async(content,id)=>{number++;return runtime.turn({auth:{user:{id:'fixture-owner'},trainingRevision:'0'},scope:c.domain.scope,objectives,profile:{preferredLanguage:'en'},body:{clientTurnId:id||'turn'+number,messages:[{role:'user',content}]}});};
 await turn(c.domain.instruction);await turn(c.domain.exception);
 if(c.behavior==='pause_resume'){
  const question=state.lastQuestion;await turn('Pause');const resumed=await turn('Continue');assert.ok(resumed.reply.includes(question));
 }else if(['accepted_reminder','retry','failed_write'].includes(c.behavior)){
  if(c.behavior==='failed_write'){fail=true;await assert.rejects(turn('Yes please','accept'));assert.equal(effects.length,0);fail=false;}
  const saved=await turn('Yes please','accept');assert.match(saved.reply,/Added to your reminders/);const again=await turn('Yes please','accept');assert.equal(again.runtime.replayed,true);assert.equal(effects.length,1);
 }else if(c.behavior==='cancelled_reminder'){await turn('No thanks');assert.equal(effects.length,0);assert.equal(state.pendingOffer,null);
 }else{
  const input={defer:'Later',skip:'Not applicable',correction:'Actually, change my preference: '+c.domain.instruction,conflict:'That depends on the circumstances.',permission_boundary:'Do not assume permission beyond that exact action.'}[c.behavior]||'Please keep the exception in mind.';
  const final=await turn(input);assert.ok(/[?？؟]/u.test(final.reply));assert.equal(effects.length,0);
 }
 assert.ok(commits.length>=3);assert.equal(state.completed,undefined);assert.ok(modelCalls<=5);
 assert.ok(!commits.some(v=>v.action&&v.action.type!=='add'));
});
