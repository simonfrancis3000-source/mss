import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, completedScenarioIds, availableScenarioCount, buildScenarioStartPatch } from '../src/scenario-journey.js';

test('the journey has 25 unique, resolvable scenarios across home and public life', () => {
  assert.equal(SCENARIOS.length, 25);
  assert.equal(new Set(SCENARIOS.map((item) => item.id)).size, 25);
  assert.ok(SCENARIOS.some((item) => item.kind === 'room'));
  assert.ok(SCENARIOS.some((item) => item.kind === 'outside'));
});

test('completion opens the next scenario and ignores invalid or duplicate records', () => {
  assert.equal(availableScenarioCount([]), 1);
  assert.equal(availableScenarioCount([SCENARIOS[0].id]), 2);
  assert.equal(availableScenarioCount(SCENARIOS.map((item) => item.id)), 25);
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
