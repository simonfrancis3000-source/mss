import { ROOM_JOURNEY_ROOMS } from './room-journey.js';
import { findOutOfHomeScenario } from './out-of-home-training.js';

// Stable IDs are stored in each account. Do not reuse an ID for another scenario.
const order = [
  ['room', 'kitchen'], ['outside', 'strangers', 'adult-approaches'],
  ['room', 'living_room'], ['outside', 'strangers', 'child-approaches'],
  ['room', 'bathroom'], ['outside', 'known-people', 'owner-introduction'],
  ['room', 'bedroom'], ['outside', 'public-mobility', 'sidewalk'],
  ['room', 'laundry_utility'], ['outside', 'public-mobility', 'crowded-street'],
  ['room', 'hallway_entry'], ['outside', 'shops-services', 'cafe-order'],
  ['room', 'dining_room'], ['outside', 'social-intelligence', 'private-conversation'],
  ['room', 'home_office'], ['outside', 'work-community', 'business-meeting'],
  ['room', 'garden_outdoor'], ['outside', 'animals', 'dog-greeting'],
  ['room', 'garage_storage'], ['outside', 'public-safety', 'separated'],
  ['room', 'guest_room'], ['outside', 'public-safety', 'owner-falls'],
  ['room', 'balcony_patio'], ['outside', 'advanced-context', 'upset-person'],
  ['outside', 'strangers', 'home-address']
];
export const SCENARIOS = order.map(([kind, group, item]) => {
  if (kind === 'room') {
    const room = ROOM_JOURNEY_ROOMS.find((value) => value.id === group);
    if (!room) throw new Error('Unknown journey room: ' + group);
    return { id: 'room:' + group, kind, roomId: group, title: room.name, description: room.summary };
  }
  const match = findOutOfHomeScenario(group, item);
  if (!match) throw new Error('Unknown journey scenario: ' + group + '/' + item);
  return { id: 'outside:' + group + ':' + item, kind, categoryId: group, scenarioId: item,
    title: match.scenario.title, description: match.scenario.situation };
});

export function completedScenarioIds(value) {
  const valid = new Set(SCENARIOS.map((scenario) => scenario.id));
  return [...new Set(Array.isArray(value) ? value.filter((id) => valid.has(id)) : [])];
}
export function availableScenarioCount(value) {
  const done = new Set(completedScenarioIds(value));
  const firstIncomplete = SCENARIOS.findIndex((scenario) => !done.has(scenario.id));
  return firstIncomplete < 0 ? SCENARIOS.length : firstIncomplete + 1;
}

export function buildScenarioStartPatch(scenario, roomProgress = {}, startedAt = new Date().toISOString()) {
  const progress = roomProgress && typeof roomProgress === 'object' && !Array.isArray(roomProgress) ? roomProgress : {};
  const prior = progress.scenario_journey_v1 && typeof progress.scenario_journey_v1 === 'object' ? progress.scenario_journey_v1 : {};
  const next = { ...prior, started: scenario.id, startedAt: prior.started === scenario.id && prior.startedAt ? prior.startedAt : startedAt };
  const patch = { room_progress: { ...progress, scenario_journey_v1: next } };
  if (scenario.kind === 'room') {
    patch.active_room_id = scenario.roomId;
    patch.active_task_id = null;
  }
  return patch;
}
