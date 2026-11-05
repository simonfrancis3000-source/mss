import { cleanPersonaMemoryCandidate, buildPersonaMemorySearchKeys, SENSITIVE_MEMORY_PATTERN, deriveMemoryScopeKey } from '../src/persona-memory.js';
import { hash, normalized, RuntimeError } from './cognitive-core.js';

export function validateMemoryProposals(raw, { latestUser, knownRules = [], existingRelations = [], objectives = [], turnKey, scope }) {
  if (!Array.isArray(raw) || raw.length > 8 || SENSITIVE_MEMORY_PATTERN.test(latestUser)) return [];
  const known = new Map(knownRules.map(r => [r.memory_key || r.id, r]));
  const explicitCorrection = /\b(?:actually|changed my mind|change my|correct|instead|no longer|ahora prefiero|he cambiado|en realidad|corrige)\b/i.test(latestUser);
  const explicitWithdrawal = /\b(?:forget|withdraw|remove that rule|do not remember|olvida|elimina esa regla)\b/i.test(latestUser);
  const proposals = raw.flatMap(input => {
    const quote = typeof input?.source_quote === 'string' ? input.source_quote.trim() : '';
    const candidate = cleanPersonaMemoryCandidate(input);
    if (!candidate || quote.length < 2 || !String(latestUser).toLowerCase().includes(quote.toLowerCase())) return [];
    // Approval exceptions are boundaries even when the model labels them as
    // "exception". The shared cleaner otherwise discards their restriction.
    if (candidate.status !== 'inferred_pending_confirmation' && ['ask_first','prohibited'].includes(input.permission_policy)) {
      candidate.kind = 'boundary';
      candidate.permission_policy = input.permission_policy;
    }
    // Avoid converting someone else's tastes into an owner's preference.
    if (/\b(?:my (?:guest|friend|wife|husband|child|daughter|son)|mi (?:invitado|amigo|esposa|hijo))\b/i.test(latestUser) && !/\b(?:I\s+(?:(?:now|still|personally|currently|usually|normally|always|actually|really)\s+){0,2}(?:prefer|want|would)|prefiero|quiero)\b/i.test(latestUser)) return [];
    let target = candidate.target_memory_key ? known.get(candidate.target_memory_key) : null;
    const requiresTarget=['updates','withdraws','confirms','refines','conflicts'].includes(candidate.relation);
    if(!target&&requiresTarget){
      const dimensions=new Set([input.scope_key,input.decision_key].filter(v=>typeof v==='string'&&/^[a-z0-9._-]{3,120}$/i.test(v)).map(v=>v.toLowerCase()));
      const matches=[...known.values()].filter(r=>dimensions.has(String(r.scope_key||'').toLowerCase())&&!['archived','superseded'].includes(r.status));
      const exactAlias=matches.length===1&&candidate.target_memory_key===matches[0].scope_key;
      // Resolve only an exact, unique owner fact dimension. Never guess by
      // similarity between opaque IDs or select between conflicting rules.
      if(matches.length===1&&matches[0].status!=='conflicting'&&(exactAlias||(explicitCorrection&&['updates','refines'].includes(candidate.relation)))){
        target=matches[0];candidate.attributes={...candidate.attributes,target_resolution:'exact_scope'};
      }
    }
    if((candidate.target_memory_key||requiresTarget)&&!target)throw new RuntimeError('invalid_memory_target',502);
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
      // A correction may change a detail inside an existing exception. Copying
      // its entire old statement would reintroduce the value just replaced.
      if (explicitCorrection) candidate.relation = 'updates';
      else if (!normalized(candidate.statement).includes(normalized(target.statement))) {
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
    const relations = (Array.isArray(input.relations) ? input.relations : []).filter(r => ['depends_on','exception_to','conflicts_with'].includes(r?.kind)).slice(0, 6).map(r=>({kind:r.kind,target_memory_key:r.target_memory_key}));
    return [{ ...candidate, confidence: candidate.status === 'inferred_pending_confirmation' ? 0 : 1,
      memory_key: 'cog-' + hash((target?.scope_key || candidate.scope_key) + '\n' + candidate.statement + (target || explicitCorrection ? '\n' + turnKey : '')).slice(0, 40),
      target_memory_key: target?.memory_key || '', scope_key: target?.scope_key || candidate.scope_key,
      source_quote: quote, explicit_correction: explicitCorrection, explicit_withdrawal: explicitWithdrawal,
      attributes: { ...candidate.attributes, scenario_id: scope, area_id: area },
      search_keys: buildPersonaMemorySearchKeys(candidate.statement, candidate.search_terms, candidate.topic), relations }];
  });
  // A later fact may depend on a fact introduced earlier in this same batch.
  // Resolve only exact keys or unique precise scopes, never similar opaque IDs.
  const available=new Map(known);
  for(const proposal of proposals){
    proposal.relations=proposal.relations.flatMap(edge=>{
      let target=available.get(edge.target_memory_key);
      if(!target){
        const matches=[...available.values()].filter(r=>r.scope_key===edge.target_memory_key&&!['superseded','archived'].includes(r.status));
        if(matches.length===1&&matches[0].status!=='conflicting')target=matches[0];
      }
      if(!target)throw new RuntimeError('invalid_memory_target',502);
      const key=target.memory_key||target.id;
      if(['updates','refines'].includes(proposal.relation)&&key===proposal.target_memory_key)return [];
      return [{kind:edge.kind,target_memory_key:key}];
    });
    if(['updates','refines','withdraws'].includes(proposal.relation)&&available.has(proposal.target_memory_key))available.set(proposal.target_memory_key,{...available.get(proposal.target_memory_key),status:proposal.relation==='withdraws'?'archived':'superseded'});
    if(!['withdraws','no_change','confirms'].includes(proposal.relation))available.set(proposal.memory_key,proposal);
  }
  // Simulate the visible graph in job order. Existing edges keep their original
  // version; only a new edge may follow a replacement made earlier in this job.
  const recordKeys=new Map(knownRules.map(r=>[r.id,r.memory_key||r.id]));
  const graph=new Map(),versions=new Map();
  const add=(from,to)=>{if(!graph.has(from))graph.set(from,new Set());graph.get(from).add(to);};
  for(const edge of existingRelations)if(['depends_on','exception_to'].includes(edge.relation))add(recordKeys.get(edge.from_rule_id)||edge.from_rule_id,recordKeys.get(edge.to_rule_id)||edge.to_rule_id);
  const current=key=>{const seen=new Set();while(versions.has(key)&&!seen.has(key)){seen.add(key);key=versions.get(key);}return key;};
  const reaches=(from,to,seen=new Set())=>from===to||(!seen.has(from)&&(seen.add(from),[...(graph.get(from)||[])].some(next=>reaches(next,to,seen))));
  for(const proposal of proposals){
    if(['withdraws','no_change'].includes(proposal.relation))continue;
    const target=current(proposal.target_memory_key),from=proposal.relation==='confirms'?target:proposal.memory_key;
    if(['updates','refines'].includes(proposal.relation)&&target)versions.set(target,from);
    for(const edge of proposal.relations){
      if(!['depends_on','exception_to'].includes(edge.kind))continue;
      const to=current(edge.target_memory_key);
      if(reaches(to,from))throw new RuntimeError('invalid_memory_graph_proposal',502);
      add(from,to);
    }
  }
  return proposals;
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
