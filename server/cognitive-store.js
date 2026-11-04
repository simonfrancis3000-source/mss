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
    commit: (auth, input) => rpc('commit_synqme_cognitive_turn', { p_user_id: auth.user.id, p_revision: String(auth.trainingRevision || '0'), p_scope: input.scope, p_turn_key: input.key, p_lease: input.lease, p_state: input.state, p_result: input.result, p_action: input.action || null }),
    release: (auth, input) => rpc('release_synqme_cognitive_turn', { p_user_id: auth.user.id, p_revision: String(auth.trainingRevision || '0'), p_scope: input.scope, p_turn_key: input.key, p_lease: input.lease }),
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
