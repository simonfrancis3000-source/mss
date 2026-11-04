import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTrainingStep, visitLearnings, visitAnswerCount, createTrainingVisitStore, saveVisitCheckpoint } from '../src/training-visit.js';
const scenario = { id: 'room:kitchen' };
const tasks = [{ id: 'dishes', title: 'Dishes' }, { id: 'coffee', title: 'Coffee' }];
const visit = { user_id: 'a', revision: 1, scenario_id: scenario.id, area_id: 'dishes', started_at: '2026-11-03T10:00:00Z', ended_at: '2026-11-03T10:05:00Z' };

test('next step resumes the exact outstanding question before choosing another task', () => {
  const step = nextTrainingStep({ scenario, tasks, activeAreaId: 'dishes', checkpoint: { scenarioId: scenario.id, question: 'Which cloth should I use?' } });
  assert.equal(step.kind, 'resume'); assert.equal(step.areaId, 'dishes'); assert.equal(step.description, 'Which cloth should I use?');
});
test('a short task skips reviewed areas but never unlocks or completes a module', () => {
  assert.equal(nextTrainingStep({ scenario, tasks, reviewed: ['dishes'] }).areaId, 'coffee');
  assert.equal(nextTrainingStep({ scenario, tasks, reviewed: ['dishes', 'coffee'] }).kind, 'review');
  assert.equal(nextTrainingStep({ tasks }), null);
});
test('recap includes saved owner statements, preserving conditions and late jobs from this visit', () => {
  const record = { statement: 'Ask me before starting the dishwasher.', status: 'user_stated', attributes: { scenario_id: scenario.id }, source_timestamp: '2026-11-03T10:03:00Z', created_at: '2026-11-03T10:06:00Z', conditions: ['Only when I am at home'], permission_policy: 'ask_first' };
  const records = [record, { ...record }, { ...record, status: 'inferred_pending_confirmation' }, { ...record, status: 'conflicting' }, { ...record, attributes: { scenario_id: 'room:bathroom' } }, { ...record, source_timestamp: '2026-11-03T10:10:00Z' }, { ...record, created_at: '2026-11-03T09:00:00Z' }];
  assert.deepEqual(visitLearnings(records, visit), [record]);
});
test('visit count excludes other modules, unfinished transcripts and requests to resume', () => {
  const base = { role: 'user', timestamp: '2026-11-03T10:03:00Z', scenario_id: scenario.id, content: 'I prefer a little milk in my coffee.' };
  assert.equal(visitAnswerCount([base, { ...base, content: 'Continue' }, { ...base, transcript_final: false }, { ...base, scenario_id: 'room:bathroom' }, { ...base, timestamp: '2026-11-03T10:06:00Z' }], visit), 1);
});
test('visit checkpoints survive storage failure and remain isolated by account and reset', () => {
  let now = '2026-11-03T10:00:00Z';
  const store = createTrainingVisitStore({ storage: { getItem() { throw Error(); }, setItem() { throw Error(); } }, now: () => now });
  const first = store.begin({ userId: 'a', revision: 1, scenarioId: scenario.id, areaId: 'dishes' });
  assert.equal(store.read('b', 1, first), null); assert.equal(store.read('a', 2, first), null);
  assert.equal(store.begin({ userId: 'a', revision: 1, scenarioId: scenario.id, areaId: 'dishes' }), first);
  now = '2026-11-03T10:05:00Z'; assert.equal(store.finish(first).ended_at, now);
  now = '2026-11-03T11:00:00Z'; assert.equal(store.begin({ userId: 'a', revision: 1, scenarioId: scenario.id, areaId: 'dishes' }).started_at, now);
});

test('finishing stops voice and saves conversation before the visit checkpoint', async () => {
  const calls=[];
  assert.equal(await saveVisitCheckpoint({visit,stopVoice:()=>calls.push('stop'),saveConversation:async()=>{calls.push('conversation');return true;},saveCheckpoint:async value=>{calls.push('checkpoint');assert.equal(value,visit);return true;},isCurrent:()=>true}),true);
  assert.deepEqual(calls,['stop','conversation','checkpoint']);
});
test('failed saves never report success or write a checkpoint for another account', async () => {
  let writes=0;
  const callbacks={visit,saveConversation:async()=>true,saveCheckpoint:async()=>{writes++;return true;},isCurrent:()=>false};
  assert.equal(await saveVisitCheckpoint(callbacks),false);assert.equal(writes,0);
  await assert.rejects(saveVisitCheckpoint({...callbacks,isCurrent:()=>true,saveConversation:async()=>false}),/could not be confirmed as saved/);assert.equal(writes,0);
  await assert.rejects(saveVisitCheckpoint({...callbacks,isCurrent:()=>true,saveCheckpoint:async()=>false}),/checkpoint could not sync/);
});
test('loading an in-progress visit from another device preserves its exact area', () => {
  const remote={...visit,ended_at:undefined};
  const store=createTrainingVisitStore({now:()=> '2026-11-03T10:03:00Z'});
  assert.equal(store.begin({userId:'a',revision:1,scenarioId:scenario.id,areaId:'dishes',remote}),remote);
});
