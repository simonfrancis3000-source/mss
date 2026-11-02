import { conversationQuestions } from '../src/conversation-continuity.js';

export function shouldContinueGuidedTurn({scenario,completionConfirmed,intent,latestUser='',voiceBreakDue=false}) {
 return Boolean(scenario) && !completionConfirmed && !voiceBreakDue && !['pause','explain','progress'].includes(intent) &&
  !/\b(?:no more questions|stop asking|let me (?:think|pause)|give me a (?:moment|minute)|good ?bye|that's all|that is all)\b/i.test(latestUser);
}
export function guidedReplyNeedsRepair(reply,{continueRoutine,intake,language='en'}) {
 const questions=conversationQuestions(reply);
 if(continueRoutine && !questions.length)return true;
 if(!intake || language!=='en')return false;
 return !questions.some(question=>(intake.field==='model' ? /\b(?:model|product number|pnc|e-?nr)\b/i : /\b(?:make|brand|manufacturer|model|product number|pnc|e-?nr)\b/i).test(question));
}
export const GUIDED_TURN_CORRECTION = 'GUIDED TURN CORRECTION: The previous draft stopped the routine or skipped appliance identification. Briefly acknowledge the latest answer, then ask exactly one concrete, useful unanswered question. If APPLIANCE INTAKE REQUIRED is present, address that missing make or model first, using identity already supplied. Otherwise deepen an undecided detail of the current routine or move naturally to an unreviewed area in the same scenario. Do not end with only that settles it, got it, a summary, or a promise to move on. Never repeat a settled decision or ask the owner to lead. Respect pauses, deferrals, exclusions and unknown details. Do not invent facts or mark an area complete.';
