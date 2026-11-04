import test from 'node:test';
import assert from 'node:assert/strict';
import {applianceIntakeRequirement} from '../src/appliance-persona.js';
import {shouldContinueGuidedTurn,guidedReplyNeedsRepair} from '../server/guided-turn.js';
const exchange=(question,answer)=>[{role:'assistant',content:question},{role:'user',content:answer}];
test('an unfinished routine cannot end with a loading acknowledgement alone',()=>{
 const continueRoutine=shouldContinueGuidedTurn({scenario:{id:'room:kitchen'},intent:'answer'});
 assert.equal(continueRoutine,true);
 assert.equal(guidedReplyNeedsRepair('That settles the loading side.',{continueRoutine}),true);
 assert.equal(guidedReplyNeedsRepair('Understood. When would you like me to start a partly full load?',{continueRoutine}),false);
 assert.equal(shouldContinueGuidedTurn({scenario:{},intent:'pause'}),false);
 assert.equal(shouldContinueGuidedTurn({scenario:{},intent:'answer',voiceBreakDue:true}),false);
});
test('first appliance mention requires identity, the next brand answer asks model, known or deferred identity is not restarted',()=>{
 const first=exchange('How should I handle the dishes?','I put them in the dishwasher.');
 assert.deepEqual(applianceIntakeRequirement(first),{type:'dishwasher',field:'identity'});
 const model=applianceIntakeRequirement([...first,...exchange('What make is it?','Bosch')]);
 assert.deepEqual(model,{type:'dishwasher',field:'model'});
 assert.equal(guidedReplyNeedsRepair('When should I start it?',{continueRoutine:true,intake:model,language:'en'}),true);
 assert.equal(guidedReplyNeedsRepair('Its model label may be on the door frame. What is the exact model number?',{continueRoutine:true,intake:model,language:'en'}),false);
 assert.equal(applianceIntakeRequirement(first,[{type:'dishwasher',brand:'Bosch',model:'ABC123'}]),null);
 assert.equal(applianceIntakeRequirement([...first,...exchange('What make is your dishwasher?','Not now, later.'),...exchange('Should I wash plates?','Yes, use the dishwasher.')]),null);
 assert.equal(applianceIntakeRequirement(exchange('What helps?','I do not have a dishwasher.')),null);
});

test('continuity rejection does not masquerade as service failure or resurrect a repeated question',async()=>{
 const {guardScenarioQuestion}=await import('../server/continuity-guard.js');
 const {finalizeGuidedReply}=await import('../server/guided-turn.js');
 const guarded=await guardScenarioQuestion({draft:'Understood. When do you run it?',latestUser:'At night',continuity:{exchanges:[{question:'When do you run it?',answer:'At night'}]},review:async()=>({repeated_question:true}),rewrite:async()=> 'Understood. When do you run it?'});
 const result=finalizeGuidedReply(guarded,{continueRoutine:true});
 assert.equal(result.responseNeedsReview,false);assert.equal(result.reply,'Understood.');
 const empty=finalizeGuidedReply({reply:'',blocked:true},{continueRoutine:true});
 assert.ok(empty.reply);assert.equal(empty.responseNeedsReview,false);assert.equal(empty.reply.includes('?'),false);
 assert.equal(finalizeGuidedReply({reply:''},{continueRoutine:true}).responseNeedsReview,true);
});

test('an unfinished guided session leads with the next task after a rejected question',async()=>{
 const {guidedNextStep,finalizeGuidedReply}=await import('../server/guided-turn.js');
 const scenario={id:'room:kitchen',title:'Kitchen'};
 const objectives=[
  {id:'surfaces',title:'Cleaning surfaces',subject:'Learn which worktops should be cleaned'},
  {id:'supplies',title:'Cleaning supplies',subject:'Learn approved cleaning products'},
  {id:'waste',title:'Waste and recycling',subject:'Learn when to separate waste'}
 ];
 const plan={areas:[{id:'surfaces',status:'discussed'},{id:'supplies',status:'not_started'},{id:'waste',status:'not_started'}]};
 const recentMessages=[{role:'assistant',content:'What cleaning surfaces do you use?'}];
 const next=guidedNextStep({scenario,objectives,plan,recentMessages});
 assert.match(next,/cleaning supplies/i);
 assert.match(next,/Start by telling me/i);
 assert.doesNotMatch(next,/cleaning surfaces/i);
 assert.equal(next.includes('?'),false);
 const response=finalizeGuidedReply({reply:next,guidedInstruction:true},{continueRoutine:true,intake:{type:'dishwasher',field:'model'},language:'en'});
 assert.equal(response.responseNeedsReview,false);
 assert.equal(response.reply,next);
});
test('next-step recovery preserves appliance intake, review gates and explicit pause',async()=>{
 const {guidedNextStep,shouldContinueGuidedTurn}=await import('../server/guided-turn.js');
 const scenario={id:'room:kitchen',title:'Kitchen'};
 const objectives=[{id:'supplies',title:'Cleaning supplies',subject:'Which products are safe'}];
 const params={scenario,objectives,plan:{areas:[{id:'supplies',status:'not_started'}]},language:'en'};
 assert.match(guidedNextStep({...params,intake:{type:'dishwasher',field:'model'}}),/exact model number/);
 assert.match(guidedNextStep({...params,plan:{areas:[{id:'supplies',status:'reviewed'}]}}),/open Passport to review/i);
 assert.equal(guidedNextStep({...params,completionConfirmed:true}),'');
 assert.equal(shouldContinueGuidedTurn({scenario,intent:'pause'}),false);
 assert.equal(shouldContinueGuidedTurn({scenario,intent:'answer',latestUser:'Give me a minute'}),false);
 assert.equal(guidedNextStep({...params,language:'es'}),'');
});
