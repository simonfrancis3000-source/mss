import {coalesceTranscriptTurns, preferTranscriptTurn, isServiceErrorText} from '../src/transcript-turns.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { SCENARIOS } from '../src/scenario-journey.js';
import { buildConversationContinuity, cleanConversationContinuity, conversationContinuityGuidance } from '../src/conversation-continuity.js';
import { guardScenarioQuestion } from '../server/continuity-guard.js';
import { createAmiaStore, storedDecisionGuidance } from '../server/amia-store.js';
import { buildRoomJourneyConversationContext } from '../src/room-journey.js';

const scenarioId = 'room:living_room';
const continuity = { scenarioId, exchanges: [{ question: 'Where should I leave the remote controls?', answer: 'On the side table.', scenarioId }] };

test('older answers remain paired with their questions beyond the recent reply window', () => {
  const messages = [{ role: 'assistant', content: 'Should I leave your books where they are?', scenario_id: scenarioId }, { role: 'user', content: 'Yes.', scenario_id: scenarioId },
    ...Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: 'Later conversation ' + i, scenario_id: scenarioId })),
    { role: 'assistant', content: 'When should I start food preparation?', scenario_id: 'room:kitchen' }, { role: 'user', content: 'At six.', scenario_id: 'room:kitchen' }];
  const result = buildConversationContinuity(messages, scenarioId);
  assert.deepEqual(result.exchanges, [{ question: 'Should I leave your books where they are?', answer: 'Yes.', scenarioId }]);
  assert.match(conversationContinuityGuidance(result), /thirty-minute aim never justifies repetition/);
});

test('all 25 scenario scopes retain their own exchanges and reject another scope', () => {
  for (const scenario of SCENARIOS) {
    const item = { role: 'assistant', content: 'What should I leave untouched?', scenario_id: scenario.id };
    assert.equal(buildConversationContinuity([item, { role: 'user', content: 'That box.', scenario_id: scenario.id }], scenario.id).exchanges.length, 1);
    assert.equal(cleanConversationContinuity({ ...continuity, scenarioId: 'invented' }, scenario.id).exchanges.length, 0);
  }
  const legacy = buildConversationContinuity([{ role: 'assistant', content: 'Where should I leave the remote?' }, { role: 'user', content: 'On the table.' }], scenarioId);
  assert.equal(legacy.exchanges[0].scenarioId, null);
  assert.ok(JSON.stringify(buildConversationContinuity(Array.from({ length: 200 }, (_, i) => ({ role: 'assistant', content: 'Question ' + i + ' ' + 'x'.repeat(490) + '?' })), scenarioId)).length < 14000);
});

test('scenario labels survive transcript restore and overlapping device snapshots', async () => {
  const source = await readFile(new URL('../src/synqme.js', import.meta.url), 'utf8');
  const functions = ['sanitiseConversationMessage', 'mergeConversationMessages'].map(name => source.match(new RegExp('function ' + name + '\\([^]*?\\n\\}'))?.[0]).join('\n');
  const context = vm.createContext({coalesceTranscriptTurns, preferTranscriptTurn, isServiceErrorText, SCENARIOS, WELCOME: 'Welcome', normaliseMessageTimestamp: item => item.timestamp || null });
  vm.runInContext(functions, context);
  context.local = [{ role: 'assistant', content: 'Where should the remote go?', timestamp: '2026-11-01T12:00:00Z' }];
  context.remote = [{ ...context.local[0], scenario_id: scenarioId }, { role: 'user', content: 'On the table.', scenario_id: scenarioId }];
  const result = vm.runInContext('mergeConversationMessages(local, remote)', context);
  assert.equal(result.length, 2);
  assert.equal(result[0].scenario_id, scenarioId);
  assert.equal(result[1].scenario_id, scenarioId);
});

