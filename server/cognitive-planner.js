import { normalized } from './cognitive-core.js';

export function buildDecisionPlan({ objectives, state, context, review = {} }) {
  const reviewed = new Set(review.reviewedAreaIds || []);
  const rules = [...(context.rules || []), ...(context.generalRules || [])];
  const conflicts = rules.filter(r => r.status === 'conflicting');
  const dependencies = (context.relations || []).filter(e => e.relation === 'depends_on');
  const ranked = objectives.map((area, index) => {
    const evidence = rules.filter(r => r.attributes?.area_id === area.id);
    const dispositions = state.dispositions.filter(d => d.objectiveId === area.id);
    const deferred = dispositions.some(d => ['deferred','not_applicable'].includes(d.status));
    const conflict = evidence.some(r => r.status === 'conflicting');
    return { ...area, reviewed: reviewed.has(area.id), evidenceCount: evidence.length,
      needsClarification: conflict || evidence.some(r => r.status === 'inferred_pending_confirmation'),
      deferred, priority: (conflict ? 100 : 0) + (area.id === state.objectiveId ? 30 : 0) + (evidence.length ? 10 : 20) - index / 100,
      evidenceIds: evidence.map(r => r.memory_key || r.id),
      decisionDimensions: ['usual_outcome','conditions_and_exceptions','permissions_and_escalation'] };
  }).filter(a => !a.reviewed && !a.deferred).sort((a,b) => b.priority-a.priority);
  return { selected: ranked[0] || null, remaining: ranked, conflicts: conflicts.map(r => ({ id: r.memory_key || r.id, statement: r.statement })), dependencies,
    reviewedAreaIds: [...reviewed], completionConfirmed: review.completionConfirmed === true,
    policy: 'Evidence and owner review determine coverage. No message count or time quota establishes completion. Clarify consequential conflicts; never infer permission or physical capability.' };
}

export function questionAlreadySettled(question, dispositions, decisionKey) {
  const text = normalized(question);
  return dispositions.some(d => (decisionKey && d.decisionKey === decisionKey) || normalized(d.question) === text);
}

export function evaluatePermission({ rules = [], actionScope, conditionsKnown = false, capabilityKnown = false }) {
  const relevant = rules.filter(r => r.scope_key === actionScope && ['user_stated','user_confirmed','conflicting'].includes(r.status));
  if (relevant.some(r => r.permission_policy === 'prohibited')) return { outcome: 'blocked', reason: 'explicit_prohibition' };
  if (relevant.some(r => r.status === 'conflicting')) return { outcome: 'ask', reason: 'conflicting_rules' };
  if (!capabilityKnown) return { outcome: 'wait', reason: 'capability_unverified' };
  if (!conditionsKnown || relevant.some(r => r.permission_policy === 'ask_first')) return { outcome: 'ask', reason: 'conditions_or_approval_required' };
  return relevant.some(r => r.permission_policy === 'allowed') ? { outcome: 'allowed', reason: 'explicit_scoped_permission' } : { outcome: 'ask', reason: 'permission_unspecified' };
}
