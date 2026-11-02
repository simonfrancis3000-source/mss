import { buildPexiCapabilityPlan, cleanPexiCapabilityManifest } from './pexi-readiness.js';

export function cleanSimulationResult(input, memories = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const safeText = (value, limit) => typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, limit) : '';
  const situation = safeText(input.situation, 700);
  const proposed = safeText(input.proposed_response, 1000);
  if (!situation || !proposed || !Array.isArray(input.evidence_ids)) return null;
  const available = new Map(memories.map(memory => [String(memory.id), memory]));
  const ids = [...new Set(input.evidence_ids.map(String))];
  if (ids.some(id => !available.has(id))) return null;
  const sources = ids.slice(0, 8).map(id => {
    const memory = available.get(id);
    return { id, statement: memory.statement, status: memory.status, rule_version: Number.isInteger(memory.rule_version) ? memory.rule_version : null, conditions: Array.isArray(memory.conditions) ? memory.conditions : [], permission_policy: memory.permission_policy || 'unspecified', owner_marked_general: memory.attributes?.apply_across_scenarios === true };
  });
  return {
    situation,
    proposed_response: sources.length ? proposed : "I don't have a linked preference that settles this situation yet. I would ask you before deciding.",
    follow_up_question: sources.length ? safeText(input.follow_up_question, 500) : "How would you like me to handle this situation?",
    sources,
    evidence_status: sources.length ? 'based_on_saved_preferences' : 'needs_information'
  };
}

export function simulationCapabilitySummary({ functionId, manifest, robotType }) {
  if (!functionId) return { state: 'not_assessed', text: 'Choose a task to compare its declared robot capabilities.' };
  const specification = cleanPexiCapabilityManifest(manifest);
  if (!specification) return { state: 'unknown', text: 'Robot capabilities are unknown. No capability specification has been loaded.' };
  const plan = buildPexiCapabilityPlan({ selectedFunctions: [functionId], targetRobotType: robotType, capabilityManifest: specification });
  const task = plan.tasks[0];
  if (!task || task.capability_status === 'not_mapped') return { state: 'not_assessed', text: 'This task has not yet been mapped to robot capabilities.' };
  const identity = specification.manufacturer + ' ' + specification.model;
  if (task.missing_capabilities.length) return { state: 'not_declared', text: identity + ': some capabilities needed for this task are not listed in the supplied complete specification. The declaration has not been independently verified.' };
  if (task.unverified_capabilities.length) return { state: 'unknown', text: identity + ': some required capabilities are not listed in the supplied partial specification. They remain unknown.' };
  return { state: 'declared', text: identity + ': the supplied specification lists the mapped capabilities. This declaration has not been independently verified, and safety validation is still required.' };
}
