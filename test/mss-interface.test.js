import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInterfaceModel } from '../src/mss-interface.js';
import { SCENARIOS, scenarioTasks, scenarioProgressSummary } from '../src/scenario-journey.js';
const taskCounts = Object.fromEntries(SCENARIOS.map(s => [s.id, scenarioTasks(s).length]));

test('new accounts begin at Kitchen, without interpreting missing room IDs as an outside scenario', () => {
  const model = buildInterfaceModel({ scenarios: SCENARIOS, ready: true, taskCounts });
  assert.equal(model.active.id, 'room:kitchen');
  assert.equal(model.percent, 0);
  assert.equal(model.modules[0].available, true);
  assert.equal(model.modules[1].available, false);
});

test('completion excludes unknown IDs and duplicates and uses all 26 existing scenarios', () => {
  const model = buildInterfaceModel({ scenarios: SCENARIOS, ready: true, taskCounts,
    data: { completed: ['room:kitchen', 'room:kitchen', 'made-up'] } });
  assert.equal(model.completed, 1);
  assert.equal(model.total, 26);
  assert.equal(model.percent, 4);
  assert.equal(model.modules[0].status, 'Complete');
  assert.equal(model.modules[0].percent, 100);
  assert.equal(model.active.id, SCENARIOS[1].id);
});

test('an explicitly active scenario stays accessible while future scenarios stay locked', () => {
  const model = buildInterfaceModel({ scenarios: SCENARIOS, ready: true, taskCounts,
    data: { started: SCENARIOS[5].id }, reviewedCounts: { [SCENARIOS[5].id]: 1 } });
  assert.equal(model.active.id, SCENARIOS[5].id);
  assert.equal(model.modules[5].available, true);
  assert.equal(model.modules[4].available, false);
  assert.equal(model.modules[5].reviewed, 1);
  assert.equal(model.percent, 0); // Discussing an area does not complete a scenario.
});

test('unavailable account progress never presents stale completions as current', () => {
  const model = buildInterfaceModel({ scenarios: SCENARIOS, ready: false, taskCounts,
    data: { completed: ['room:kitchen'] } });
  assert.equal(model.ready, false);
  assert.equal(model.percent, 0);
  assert.equal(model.completed, 0);
  assert.ok(model.modules.every(m => !m.available && m.status === 'Unavailable'));
});

test('Passport, Chart and shared image agree on confirmed progress and category totals', () => {
  const completed = [SCENARIOS[0].id, SCENARIOS[0].id, SCENARIOS[12].id, SCENARIOS[25].id, 'unknown'];
  const model = buildInterfaceModel({ scenarios: SCENARIOS, ready: true, taskCounts, data: { completed } });
  const shared = scenarioProgressSummary(completed);
  assert.equal(model.percent, shared.percent);
  assert.equal(model.completed, shared.completed);
  assert.equal(model.total, shared.total);
  assert.deepEqual(model.groups.map(({ id, completed, total, percent }) => ({ id, completed, total, percent })),
    shared.groups.map(({ id, completed, total, percent }) => ({ id, completed, total, percent })));
});
