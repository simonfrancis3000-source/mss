import { findApplianceManual, readSavedApplianceManual, validateApplianceIdentity, exactModelMentioned } from './appliance-manual.js';
import { buildPersonaMemorySearchKeys } from '../src/persona-memory.js';
import { hash } from './cognitive-core.js';

export function createCognitiveApplianceResolver({ key, provider = 'deepseek', fetchImpl = fetch, onUsage = async () => {} }) {
  return async ({ identity, messages, saved = [], auth }) => {
    const grounded = validateApplianceIdentity(identity, messages);
    if (!grounded) return null;
    const previous = saved.find(a => a.type === grounded.type && a.brand === grounded.brand && a.model === grounded.model);
    const usage = kind => onUsage(auth, kind);
    const reread = previous?.manual_url ? await readSavedApplianceManual({ ...grounded, url: previous.manual_url, key, provider, fetchImpl, onUsage: () => usage('fetch') }) : null;
    const found = reread ? { status: 'matched', url: reread.url, excerpt: reread.excerpt }
      : await findApplianceManual({ ...grounded, key, provider, fetchImpl, onUsage: usage });
    const now = new Date().toISOString();
    const record = { ...grounded, manual_url: found.status === 'matched' ? found.url : null, manual_status: found.status,
      checked_at: now, verified_at: found.status === 'matched' ? now : null };
    return { record, evidence: found.status === 'matched' ? { url: found.url, excerpt: found.excerpt, exactModel: grounded.model } : null };
  };
}

export function applianceMemoryProposal(record, latestUser) {
  if (!exactModelMentioned(record.model, latestUser)) return null;
  const statement = 'My ' + record.type + ' is ' + record.brand + ' model ' + record.model + '.';
  return { memory_key: 'cog-appliance-' + hash([record.type,record.brand,record.model].join('|')).slice(0,32),
    topic: 'general_household', kind: 'fact', scope_key: 'appliance.' + hash(record.type + record.brand + record.model).slice(0,32), statement,
    status: 'user_stated', relation: 'new', confidence: 1, conditions: [], permission_policy: 'unspecified', source_quote: latestUser,
    target_memory_key: '', attributes: { appliance_v1: record }, search_terms: [record.type,record.brand,record.model],
    search_keys: buildPersonaMemorySearchKeys(statement,[record.type,record.brand,record.model],'general_household'), relations: [] };
}

export function verifiedFeatureQuotes(features, evidence) {
  if (!evidence || !Array.isArray(features)) return [];
  return [...new Set(features.filter(q => typeof q === 'string' && q.length >= 12 && q.length <= 180 && evidence.excerpt.includes(q)))].slice(0,3);
}
