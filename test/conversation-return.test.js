import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldWelcomeBack,welcomeBackReply,spokenSentenceBreaks,RETURN_GREETING_GAP_MS} from '../src/conversation-return.js';
import {PHONIC_LANGUAGES,SUPPORTED_CONVERSATION_LANGUAGES} from '../src/conversation-languages.js';
test('return greeting starts at twelve hours and ignores assistant messages',()=>{
 const timestamp='2026-11-01T00:00:00Z';const messages=[{role:'user',timestamp},{role:'assistant',timestamp:'2026-11-01T05:00:00Z'}];const base=Date.parse(timestamp);
 assert.equal(shouldWelcomeBack(messages,base+RETURN_GREETING_GAP_MS-1),false);
 assert.equal(shouldWelcomeBack(messages,base+RETURN_GREETING_GAP_MS),true);
 assert.equal(shouldWelcomeBack([],base),false);
 assert.equal(shouldWelcomeBack([{role:'user',timestamp:'bad'}],base),false);
 assert.equal(shouldWelcomeBack([{role:'user',timestamp:'2026-11-02T00:00:00Z'}],base),false);
});
test('return greeting uses the owner name once and speech preserves sentence boundaries',()=>{
 assert.equal(welcomeBackReply('Shall we continue?','Simon Francis'),'Welcome back, Simon.\n\nShall we continue?');
 assert.equal(welcomeBackReply('Welcome back, Simon. Shall we continue?','Simon'),'Welcome back, Simon. Shall we continue?');
 assert.equal(spokenSentenceBreaks('Understood. How should I handle spills?'),'Understood.\n\nHow should I handle spills?');
});
test('all fifty-two Phonic languages are available consistently',()=>{
 assert.equal(PHONIC_LANGUAGES.length,52);assert.equal(SUPPORTED_CONVERSATION_LANGUAGES.size,52);
 for(const code of ['en','es','de','ko','yue','fil','vi','sw'])assert.ok(SUPPORTED_CONVERSATION_LANGUAGES.has(code));
 assert.equal(SUPPORTED_CONVERSATION_LANGUAGES.has('invented'),false);
});

test('completion review requires every task when detailed task review is supplied',async()=>{
 const {scenarioReviewRecord}=await import('../src/amia-persistence.js');
 const {SCENARIOS,scenarioTasks}=await import('../src/scenario-journey.js');
 const scenario=SCENARIOS.find(item=>item.roomId==='living_room');
 const base={userId:'test-user',scenarioId:scenario.id,startedAt:'2026-11-01T12:00:00Z',checks:[true,true,true],userTurnCount:10};
 assert.equal(scenarioReviewRecord({...base,reviewedTaskIds:['tidying']}),null);
 assert.ok(scenarioReviewRecord({...base,reviewedTaskIds:scenarioTasks(scenario).map(task=>task.id)}));
});
