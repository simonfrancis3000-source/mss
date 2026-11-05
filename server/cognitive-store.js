import { RuntimeError } from './cognitive-core.js';

// Server credential only. Browser clients can read their own ledger via RLS,
// but cannot mutate runtime state or execute its transaction functions.
export function createCognitiveStore({ supabaseUrl, secretKey, fetchImpl = fetch }) {
  async function rpc(name, args) {
    if (!supabaseUrl || !secretKey) throw new RuntimeError('runtime_storage_not_configured');
    let response;
    try {
      response = await fetchImpl(String(supabaseUrl).replace(/\/+$/, '') + '/rest/v1/rpc/' + name, {
        method: 'POST', headers: { apikey: secretKey, Authorization: 'Bearer ' + secretKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(args), signal: AbortSignal.timeout(8000)
      });
    } catch { throw new RuntimeError('runtime_storage_unavailable'); }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const code = result?.message;
      if (['runtime_busy', 'runtime_stale_lease', 'runtime_turn_conflict', 'runtime_revision_changed'].includes(code)) throw new RuntimeError(code, 409);
      throw new RuntimeError('runtime_storage_unavailable');
    }
    return result;
  }
  return {
    claim: (auth, input) => rpc('claim_synqme_cognitive_turn', { p_user_id: auth.user.id, p_revision: String(auth.trainingRevision || '0'), p_scope: input.scope, p_turn_key: input.key, p_fingerprint: input.fingerprint }),
    commit: (auth, input) => rpc('commit_synqme_cognitive_turn_v2', { p_user_id: auth.user.id, p_revision: String(auth.trainingRevision || '0'), p_scope: input.scope, p_turn_key: input.key, p_lease: input.lease, p_state: input.state, p_result: input.result, p_action: input.action || null, p_enrichment: input.enrichment || {} }),
    release: (auth, input) => rpc('release_synqme_cognitive_turn', { p_user_id: auth.user.id, p_revision: String(auth.trainingRevision || '0'), p_scope: input.scope, p_turn_key: input.key, p_lease: input.lease }),
    claimMemoryJob: () => rpc('claim_synqme_cognitive_memory_job', {}),
    completeMemoryJob: job => rpc('complete_synqme_cognitive_memory_job', { p_job_id: job.id, p_lease: job.lease_token }),
    retryMemoryJob: job => rpc('retry_synqme_cognitive_memory_job', { p_job_id: job.id, p_lease: job.lease_token }),
    prune:()=>rpc('prune_synqme_cognitive_history',{}),
    delivery:(auth,input)=>rpc('record_synqme_cognitive_delivery',{p_user_id:auth.user.id,p_revision:String(auth.trainingRevision || '0'),p_turn_key:input.turnId,p_delivery_key:input.deliveryKey,p_channel:input.channel,p_status:input.status,p_sequence:input.sequence}),
    async review(auth, scope) {
      const get = async (table, params) => {
        const response = await fetchImpl(String(supabaseUrl).replace(/\/+$/, '') + '/rest/v1/' + table + '?' + new URLSearchParams({ user_id: 'eq.' + auth.user.id, ...params }), {
          headers: { apikey: secretKey, Authorization: 'Bearer ' + secretKey }, signal: AbortSignal.timeout(7000)
        });
        if (!response.ok) throw new RuntimeError('runtime_context_unavailable');
        return response.json();
      };
      const [journeys,relations,jobs] = await Promise.all([
        get('synqme_room_journeys',{select:'active_room_id,active_task_id,room_progress',limit:'1'}),
        get('synqme_rule_relations',{select:'from_rule_id,to_rule_id,relation,source_refs',limit:'100'}),
        get('synqme_memory_jobs',{select:'id,attempts',server_owned:'eq.true',status:'neq.done',limit:'20'})
      ]);
      const progress = journeys[0]?.room_progress?.scenario_journey_v1 || {};
      return { reviewedAreaIds: Array.isArray(progress.reviewed?.[scope]) ? progress.reviewed[scope] : [],
        completionConfirmed: Array.isArray(progress.completed) && progress.completed.includes(scope),
        activeAreaId: journeys[0]?.active_task_id || null, relations, pendingMemoryJobs:jobs.length, failedMemoryJobs:jobs.filter(j=>j.attempts>=5).length };
    },
    async reminders(auth) {
      const url = String(supabaseUrl).replace(/\/+$/, '') + '/rest/v1/synqme_reminders?' + new URLSearchParams({ user_id: 'eq.' + auth.user.id, select: 'id,title,completed', order: 'created_at.desc', limit: '500' });
      const response = await fetchImpl(url, { headers: { apikey: secretKey, Authorization: 'Bearer ' + secretKey }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new RuntimeError('runtime_storage_unavailable');
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new RuntimeError('runtime_storage_unavailable');
      return rows;
    }
  };
}
