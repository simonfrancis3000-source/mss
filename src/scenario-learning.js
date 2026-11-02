import { SCENARIOS, scenarioTasks } from './scenario-journey.js';
import { isUsefulStandalonePreference } from './persona-memory.js';

// Every area has a practical subject plus three decision dimensions. These are
// guidance, not a fixed question count or proof that an area is complete.
export function scenarioLearningObjectives(scenario) {
  return scenarioTasks(scenario).map(task => ({
    id: task.id,
    title: task.title,
    subject: task.description,
    decisions: [
      'Your usual preference and desired outcome for ' + task.title.toLowerCase(),
      'Conditions or unusual situations that could change your preference',
      'Your boundaries and when I should ask, wait or stop, if relevant'
    ]
  }));
}

export function scenarioForId(id) { return SCENARIOS.find(scenario => scenario.id === id) || null; }

export function areaLearningState(scenarioId, areaId, memories, reviewedIds = [], readyIds = []) {
  const evidence = (memories || []).filter(memory => memory?.attributes?.scenario_id === scenarioId && memory.attributes.area_id === areaId && isUsefulStandalonePreference(memory.statement) && !['archived', 'superseded'].includes(memory.status));
  if (evidence.some(memory => ['conflicting', 'inferred_pending_confirmation'].includes(memory.status))) return { status: 'needs_clarification', evidence };
  if (reviewedIds.includes(areaId)) return { status: 'reviewed', evidence };
  if (readyIds.includes(areaId) && evidence.length) return { status: 'ready_to_review', evidence };
  if (evidence.length) return { status: 'discussed', evidence };
  return { status: 'not_started', evidence };
}

export const areaStatusLabel = status => ({
  reviewed: 'Reviewed', needs_clarification: 'Needs clarification', ready_to_review: 'Ready to review', discussed: 'Discussed', not_started: 'Not started'
}[status] || 'Not started');
