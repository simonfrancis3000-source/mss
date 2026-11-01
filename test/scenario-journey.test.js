import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, completedScenarioIds, availableScenarioCount } from '../src/scenario-journey.js';

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
