import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTurnObservation,createAmiaStore,questionInReply,questionKey,storedDecisionGuidance,amiaScope } from '../server/amia-store.js';
import { ruleSourceReferences,scenarioReviewRecord,scenarioTestRecord } from '../src/amia-persistence.js';
import { cleanPersonaMemoryCandidate } from '../src/persona-memory.js';

const auth={user:{id:'account-a'},accessToken:'account-token'};
const time='2026-10-31T12:00:00.000Z';
test('turn observations record questions and responses without upgrading them to known decisions',()=>{
  const base={userId:'account-a',sourceTimestamp:time,scopeKey:'room:kitchen',topic:'kitchen',previousAssistant:'Where should I put the scraps?',reply:'I can leave that open for now. What should I wash by hand?',latestUser:'Later.'};
  const observation=buildTurnObservation(base);
  assert.equal(observation.p_response_outcome,'deferred');
  assert.equal(observation.p_question,'What should I wash by hand?');
  assert.equal(observation.p_checks.question_count,1);
  assert.equal(buildTurnObservation({...base,latestUser:'In the caddy.'}).p_response_outcome,'response_received');
  assert.equal(buildTurnObservation(base).p_turn_key,observation.p_turn_key);
  assert.notEqual(buildTurnObservation({...base,userId:'account-b'}).p_turn_key,observation.p_turn_key);
  assert.doesNotMatch(JSON.stringify(observation),/Later|In the caddy/);
});
test('question observations exclude sensitive fields and handle non-English question punctuation',()=>{
  assert.equal(questionInReply('What is your password?').question,null);
  assert.equal(questionInReply('どうしますか？').count,1);
  assert.equal(questionKey(' Where should it go? '),questionKey('where should it go?'));
  assert.equal(questionInReply('I will leave it there.').question,null);
});
test('persona permissions require an explicit boundary and never grant inferred permission',()=>{
  const candidate={statement:'Ask me before ordering replacement supplies.',kind:'boundary',permission_policy:'ask_first',status:'user_stated'};
  assert.equal(cleanPersonaMemoryCandidate(candidate).permission_policy,'ask_first');
  assert.equal(cleanPersonaMemoryCandidate({...candidate,status:'inferred_pending_confirmation',permission_policy:'allowed'}).permission_policy,'unspecified');
  assert.equal(cleanPersonaMemoryCandidate({...candidate,kind:'preference',permission_policy:'allowed'}).permission_policy,'unspecified');
});
test('source references are bounded, deduplicated metadata, without copying raw source text',()=>{
  const refs=ruleSourceReferences([{conversation_key:'main',role:'user',message_timestamp:time,raw:'private text'}],time);
  assert.equal(refs.length,1);
  assert.equal(refs[0].message_timestamp,time);
  assert.equal('raw' in refs[0],false);
  assert.deepEqual(ruleSourceReferences([], 'invalid'),[]);
});
test('self review is distinguished from measured scenario test results',()=>{
  const review=scenarioReviewRecord({userId:'account-a',scenarioId:'room:kitchen',startedAt:time,checks:[true,true,true],userTurnCount:3});
  assert.equal(review.outcome,'self_reported_complete');
  assert.equal(review.origin,'user_self_report');
  assert.equal(scenarioReviewRecord({userId:'account-a',scenarioId:'room:kitchen',startedAt:time,checks:[true,false,true],userTurnCount:3}),null);
  const report={run_id:'run-1',scenario_id:'room:kitchen',engine_version:'test-v1',outcome:'passed',assertions:[{id:'permissions',passed:false},{id:'exceptions',passed:true}]};
  const result=scenarioTestRecord('account-a',report);
  assert.equal(result.outcome,'failed');
  assert.equal(result.checks.failed,1);
  assert.equal(scenarioTestRecord('account-a',{...report,assertions:[]}),null);
  assert.equal(scenarioTestRecord('account-a',{...report,scenario_id:'invented'}),null);
});
test('store reads and writes use only the authenticated user token and explicit account filter',async()=>{
  const calls=[];
  const store=createAmiaStore({supabaseUrl:'https://database.test',publishableKey:'public-key',fetchImpl:async(url,options)=>{
    calls.push({url,options});
    if(url.includes('/rpc/'))return new Response(JSON.stringify({saved:true,evaluation_id:'event'}));
    if(url.includes('synqme_persona_memories'))return new Response(JSON.stringify([{id:'rule',memory_key:'rule-key',statement:'I prefer the dishwasher after dinner.',status:'user_confirmed',topic:'kitchen',permission_policy:'unspecified'}]));
    return new Response('[]');
  }});
  const context=await store.loadContext(auth,{scopeKey:'room:kitchen',query:'dishwasher'});
  assert.equal(context.available,true);
  assert.equal(context.rules.length,1);
  for(const call of calls){assert.equal(new URL(call.url).searchParams.get('user_id'),'eq.account-a');assert.equal(call.options.headers.Authorization,'Bearer account-token');}
  const observation=buildTurnObservation({userId:'account-a',sourceTimestamp:time,scopeKey:'room:kitchen',topic:'kitchen',reply:'When should I run it?',latestUser:'Dishwasher.'});
  assert.equal((await store.recordTurn(auth,observation)).status,'saved');
  assert.equal(JSON.parse(calls.at(-1).options.body).user_id,undefined);
  assert.match(storedDecisionGuidance(context),/response_received question is not automatically resolved/);
});
test('storage failures are reported without discarding the conversation reply',async()=>{
  const store=createAmiaStore({supabaseUrl:'https://database.test',publishableKey:'key',fetchImpl:async()=>new Response('{}',{status:503})});
  assert.equal((await store.loadContext(auth,{scopeKey:'room:kitchen',query:'dishwasher'})).available,false);
  assert.equal((await store.recordTurn(auth,{})).status,'unavailable');
});
test('decision scope follows validated room task or outdoor scenario',()=>{
  assert.equal(amiaScope({roomJourney:{activeRoomId:'kitchen',activeTaskId:'dishwashing'},query:'plates'}).scopeKey,'room:kitchen:dishwashing');
  assert.equal(amiaScope({outOfHomeScenario:{categoryId:'strangers',scenarioId:'adult-approaches'}}).scopeKey,'outside:strangers:adult-approaches');
});
