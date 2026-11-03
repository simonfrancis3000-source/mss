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
