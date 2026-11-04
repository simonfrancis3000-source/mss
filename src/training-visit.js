import { isUsefulStandalonePreference } from './persona-memory.js';
import { conversationIntent } from './conversation-plan.js';

export function nextTrainingStep({ scenario, tasks = [], reviewed = [], activeAreaId, checkpoint } = {}) {
  if (!scenario) return null;
  const area = tasks.find(task => task.id === activeAreaId && !reviewed.includes(task.id));
  if (checkpoint?.scenarioId === scenario.id) return {
    kind: 'resume', scenarioId: scenario.id, areaId: area?.id || null,
    title: area?.title || 'Pick up where you left off', description: checkpoint.question
  };
  const next = area || tasks.find(task => !reviewed.includes(task.id));
  return next ? { kind: 'task', scenarioId: scenario.id, areaId: next.id, title: next.title, description: next.description }
    : { kind: 'review', scenarioId: scenario.id, areaId: null, title: 'Review your saved learning', description: 'Check your preferences and boundaries before confirming this module.' };
}

export function visitLearnings(records = [], visit) {
  if (!visit?.scenario_id || !Number.isFinite(Date.parse(visit.started_at))) return [];
  const seen = new Set();
  return records.filter(record => {
    if (!['user_stated', 'user_confirmed'].includes(record.status) || !isUsefulStandalonePreference(record.statement)) return false;
    if (record.attributes?.scenario_id !== visit.scenario_id) return false;
    const changed = Date.parse(record.updated_at || record.created_at || '');
    if (!Number.isFinite(changed) || changed < Date.parse(visit.started_at)) return false;
    // A late memory job can finish after the visit ended. Attribute it by its
    // source turn, rather than claiming learning from the following visit.
    const source = Date.parse(record.source_timestamp || record.created_at || '');
    if (!Number.isFinite(source) || source < Date.parse(visit.started_at)) return false;
    if (visit.ended_at && source > Date.parse(visit.ended_at)) return false;
    const key = JSON.stringify([record.statement.trim().toLowerCase(), record.conditions || [], record.permission_policy || '']);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function visitAnswerCount(messages = [], visit) {
  if (!visit) return 0;
  const start = Date.parse(visit.started_at), end = visit.ended_at ? Date.parse(visit.ended_at) : Infinity;
  return messages.filter(message => message.role === 'user' && message.transcript_final !== false &&
    message.scenario_id === visit.scenario_id && Date.parse(message.timestamp) >= start && Date.parse(message.timestamp) <= end &&
    ['answer', 'conditional', 'correction'].includes(conversationIntent(message.content))).length;
}

// Account and training-revision scoping prevents a different login or a reset
// from inheriting another visit. Storage failure leaves a usable session copy.
export function createTrainingVisitStore({ storage, now = () => new Date().toISOString() } = {}) {
  const volatile = new Map();
  const key = (userId, revision) => 'mss-training-visit:' + userId + ':' + revision;
  function read(userId, revision, remote = null) {
    if (!userId) return null;
    let local = volatile.get(key(userId, revision));
    if (!local) try { local = JSON.parse(storage?.getItem(key(userId, revision)) || 'null'); } catch {}
    const valid = value => value && value.user_id === userId && value.revision === revision &&
      typeof value.scenario_id === 'string' && Number.isFinite(Date.parse(value.started_at));
    const candidates = [local, remote].filter(valid);
    return candidates.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at) || Date.parse(b.ended_at || '1970-01-01') - Date.parse(a.ended_at || '1970-01-01'))[0] || null;
  }
  function write(value) {
    if (!value?.user_id) return null;
    volatile.set(key(value.user_id, value.revision), value);
    try { storage?.setItem(key(value.user_id, value.revision), JSON.stringify(value)); } catch {}
    return value;
  }
  function begin({ userId, revision, scenarioId, areaId = null, remote }) {
    if (!userId || !scenarioId) return null;
    const current = read(userId, revision, remote);
    if (current && !current.ended_at && current.scenario_id === scenarioId && current.area_id === areaId &&
        Date.parse(now()) >= Date.parse(current.started_at) && Date.parse(now()) - Date.parse(current.started_at) < 24 * 60 * 60 * 1000) return current;
    return write({ user_id: userId, revision, scenario_id: scenarioId, area_id: areaId, started_at: now() });
  }
  return { read, write, begin, finish: value => value ? write({ ...value, ended_at: now() }) : null };
}

export async function saveVisitCheckpoint({ visit, stopVoice, saveConversation, saveCheckpoint, isCurrent }) {
  stopVoice?.();
  if (!visit || !(await saveConversation())) throw new Error('Your visit could not be confirmed as saved. Keep this page open and try again.');
  if (!isCurrent()) return false;
  if (!(await saveCheckpoint(visit))) throw new Error('Your conversation is saved, but the visit checkpoint could not sync. Try again before leaving.');
  return isCurrent();
}
