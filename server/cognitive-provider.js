import { RuntimeError, runtimePrompt, validateTurnProposal } from './cognitive-core.js';

// JSON object mode is not a schema guarantee. Validate independently. The
// adapter can later use another provider without moving AMIA's state or rules.
export function createCognitiveProvider({ key, model, fetchImpl = fetch, onUsage = async () => {} }) {
  return async ({ context, objectives, correction = null }) => {
    if (!key) throw new RuntimeError('runtime_model_not_configured');
    let response;
    try {
      response = await fetchImpl('https://api.deepseek.com/chat/completions', {
        method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, temperature: 0.4, max_tokens: 2600, stream: false,
          messages: [{ role: 'system', content: runtimePrompt + (correction ? '\nRepair the proposal. Violation: ' + correction : '') }, { role: 'user', content: JSON.stringify(context) }] }),
        signal: AbortSignal.timeout(25000)
      });
    } catch { throw new RuntimeError('runtime_model_unavailable', 502); }
    if (!response.ok) {
      const code = {400:'runtime_model_request_invalid',401:'runtime_model_auth_rejected',402:'runtime_model_balance_insufficient',403:'runtime_model_access_denied',404:'runtime_model_not_found',422:'runtime_model_request_invalid',429:'runtime_model_rate_limited'}[response.status] || 'runtime_model_unavailable';
      const error = new RuntimeError(code, 502);
      // Preserve status for diagnostics, never the upstream response body or key.
      error.providerStatus = response.status;
      throw error;
    }
    const data = await response.json().catch(() => null);
    await onUsage(data).catch(() => {});
    if (data?.choices?.[0]?.finish_reason !== 'stop') throw new RuntimeError('incomplete_model_proposal', 502);
    let value;
    try { value = JSON.parse(data.choices[0].message.content); } catch { throw new RuntimeError('invalid_model_proposal', 502); }
    return validateTurnProposal(value, objectives);
  };
}
