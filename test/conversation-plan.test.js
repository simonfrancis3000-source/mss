import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationIntent, buildScenarioConversationPlan, scenarioConversationGuidance } from '../src/conversation-plan.js';
import { buildTurnObservation } from '../server/amia-store.js';

const objectives = [{id:'one',title:'Visitors'},{id:'two',title:'Privacy'}];
const exchange = i => ({question:`Question ${i}?`,answer:`Preference ${i}`,scenarioId:'room:living_room'});

test('recognises controls and distinguishes a deferral from not applicable', () => {
  for (const [text, expected] of [['Skip this - it does not apply','not_applicable'],["Let's come back to that",'deferred'],['Why are you asking?','explain'],["What's left?",'progress'],['That depends','conditional'],['Pause','pause'],['Change what I said about guests','correction'],['Leave glasses until guests leave','answer']]) assert.equal(conversationIntent(text),expected,text);
  assert.equal(conversationIntent('Skip the cleaning products containing bleach'), 'answer');
});

test('plan retains conversation context and does not infer completion from answers', () => {
  const plan=buildScenarioConversationPlan({objectives,areaStatuses:[{id:'one',status:'discussed'}],continuity:{exchanges:[exchange(1),{question:'Should I clear glasses?',answer:'Not now.'}]},latestUser:'What have we covered?'});
  assert.equal(plan.intent,'progress');
  assert.deepEqual(plan.areas.map(x=>x.status),['discussed','not_started']);
  assert.equal(plan.exchanges[1].disposition,'deferred');
  assert.match(scenarioConversationGuidance(plan),/never count discussed as completed/);
});

test('checkpoints and optional situations appear at separate natural intervals', () => {
  const withCount=n=>buildScenarioConversationPlan({objectives,continuity:{exchanges:Array.from({length:n},(_,i)=>exchange(i))},latestUser:'I prefer that.'});
  assert.equal(withCount(5).checkpoint,true);
  assert.equal(withCount(5).offerSituation,false);
  assert.equal(withCount(8).offerSituation,true);
  assert.equal(buildScenarioConversationPlan({objectives,continuity:{exchanges:Array.from({length:5},(_,i)=>exchange(i))},latestUser:'I prefer that.',messages:[{role:'assistant',content:'Does that sound right?'}]}).checkpoint,false);
});

test('a return uses real exchanges and control requests do not resolve a question', () => {
  const plan=buildScenarioConversationPlan({objectives,continuity:{exchanges:[exchange(1)]},latestUser:'Hello',welcomeBack:true});
  assert.match(scenarioConversationGuidance(plan),/without inventing a decision/);
  const base={userId:'a',scopeKey:'room:living_room',previousAssistant:'When should I clear the glasses?',reply:'It helps me avoid interrupting.'};
  assert.equal(buildTurnObservation({...base,latestUser:'Why are you asking?'}).p_response_question_key,null);
  assert.equal(buildTurnObservation({...base,latestUser:"Let's come back to that"}).p_response_outcome,'deferred');
  assert.equal(buildTurnObservation({...base,latestUser:'Skip this - it does not apply'}).p_response_outcome,'deferred');
});