test('saved question retrieval spans every task in the room and keeps more than twelve questions in guidance', async () => {
  const urls = [];
  const store = createAmiaStore({ supabaseUrl: 'https://fixture.test', publishableKey: 'fixture', fetchImpl: async url => {
    urls.push(new URL(url));
    return Response.json(String(url).includes('synqme_decision_states') ? Array.from({ length: 30 }, (_, i) => ({ question: 'Saved question ' + i + '?', status: 'response_received' })) : []);
  } });
  const context = await store.loadContext({ user: { id: 'account-a' }, accessToken: 'fixture' }, { scopeKey: 'room:living_room:entertainment', query: 'remote control' });
  const query = urls.find(url => url.pathname.endsWith('synqme_decision_states')).searchParams;
  assert.equal(query.get('user_id'), 'eq.account-a');
  assert.equal(query.get('or'), '(scope_key.eq.room:living_room,scope_key.like.room:living_room:*)');
  assert.equal(query.get('scope_key'), null);
  assert.match(storedDecisionGuidance(context), /Saved question 29/);
  assert.match(storedDecisionGuidance(context), /do not restart the same question/);
});

test('semantic repeats are repaired and the replacement question is checked before delivery', async () => {
  const seen = [];
  const result = await guardScenarioQuestion({ draft: 'Understood. Where would you prefer the television handset kept?', latestUser: 'We already covered the remote.', continuity,
    review: async input => { seen.push(input); return { repeated_question: seen.length === 1, matched_question: continuity.exchanges[0].question, reason: 'Same placement decision.' }; },
    rewrite: async () => 'I will leave it on the side table. If a visitor leaves a bag blocking the doorway, should I ask them or you to move it?' });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].exchanges[0].answer, 'On the side table.');
  assert.match(result.reply, /blocking the doorway/);
  assert.equal(result.blocked, true);
});

test('a genuinely new exception about the same object is allowed', async () => {
  const draft = 'If the remote has a leaking battery, should I leave it untouched and let you know?';
  const result = await guardScenarioQuestion({ draft, latestUser: 'On the table.', continuity,
    review: async () => ({ repeated_question: false, reason: 'Battery damage is a new circumstance, not the placement preference.' }),
    rewrite: async () => { throw Error('Should not rewrite a new decision'); } });
  assert.equal(result.reply, draft);
});

test('rejected replacement questions and review failures never escape as unchecked follow-ups', async () => {
  const draft = 'Understood. Where should I leave the remote controls?';
  const result = await guardScenarioQuestion({ draft, continuity, latestUser: 'On the table.',
    rewrite: async () => draft, review: async () => { throw Error('Should reject exact repeat without review'); } });
  assert.equal(result.reply, 'Understood.');
  const unavailable = await guardScenarioQuestion({ draft: 'Understood. Where would you keep the handset?', continuity,
    review: async () => { throw Error('offline'); } });
  assert.equal(unavailable.reply, 'Understood.');
  assert.equal(unavailable.reviewUnavailable, true);
});

test('deferred questions and reviewed areas participate even without an answer or recent history', async () => {
  const deferred = await guardScenarioQuestion({ draft: 'Okay. What time should I tidy the shelves?', decisions: [{ question: 'What time should I tidy the shelves?', status: 'deferred' }],
    rewrite: async () => 'We can leave that for later.', review: async () => ({ repeated_question: true }) });
  assert.equal(deferred.reply, 'We can leave that for later.');
  let checked = false;
  await guardScenarioQuestion({ draft: 'Where do the remotes belong?', reviewedAreas: ['TV and entertainment'], review: async data => {
    checked = true; assert.deepEqual(data.reviewedAreas, ['TV and entertainment']); return { repeated_question: false };
  } });
  assert.equal(checked, true);
  const room = buildRoomJourneyConversationContext({ activeRoomId: 'living_room', activeTaskId: 'tidying', reviewedTaskIds: ['tidying'] });
  assert.equal(room.activeTaskId, null);
  assert.notEqual(room.nextPendingTaskId, 'tidying');
  assert.equal(room.tasks.find(task => task.id === 'tidying').reviewed, true);
});

test('explicit owner-requested revisits can be accepted by the semantic check', async () => {
  const result = await guardScenarioQuestion({ draft: 'Where should I leave the remote controls?', continuity, latestUser: 'Actually I want to change my remote location.',
    review: async () => ({ repeated_question: false, reason: 'Owner explicitly changed this preference.' }) });
  assert.match(result.reply, /remote controls/);
});
