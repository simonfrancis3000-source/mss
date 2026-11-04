import { conversationQuestions } from '../src/conversation-continuity.js';

export function shouldContinueGuidedTurn({scenario,completionConfirmed,intent,latestUser='',voiceBreakDue=false}) {
 return Boolean(scenario) && !completionConfirmed && !voiceBreakDue && !['pause','explain','progress','service_help'].includes(intent) &&
  !/\b(?:no more questions|stop asking|let me (?:think|pause)|give me a (?:moment|minute)|good ?bye|that's all|that is all)\b/i.test(latestUser);
}
export function guidedReplyNeedsRepair(reply,{continueRoutine,intake,language='en'}) {
 const questions=conversationQuestions(reply);
 if(continueRoutine && !questions.length)return true;
 if(!intake || language!=='en')return false;
 return !questions.some(question=>(intake.field==='model' ? /\b(?:model|product number|pnc|e-?nr)\b/i : /\b(?:make|brand|manufacturer|model|product number|pnc|e-?nr)\b/i).test(question));
}
export const GUIDED_TURN_CORRECTION = 'GUIDED TURN CORRECTION: The previous draft stopped the routine or skipped appliance identification. Briefly acknowledge the latest answer, then ask exactly one concrete, useful unanswered question. If APPLIANCE INTAKE REQUIRED is present, address that missing make or model first, using identity already supplied. Otherwise deepen an undecided detail of the current routine or move naturally to an unreviewed area in the same scenario. Do not end with only that settles it, got it, a summary, or a promise to move on. Never repeat a settled decision or ask the owner to lead. Respect pauses, deferrals, exclusions and unknown details. Do not invent facts or mark an area complete.';

// Generation may try to add a follow-up, but a continuity check may remove it.
// Lack of a question must not turn a useful, checked response into an outage.
export function finalizeGuidedReply(guarded, requirements) {
 let reply = String(guarded.reply || '').trim();
 if (!reply && guarded.blocked) reply = "I don't have a new question on this point right now. Your conversation is still here; we can pause or revisit a detail whenever you choose.";
 const responseNeedsReview = !reply || (!guarded.blocked && !guarded.reviewUnavailable && guidedReplyNeedsRepair(reply,{...requirements,continueRoutine:false}));
 return {reply,responseNeedsReview};
}


// An intentionally non-interrogative, task-specific next step when generation or
// continuity review cannot produce a new safe question. This avoids leaving
// someone in guided training with only "Got it." and no idea what to do next.
// It never marks an area complete or crosses into a different scenario.
export function guidedNextStep({ scenario, objectives = [], plan, recentMessages = [], intake = null, language = 'en', completionConfirmed = false } = {}) {
  if (!scenario || completionConfirmed || language !== 'en') return '';
  if (intake?.type) {
    const device = String(intake.type).replace(/[^a-z -]/gi, '').trim() || 'appliance';
    return intake.field === 'model'
      ? 'Got it. Before I plan around your ' + device + ', please tell me its exact model number if you have it. Otherwise, say "later" and we will continue with another task.'
      : 'Got it. Before I plan around your ' + device + ', please tell me its make and exact model if you know them. Otherwise, say "later" and we will continue with another task.';
  }
  if (!Array.isArray(objectives) || !objectives.length) return '';
  const statuses = new Map((plan?.areas || []).map(area => [area.id, area.status]));
  const remaining = objectives.filter(area => statuses.get(area.id) !== 'reviewed');
  if (!remaining.length) {
    return 'We have covered the learning areas in ' + scenario.title + '. Please open Passport to review the saved preferences and confirm the scenario when you are satisfied. I will not mark it complete for you.';
  }
  const recent = recentMessages.filter(message => message?.role === 'assistant')
    .slice(-5).map(message => String(message.content || '').toLowerCase()).join(' ');
  const notStarted = remaining.filter(area => (statuses.get(area.id) || 'not_started') === 'not_started');
  // Start a genuinely different pending task if the last one has already been
  // discussed. Prefer a recently unmentioned task to avoid looping on the
  // acknowledgement that triggered this recovery.
  const fresh = areas => areas.find(area => !recent.includes(area.title.toLowerCase()));
  const next = fresh(notStarted) || fresh(remaining) || notStarted[0] || remaining[0];
  const subject = String(next.subject || '').trim().slice(0, 260);
  const context = subject ? ' ' + subject.replace(/[.!?]+$/, '') + '.' : '';
  return 'I have that. Next, let\'s explore ' + next.title.toLowerCase() + ' in ' + scenario.title + '.' +
    context + ' Start by telling me what you would want me to do first, and anything I should check with you about.';
}
