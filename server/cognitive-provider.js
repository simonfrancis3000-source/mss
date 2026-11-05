import { RuntimeError, runtimePrompt, validateTurnProposal, checkRuntimeReply } from './cognitive-core.js';

// JSON object mode is not a schema guarantee. Validate independently. The
// adapter can later use another provider without moving AMIA's state or rules.
export function createCognitiveProvider({ key, model, fetchImpl = fetch, onUsage = async () => {} }) {
  return async ({ context, objectives, correction = null, correctionDetail = null, rejectedProposal = null, deadline = Infinity }) => {
    if (!key) throw new RuntimeError('runtime_model_not_configured');
    if(deadline<=performance.now())throw new RuntimeError('runtime_model_unavailable',502);
    const answerOnly = context?.intent === 'service_help' || context?.activeTraining === false;
    const turnContract = answerOnly
      ? '\nTURN CONTRACT: Answer the request directly. Do not ask a question, append an open point, offer a reminder, or extract new memories from this answer-only request. Return next_question:null, reminder_offer:null, decision_key:null and memory_proposals:[] unless the latest message itself states a new durable fact.'
      : '\nTURN CONTRACT: Put the answer to the current point in reply. Always provide next_question as one direct, useful unresolved question ending in a question mark. The runtime attaches that question after the answer. Explanation and progress requests still need next_question; you may return to the open unanswered question after a requested recap. Do not end with a statement such as "the open point is" or "I would like to know" instead. Do not ask the owner to confirm a rule or exception they have already explicitly stated.';
    const repairInstructions = {unexpected_question:'Remove every follow-up and question. Give only the requested explanation, ending in a statement.',missing_continuation:'End with one relevant unresolved question.',settled_decision:'Choose a genuinely different unresolved decision and key; do not paraphrase the settled question.',settled_question:'The owner already answered or deferred that question. Ask one different unresolved question.',repeated_question:'The current decision has reached its unanswered-ask limit. Choose a different relevant unresolved decision and a different decision_key. Do not paraphrase the same question. Keep next_question as one direct question.',multiple_questions:'Use one final question only. Remove quoted and rhetorical questions.'};
    repairInstructions.invalid_model_proposal='Return schema_version:1, a nonempty reply string (answer only), next_question as one question string ending in ?, and memory_proposals as an array of at most eight items. Do not return objects for string fields.';
    const messages=[{role:'system',content:runtimePrompt+turnContract+(correction?'\nRepair the proposal. Violation: '+correction+'. '+(correctionDetail?'Field failure: '+correctionDetail+'. ':'')+(repairInstructions[correction]||'Return a corrected valid proposal.'):'')},{role:'user',content:JSON.stringify(context)}];
    if (correction && rejectedProposal) {
      messages.push({role:'assistant',content:JSON.stringify({schema_version:1,reply:rejectedProposal.reply,next_question:rejectedProposal.nextQuestion||null,decision_key:rejectedProposal.decisionKey,memory_proposals:rejectedProposal.memoryProposals,actions:[]})});
      messages.push({role:'user',content:JSON.stringify({task:'Replace this rejected draft. Preserve the owner facts and answer the latest owner message.',violation:correction,instruction:repairInstructions[correction]||'Return a valid schema. Remove circular or self-referencing dependency links if present. Keep the grounded facts and valid restrictions.',response_format:answerOnly?'Answer in reply and set next_question:null.':'Answer in reply and set next_question to one direct unresolved question ending in a question mark.',avoid:'Do not repeat a rejected settled question or merely rename its decision key. A requested recap may return to an unanswered question.'})});
    }
    let response;
    try {
      response = await fetchImpl('https://api.deepseek.com/chat/completions', {
        method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, temperature: 0.4, max_tokens: 2600, stream: false,
          messages }),
        signal: AbortSignal.timeout(Math.max(1,Math.min(25000,Math.floor(deadline-performance.now()))))
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
    try { value = JSON.parse(data.choices[0].message.content); } catch { const error=new RuntimeError('invalid_model_proposal',502);error.proposalViolation='json_parse';throw error; }
    return validateTurnProposal(value, objectives);
  };
}


// One format repair and one quality repair. Repeated failures of the same
// class stop immediately; only mixed failures can use a third request.
export async function generateCheckedCognitiveTurn({ generate, context, objectives, quality, validateProposal = () => {}, deadline = Infinity }) {
  let violation = null, correctionDetail = null, rejectedProposal = null,formatFailures=0,qualityFailures=0;
  const expires=Math.min(deadline,performance.now()+55000);
  const attempts = [];
  const repairable = new Set(['invalid_model_proposal','incomplete_model_proposal','model_action_rejected','unknown_objective','invalid_reminder_offer','invalid_memory_graph_proposal']);
  for (let attempt = 1; attempt <= 3; attempt++) {
    if(performance.now()>=expires)break;
    try {
      const proposal = await generate({ context, objectives, correction: violation, correctionDetail, rejectedProposal,deadline:expires });
      rejectedProposal = proposal;
      violation = checkRuntimeReply(proposal, {...quality,latestUser:context?.latestUser || '',intent:context?.intent || quality.intent});
      if (!violation) validateProposal(proposal);
      attempts.push({ attempt, qualityViolation: violation });
      if (!violation) return { proposal, attempts };
      qualityFailures++;correctionDetail=null;
    } catch (error) {
      attempts.push({ attempt, errorCode: error.code || 'provider_unavailable', ...(error.providerStatus ? {providerStatus:error.providerStatus} : {}),...(error.proposalViolation?{proposalViolation:error.proposalViolation}:{}) });
      if (!repairable.has(error.code)) { error.attempts = attempts; throw error; }
      violation = error.code;
      correctionDetail=error.proposalViolation||null;
      if(['invalid_model_proposal','incomplete_model_proposal'].includes(error.code))formatFailures++;else qualityFailures++;
    }
    if(formatFailures>=2||qualityFailures>=2)break;
  }
  const error = new RuntimeError('runtime_quality_check_failed', 502);
  error.attempts = attempts;
  throw error;
}
