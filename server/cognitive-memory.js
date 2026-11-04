import { cleanPersonaMemoryCandidate, buildPersonaMemorySearchKeys, SENSITIVE_MEMORY_PATTERN, deriveMemoryScopeKey } from '../src/persona-memory.js';
import { hash, normalized } from './cognitive-core.js';

export function validateMemoryProposals(raw, { latestUser, knownRules = [], objectives = [], turnKey, scope }) {
  if (!Array.isArray(raw) || raw.length > 8 || SENSITIVE_MEMORY_PATTERN.test(latestUser)) return [];
  const known = new Map(knownRules.map(r => [r.memory_key || r.id, r]));
  const explicitCorrection = /\b(?:actually|changed my mind|change my|correct|instead|no longer|ahora prefiero|he cambiado|en realidad|corrige)\b/i.test(latestUser);
  const explicitWithdrawal = /\b(?:forget|withdraw|remove that rule|do not remember|olvida|elimina esa regla)\b/i.test(latestUser);
  return raw.flatMap(input => {
    const quote = typeof input?.source_quote === 'string' ? input.source_quote.trim() : '';
    const candidate = cleanPersonaMemoryCandidate(input);
    if (!candidate || quote.length < 2 || !String(latestUser).toLowerCase().includes(quote.toLowerCase())) return [];
    // Avoid converting someone else's tastes into an owner's preference.
    if (/\b(?:my (?:guest|friend|wife|husband|child|daughter|son)|mi (?:invitado|amigo|esposa|hijo))\b/i.test(latestUser) && !/\b(?:I (?:prefer|want|would)|prefiero|quiero)\b/i.test(latestUser)) return [];
    const target = candidate.target_memory_key ? known.get(candidate.target_memory_key) : null;
    if (candidate.target_memory_key && !target) return [];
    if (['updates','withdraws','confirms','refines','conflicts'].includes(candidate.relation) && !target) return [];
    if (candidate.relation === 'withdraws' && !explicitWithdrawal) return [];
    if (candidate.relation === 'updates' && !explicitCorrection) candidate.relation = 'conflicts';
    if (candidate.permission_policy === 'allowed') {
      // A positive permission must be part of the cited owner evidence. Any
      // negation makes the statement ambiguous and requires clarification.
      const affirmative = /\b(?:you (?:may|can)(?!['’]t)|I (?:allow|authorize|permit)|without asking|puedes|te permito|te autorizo)\b/i.test(quote);
      const negated = /\b(?:not|never|cannot|can['’]t|don['’]t|doesn['’]t|won['’]t|no|nunca|jam[aá]s)\b/i.test(latestUser);
      if (!affirmative || negated) candidate.permission_policy = 'unspecified';
    }
    if (target && candidate.relation === 'refines' && target.statement) {
      if (!normalized(candidate.statement).includes(normalized(target.statement))) {
        const combined = target.statement + ' ' + candidate.statement;
        if (combined.length > 420) return [];
        candidate.statement = combined;
      }
      if (['ask_first','prohibited'].includes(target.permission_policy) && candidate.permission_policy === 'unspecified') candidate.permission_policy = target.permission_policy;
      if (target.kind === 'boundary') candidate.kind = 'boundary';
    }
    if (!target && candidate.relation === 'new') {
      const precise = typeof input.decision_key === 'string' && /^[a-z0-9._-]{3,100}$/i.test(input.decision_key) ? input.decision_key.toLowerCase() : null;
      const compact = value => String(value || '').replace(/[^a-z0-9]/gi,'').toLowerCase();
      const broad = compact(candidate.scope_key) === compact(scope) || objectives.some(o=>compact(o.id)===compact(candidate.scope_key));
      if (precise) candidate.scope_key = precise;
      else if (broad) candidate.scope_key = deriveMemoryScopeKey(candidate.statement,candidate.topic,candidate.kind);
    }
    const area = objectives.find(o => o.id === candidate.attributes?.area_id)?.id || null;
    const relations = (Array.isArray(input.relations) ? input.relations : []).filter(r => ['depends_on','exception_to','conflicts_with'].includes(r?.kind) && known.has(r.target_memory_key) && !(target && ['updates','refines'].includes(candidate.relation) && r.target_memory_key === target.memory_key)).slice(0, 6);
    return [{ ...candidate, confidence: candidate.status === 'inferred_pending_confirmation' ? 0 : 1,
      memory_key: 'cog-' + hash((target?.scope_key || candidate.scope_key) + '\n' + candidate.statement + (target ? '\n' + turnKey : '')).slice(0, 40),
      target_memory_key: target?.memory_key || '', scope_key: target?.scope_key || candidate.scope_key,
      source_quote: quote, explicit_correction: explicitCorrection, explicit_withdrawal: explicitWithdrawal,
      attributes: { ...candidate.attributes, scenario_id: scope, area_id: area },
      search_keys: buildPersonaMemorySearchKeys(candidate.statement, candidate.search_terms, candidate.topic), relations }];
  });
}

// The worker persists model proposals already validated against the originating
// user turn. It does not need an additional model call for every spoken reply.
export function createCognitiveMemoryWorker({ store, logger = console, batchSize = 2 }) {
  let running = false, stopped = false, timer = null;
  async function drain() {
    if (running || stopped) return;
    running = true;
    try {
      for (let i = 0; i < batchSize && !stopped; i++) {
        const job = await store.claimMemoryJob();
        if (!job) break;
        try { await store.completeMemoryJob(job); }
        catch {
          await store.retryMemoryJob(job).catch(() => {});
          logger.warn('AMIA memory job will retry', { id: job.id, attempt: job.attempts });
        }
      }
    } catch { logger.warn('AMIA memory queue unavailable'); }
    finally { running = false; }
  }
  return {
    drain,
    start(intervalMs = 5000) { if (!timer) { stopped = false; timer = setInterval(() => { void drain(); }, intervalMs); timer.unref?.(); } },
    stop() { stopped = true; if (timer) clearInterval(timer); timer = null; }
  };
}
