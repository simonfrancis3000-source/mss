import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, scenarioTasks } from '../src/scenario-journey.js';
import { scenarioLearningObjectives, scenarioForId, areaLearningState } from '../src/scenario-learning.js';

test('all 25 scenarios supply area-specific subjects and useful decision dimensions', () => {
  assert.equal(SCENARIOS.length, 25);
  for (const scenario of SCENARIOS) {
    const objectives = scenarioLearningObjectives(scenario);
    assert.equal(objectives.length, scenarioTasks(scenario).length, scenario.id);
    assert.ok(objectives.length >= 4);
    for (const area of objectives) {
      assert.ok(area.id && area.title && area.subject, scenario.id);
      assert.equal(area.decisions.length, 3);
      assert.match(area.decisions[1], /conditions|unusual/i);
      assert.match(area.decisions[2], /boundaries|ask/i);
    }
    assert.equal(scenarioForId(scenario.id), scenario);
  }
  assert.equal(scenarioForId('invented'), null);
});

test('area progress comes from scoped evidence and explicit review, never keyword guesses', () => {
  const room = 'room:living_room', id = 'tidying';
  const memory = { id: 'a', statement: 'Leave my papers where they are.', status: 'user_stated', attributes: { scenario_id: room, area_id: id } };
  assert.equal(areaLearningState(room, id, []).status, 'not_started');
  assert.equal(areaLearningState(room, id, [memory]).status, 'discussed');
  assert.equal(areaLearningState(room, id, [memory], [], [id]).status, 'ready_to_review');
  assert.equal(areaLearningState(room, id, [memory], [id]).status, 'reviewed');
  assert.equal(areaLearningState(room, id, [{ ...memory, status: 'conflicting' }], [id]).status, 'needs_clarification');
  assert.equal(areaLearningState('room:kitchen', id, [memory]).status, 'not_started');
  assert.equal(areaLearningState(room, id, [{ ...memory, status: 'archived' }]).status, 'not_started');
});

test('each scenario can retain a short answer, suppress a repeat and keep a new decision', async () => {
  const { buildConversationContinuity } = await import('../src/conversation-continuity.js');
  const { guardScenarioQuestion } = await import('../server/continuity-guard.js');
  for (const scenario of SCENARIOS) {
    const task = scenarioTasks(scenario)[0];
    const question = 'What is my usual preference for ' + task.title.toLowerCase() + '?';
    const messages = [
      { role: 'assistant', content: question, scenario_id: scenario.id },
      { role: 'user', content: 'Yes, leave it as it is.', scenario_id: scenario.id },
      ...Array.from({ length: 22 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: 'Another point ' + i, scenario_id: scenario.id }))
    ];
    const continuity = buildConversationContinuity(messages, scenario.id);
    assert.equal(continuity.exchanges[0].answer, 'Yes, leave it as it is.', scenario.id);
    const corrected = await guardScenarioQuestion({ draft: 'Understood. ' + question, continuity, latestUser: 'Please continue.',
      rewrite: async () => 'I will keep that in mind. What should I do if the usual approach is not possible?',
      review: async () => ({ repeated_question: false }) });
    assert.equal(corrected.blocked, true, scenario.id);
    assert.match(corrected.reply, /not possible/, scenario.id);
  }
});
