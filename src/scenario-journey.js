import { scenarioDepth } from "./scenario-depth.js";
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

export function scenarioTasks(scenario) {
  if (scenario.kind === 'room') return ROOM_JOURNEY_ROOMS.find(room => room.id === scenario.roomId)?.tasks || [];
  const match = findOutOfHomeScenario(scenario.categoryId, scenario.scenarioId);
  if (!match) return [];
  return [
    ...scenarioDepth(scenario.id),
    { id: 'response', title: 'Response and behaviour', description: match.scenario.focus },
    { id: 'boundaries', title: 'Boundaries and exceptions', description: 'What I may do in this situation, what stays private, and any exceptions you want me to respect.' },
    { id: 'ask-wait-stop', title: 'When to ask, wait or stop', description: 'When I should check with you, step back or get help in this situation.' }
  ].map(task => ({ ...task, prompt: buildScenarioTaskPrompt(match, task) }));
}

function buildScenarioTaskPrompt(match, task) {
  return 'For the situation "' + match.scenario.title + '", let us focus on ' + task.title.toLowerCase() + '. ' + task.description + ' Ask me one question at a time.';
}

export function scenarioLearnings(scenario, records = []) {
  const room = ROOM_JOURNEY_ROOMS.find(item => item.id === scenario.roomId);
  const uniqueKeywords = room?.tasks.filter(task => !/boundar|privacy/.test(task.id)).flatMap(task => task.keywords).filter(keyword =>
    !ROOM_JOURNEY_ROOMS.some(other => other.id !== room.id && other.tasks.some(task => task.keywords.includes(keyword)))) || [];
  const seen = new Set();
  return records.filter(record => {
    if (!['user_stated', 'user_confirmed'].includes(record.status || record.preference_status)) return false;
    const statement = String(record.statement || record.text || '').trim();
    if (!statement || seen.has(statement.toLowerCase())) return false;
    const linked = record.attributes?.scenario_id || record.scenario_id;
    if (linked && linked !== scenario.id) return false;
    const lower = statement.toLowerCase();
    const matches = linked === scenario.id || (room && (record.topic === room.id ||
      record.attributes?.room_id === room.id || lower.includes(room.name.toLowerCase()) ||
      uniqueKeywords.some(keyword => lower.includes(keyword.toLowerCase()))));
    if (!matches) return false;
    seen.add(lower);
    return true;
  }).map(record => String(record.statement || record.text).trim());
}
export function availableScenarioCount(value) {
  const done = new Set(completedScenarioIds(value));
  const firstIncomplete = SCENARIOS.findIndex((scenario) => !done.has(scenario.id));
  return firstIncomplete < 0 ? SCENARIOS.length : firstIncomplete + 1;
}

export function scenarioProgressSummary(value) {
  const done = new Set(completedScenarioIds(value));
  const groups = [
    { id: 'home', label: 'At home', matches: item => item.kind === 'room' },
    { id: 'people', label: 'People', matches: item => ['strangers', 'known-people', 'social-intelligence', 'work-community'].includes(item.categoryId) },
    { id: 'outings', label: 'Outings', matches: item => ['public-mobility', 'shops-services', 'animals'].includes(item.categoryId) },
    { id: 'safety', label: 'Safety', matches: item => ['public-safety', 'advanced-context'].includes(item.categoryId) }
  ].map(group => {
    const items = SCENARIOS.filter(group.matches);
    const completed = items.filter(item => done.has(item.id)).length;
    return { id: group.id, label: group.label, total: items.length, completed, percent: Math.round(completed / items.length * 100) };
  });
  return { completed: done.size, total: SCENARIOS.length, percent: Math.round(done.size / SCENARIOS.length * 100), groups,
    next: SCENARIOS.find(item => !done.has(item.id)) || null };
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
