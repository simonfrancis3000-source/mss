import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationCheckpoint, validatedConversationCheckpoint, englishResumeReply } from '../src/conversation-resume.js';
import { SCENARIOS } from '../src/scenario-journey.js';
import { conversationIntent } from '../src/conversation-plan.js';
import { buildTurnObservation } from '../server/amia-store.js';
import { guardScenarioQuestion } from '../server/continuity-guard.js';
import { isUsefulStandalonePreference } from '../src/persona-memory.js';
const scenario = 'room:kitchen';
const item = (role, content, scenario_id = scenario) => ({ role, content, scenario_id });
const question = 'Where do you keep them?';
const context = 'We were discussing the cleaning products you approve for me to use.\n\n' + question;
const history = [item('assistant', context), item('user', 'What next?'), item('assistant', 'Is anything in the kitchen off limits?'), item('user', 'What next?')];

test('a continuation request retains the unanswered cleaning-products question and its pronoun context', () => {
 const checkpoint = conversationCheckpoint(history, scenario);
 assert.equal(checkpoint.question, question);
 assert.match(checkpoint.context, /cleaning products/);
 assert.match(englishResumeReply(checkpoint, 'Simon Francis'), /^Welcome back, Simon/);
 assert.doesNotMatch(englishResumeReply(checkpoint, 'Simon'), /off limits/);
 for(const content of ['What next?', 'Continue', 'Hello', 'Please continue']) {
  assert.equal(conversationIntent(content), 'resume');
  assert.equal(isUsefulStandalonePreference(content), false);
  assert.equal(buildTurnObservation({userId:'owner',scopeKey:scenario,latestUser:content,previousAssistant:context,reply:context}).p_response_question_key, null);
 }
});

test('real answers, deferrals and scenario changes are distinguished from resuming', () => {
 assert.equal(conversationCheckpoint([...history, item('user','Under the sink.')], scenario), null);
 assert.equal(conversationCheckpoint([...history, item('user','Skip this')], scenario), null);
 const outside = [...history, item('assistant','Should I introduce myself?', 'outside:social:introductions')];
 assert.equal(conversationCheckpoint(outside, scenario).question, question);
 const next = conversationCheckpoint([...history,item('user','Under the sink.'),item('assistant','Should I ask before using the last bottle?')],scenario);
 assert.match(next.question, /last bottle/);
 assert.equal(next.lastExchange.answer, 'Under the sink.');
});

test('only the selected unanswered question can bypass repeat rejection during a resume', async () => {
 const continuity = {exchanges:[{question,answer:'What next?'}]};
 let reviews=0;
 const review=async()=>{reviews++;return {repeated_question:true};};
 const resumed=await guardScenarioQuestion({draft:context,continuity,resumeQuestion:question,review});
 assert.equal(resumed.reply, context);assert.equal(reviews,0);
 const other=await guardScenarioQuestion({draft:'Would you prefer bleach?',continuity,resumeQuestion:question,review,rewrite:async()=> 'I will wait.'});
 assert.equal(reviews,1);assert.equal(other.blocked,true);
 const extra=await guardScenarioQuestion({draft:context+'\n\nWould you prefer bleach?',continuity,resumeQuestion:question,review,rewrite:async()=> 'I will wait.'});
 assert.equal(extra.reply,'I will wait.');
});

test('all 25 scenarios keep a scoped checkpoint and stale or answered supplied checkpoints are rejected',()=>{
 for(const selected of SCENARIOS) {
  const checkpoint=conversationCheckpoint([item('assistant',context,selected.id),item('user','Continue',selected.id)],selected.id);
  assert.equal(checkpoint.scenarioId,selected.id);
  assert.equal(checkpoint.question,question);
  const continuity={exchanges:[{question,answer:'What next?'}]};
  assert.ok(validatedConversationCheckpoint(checkpoint,selected.id,continuity));
  assert.equal(validatedConversationCheckpoint(checkpoint,'unknown',continuity),null);
  assert.equal(validatedConversationCheckpoint(checkpoint,selected.id,{exchanges:[{question,answer:'Under the sink.'}]}),null);
  assert.equal(validatedConversationCheckpoint({...checkpoint,context:context+' Should I use bleach?'},selected.id,continuity),null);
 }
});
