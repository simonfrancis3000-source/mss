import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, completedScenarioIds, availableScenarioCount, buildScenarioStartPatch, scenarioTasks, scenarioLearnings, scenarioProgressSummary } from '../src/scenario-journey.js';

test('the journey has 26 unique, resolvable scenarios across home and public life', () => {
  assert.equal(SCENARIOS.length, 26);
  assert.equal(new Set(SCENARIOS.map((item) => item.id)).size, 26);
  assert.ok(SCENARIOS.some((item) => item.kind === 'room'));
  assert.ok(SCENARIOS.some((item) => item.kind === 'outside'));
});

test('completion opens the next scenario and ignores invalid or duplicate records', () => {
  assert.equal(availableScenarioCount([]), 1);
  assert.equal(availableScenarioCount([SCENARIOS[0].id]), 2);
  assert.equal(availableScenarioCount(SCENARIOS.map((item) => item.id)), 26);
  assert.deepEqual(completedScenarioIds([SCENARIOS[0].id, SCENARIOS[0].id, 'unknown']), [SCENARIOS[0].id]);
  assert.equal(availableScenarioCount([SCENARIOS[1].id]), 1);
});

test('starting and continuing scenarios preserves existing progress and sets room focus', () => {
  const first = SCENARIOS[0];
  const earlier = { completed_task_ids: ['washing'] };
  const patch = buildScenarioStartPatch(first, { laundry_utility: earlier }, '2026-01-01T00:00:00Z');
  assert.equal(patch.active_room_id, 'kitchen');
  assert.equal(patch.active_task_id, null);
  assert.equal(patch.room_progress.laundry_utility, earlier);
  const continued = buildScenarioStartPatch(first, patch.room_progress, '2026-01-02T00:00:00Z');
  assert.equal(continued.room_progress.scenario_journey_v1.startedAt, '2026-01-01T00:00:00Z');
  const outside = buildScenarioStartPatch(SCENARIOS[1], continued.room_progress, '2026-01-02T00:00:00Z');
  assert.equal(outside.room_progress.scenario_journey_v1.startedAt, '2026-01-02T00:00:00Z');
  assert.equal('active_room_id' in outside, false);
});

test('selected scenario tasks and saved learnings stay scoped to that scenario', () => {
  const kitchen = SCENARIOS[0];
  const outside = SCENARIOS[1];
  assert.ok(scenarioTasks(kitchen).some(task => task.id === 'dishwashing'));
  assert.ok(scenarioTasks(outside).some(task => task.description.includes('identifying information')));
  assert.ok(scenarioTasks(outside).every(task => task.prompt.includes(outside.title)));
  const records = [
    { topic: 'kitchen', statement: 'Use the eco cycle for the dishwasher.', status: 'user_stated' },
    { topic: 'bedroom', statement: 'Ask before entering my bedroom.', status: 'user_confirmed' },
    { topic: 'kitchen', statement: 'I might like a hot wash.', status: 'inferred_pending_confirmation' },
    { topic: 'kitchen', statement: 'Use the eco cycle for the dishwasher.', status: 'user_confirmed' },
    { attributes: {scenario_id: outside.id}, statement: 'Keep my address private.', status: 'user_confirmed' }
  ];
  assert.deepEqual(scenarioLearnings(kitchen, records), ['Use the eco cycle for the dishwasher.']);
  assert.deepEqual(scenarioLearnings(outside, records), ['Keep my address private.']);
});

test('chart totals represent completed scenarios without invented progress', () => {
  const empty = scenarioProgressSummary([]);
  assert.equal(empty.percent, 0);
  assert.equal(empty.groups.reduce((sum, group) => sum + group.total, 0), 26);
  const first = scenarioProgressSummary([SCENARIOS[0].id, SCENARIOS[0].id, 'unknown']);
  assert.equal(first.completed, 1);
  assert.equal(first.percent, 4);
  assert.equal(first.groups[0].completed, 1);
  assert.equal(first.next.id, SCENARIOS[1].id);
  const all = scenarioProgressSummary(SCENARIOS.map(item => item.id));
  assert.equal(all.percent, 100);
  assert.equal(all.next, null);
});


test('all 26 scenarios contain distinct, actionable ownership learning areas', () => {
  assert.equal(SCENARIOS.length, 26);
  for (const scenario of SCENARIOS) {
    const tasks = scenarioTasks(scenario);
    assert.ok(tasks.length >= 7, scenario.id);
    assert.equal(new Set(tasks.map(task => task.id)).size, tasks.length, scenario.id);
    assert.ok(tasks.filter(task => task.id.startsWith('depth-')).length >= 4, scenario.id);
    assert.ok(tasks.every(task => task.title && task.description && task.prompt), scenario.id);
  }
});

test('module 26 extends existing progress without changing the first 25 IDs',()=>{
 const prior=SCENARIOS.slice(0,25).map(item=>item.id);
 const added=SCENARIOS.at(-1);
 assert.equal(added.id,'outside:known-people:shared-household');
 const summary=scenarioProgressSummary(prior);
 assert.equal(summary.completed,25);assert.equal(summary.total,26);
 assert.equal(summary.next.id,added.id);assert.equal(availableScenarioCount(prior),26);
 assert.equal(summary.groups.find(g=>g.id==='people').total,7);
 assert.ok(scenarioTasks(added).some(t=>t.description.includes('privacy') || t.title.includes('privacy')));
});
