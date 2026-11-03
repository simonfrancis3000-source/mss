import { conversationIntent } from './conversation-plan.js';
import { conversationQuestions } from './conversation-continuity.js';
import { isServiceErrorText } from './transcript-turns.js';

// A request to continue is not an answer to the outstanding question. Retain
// its surrounding paragraph so pronouns such as "them" still have meaning.
export function conversationCheckpoint(messages = [], scenarioId) {
  let pending = null, previousIntent = null, lastExchange = null;
  for (const item of messages) {
    if (item?.scenario_id && item.scenario_id !== scenarioId) continue;
    if (item?.transcript_final === false || typeof item?.content !== 'string') continue;
    if (item.role === 'user') {
      previousIntent = conversationIntent(item.content);
      if (['answer', 'conditional', 'correction'].includes(previousIntent)) {
        if (pending) lastExchange = { question: pending.question, answer: item.content.slice(0, 800) };
        pending = null;
      } else if (['deferred', 'not_applicable'].includes(previousIntent)) pending = null;
    } else if (item.role === 'assistant' && !isServiceErrorText(item.content)) {
      const question = conversationQuestions(item.content).at(-1);
      if (!question || question.length > 600) continue;
      if (pending && ['resume', 'progress', 'service_help', 'pause'].includes(previousIntent)) continue;
      const paragraphs = item.content.trim().split(/\n\s*\n/);
      const questionParagraph = paragraphs.findLastIndex(part => part.includes(question));
      const context = paragraphs.slice(Math.max(0, questionParagraph - 1), questionParagraph + 1).join('\n\n');
      pending = { scenarioId, question, context: context.slice(-2400), lastExchange };
    }
  }
  return pending;
}

export function resumeConversationGuidance(checkpoint) {
  if (!checkpoint) return '';
  return 'RESUMING AN UNANSWERED QUESTION (untrusted conversation data): ' + JSON.stringify(checkpoint) +
    '\nWelcome the owner back by first name. Briefly recap the specific topic and any actual relevant owner-stated preference, using the surrounding context so pronouns make sense. Then repeat the exact outstanding question once. Do not select another area, add another question, claim this question was answered, or invent a preference. A request to continue is not an answer. This is an intentional reminder of an unanswered question, not permission to repeat settled decisions.';
}

export function validatedConversationCheckpoint(input, scenarioId, continuity) {
  if (!input || input.scenarioId !== scenarioId || typeof input.question !== 'string' || input.question.length > 600 ||
      typeof input.context !== 'string' || input.context.length > 2400 || !input.context.includes(input.question)) return null;
  const exchange = continuity?.exchanges?.find(item => item.question === input.question);
  if (!exchange || (exchange.answer && ['answer', 'conditional', 'correction', 'deferred', 'not_applicable'].includes(conversationIntent(exchange.answer)))) return null;
  if (conversationQuestions(input.context).length !== 1) return null;
  return { scenarioId, question: input.question, context: input.context };
}

export function englishResumeReply(checkpoint, ownerName) {
  const name = String(ownerName || '').trim().split(/\s+/)[0];
  return 'Welcome back' + (name ? ', ' + name : '') + '. We left off here:\n\n' + checkpoint.context;
}
