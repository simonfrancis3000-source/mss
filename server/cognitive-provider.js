import { RuntimeError, runtimePrompt, validateTurnProposal, checkRuntimeReply } from './cognitive-core.js';

// JSON object mode is not a schema guarantee. Validate independently. The
// adapter can later use another provider without moving AMIA's state or rules.
export function createCognitiveProvider({ key, model, fetchImpl = fetch, onUsage = async () => {} }) {
  return async ({ context, objectives, correction = null }) => {
    if (!key) throw new RuntimeError('runtime_model_not_configured');
    const answerOnly = context?.intent === 'service_help' || context?.activeTraining === false;
    const turnContract = answerOnly
      ? '\nTURN CONTRACT: Answer the request directly. Do not ask a question, append an open point, offer a reminder, or extract new memories from this answer-only request. Return reminder_offer:null, decision_key:null and memory_proposals:[] unless the latest message itself states a new durable fact.'
      : '\nTURN CONTRACT: Answer the current point, including any explanation or progress request, then lead with one useful unresolved question. Keep the conversation moving unless the owner pauses or finishes. Do not ask the owner to confirm a rule or exception they have already explicitly stated.';
    const repairInstructions = {unexpected_question:'Remove every follow-up and question. Give only the requested explanation, ending in a statement.',missing_continuation:'End with one relevant unresolved question.',settled_decision:'Choose a genuinely different unresolved decision and key; do not paraphrase the settled question.',multiple_questions:'Use one final question only. Remove quoted and rhetorical questions.'};
    let response;
    try {
      response = await fetchImpl('https://api.deepseek.com/chat/completions', {
        method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, temperature: 0.4, max_tokens: 2600, stream: false,
          messages: [{ role: 'system', content: runtimePrompt + turnContract + (correction ? '\nRepair the proposal. Violation: ' + correction + '. ' + (repairInstructions[correction] || 'Return a corrected valid proposal.') : '') }, { role: 'user', content: JSON.stringify(context) }] }),
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


// Shared by the runtime and live evaluator. One invalid proposal may be
// repaired once; neither caller can accept a reply that still fails quality.
export async function generateCheckedCognitiveTurn({ generate, context, objectives, quality }) {
  let violation = null;
  const attempts = [];
  const repairable = new Set(['invalid_model_proposal','incomplete_model_proposal','model_action_rejected','unknown_objective','invalid_reminder_offer']);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const proposal = await generate({ context, objectives, correction: violation });
      violation = checkRuntimeReply(proposal, quality);
      attempts.push({ attempt, qualityViolation: violation });
      if (!violation) return { proposal, attempts };
    } catch (error) {
      attempts.push({ attempt, errorCode: error.code || 'provider_unavailable', ...(error.providerStatus ? {providerStatus:error.providerStatus} : {}) });
      if (!repairable.has(error.code)) { error.attempts = attempts; throw error; }
      violation = error.code;
    }
  }
  const error = new RuntimeError('runtime_quality_check_failed', 502);
  error.attempts = attempts;
  throw error;
}
