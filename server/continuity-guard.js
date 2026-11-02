import { conversationQuestions } from '../src/conversation-continuity.js';

const normalized = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
export function questionFreeReply(value) {
  return String(value || '').replace(/[^.!?。！？؟\n]*[?？؟]/gu, '').trim();
}

// Review the meaning of a proposed question, not just word overlap. The review
// is separate from generation so paraphrases cannot silently bypass the ledger.
export async function guardScenarioQuestion({ draft, latestUser, continuity, decisions = [], rules = [], reviewedAreas = [], review, rewrite }) {
  const exchanges = continuity?.exchanges || [];
  const questions = decisions.filter(item => item.question).map(({ question, status }) => ({ question, status }));
  if (!exchanges.length && !questions.length && !reviewedAreas.length) return { reply: draft, blocked: false };
  const history = [...questions, ...exchanges];
  const explicitlyReopened = /\b(?:revisit|ask (?:me )?again|go over|remind me|change my|changed my|actually|instead|correction|no longer)\b/i.test(latestUser);
  let candidate = draft;
  let blocked = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const proposed = conversationQuestions(candidate);
    if (!proposed.length) return { reply: candidate, blocked };
    let verdict;
    const exact = proposed.find(question => history.some(old => normalized(old.question) === normalized(question)));
    if (exact && !explicitlyReopened) verdict = { repeated_question: true, reason: 'This question already appears in the saved question history.', matched_question: exact };
    else {
      try {
        verdict = await review({ latestUser, candidate, exchanges, questions, rules, reviewedAreas });
        if (typeof verdict?.repeated_question !== 'boolean') throw Error('invalid_continuity_review');
      } catch {
        // Fail closed for the new question, while retaining a useful direct
        // acknowledgement. Never substitute another unchecked stock question.
        return { reply: questionFreeReply(candidate), blocked: true, reviewUnavailable: true };
      }
    }
    if (!verdict.repeated_question) return { reply: candidate, blocked };
    blocked = true;
    if (attempt === 0) {
      try {
        candidate = await rewrite({ candidate, reason: String(verdict.reason || '').slice(0, 800), matched_question: String(verdict.matched_question || '').slice(0, 500) });
        if (typeof candidate !== 'string' || !candidate.trim()) throw Error('empty_continuity_repair');
        continue;
      } catch {}
    }
    return { reply: questionFreeReply(candidate), blocked: true };
  }
}
