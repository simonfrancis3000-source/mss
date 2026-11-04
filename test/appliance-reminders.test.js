import test from 'node:test';
import assert from 'node:assert/strict';
import {applianceReminderTurn} from '../src/appliance-reminders.js';
import {applianceIntakeRequirement} from '../src/appliance-persona.js';
const turns=(question,answer)=>[{role:'assistant',content:question},{role:'user',content:answer}];
for (const device of ['dishwasher','oven','fridge','freezer','washing machine','dryer','vacuum cleaner','air fryer','microwave','coffee machine','kettle','toaster','blender','food processor','mixer','pressure cooker','slow cooker','rice cooker','extractor hood','air conditioner','air purifier','dehumidifier','humidifier','heater','boiler','thermostat','water heater','television','speaker','lawnmower','iron','steamer']) {
 test(device+' unavailable model offers consent before saving',()=>{
  const history=turns('What is the model number of your '+device+'?',"I don't know.");
  const offer=applianceReminderTurn(history);
  assert.ok(offer.reply.includes('to-do reminders?'));assert.equal(offer.command,undefined);
  const accepted=[...history,{role:'assistant',content:offer.reply},{role:'user',content:'Yes please'}];
  assert.deepEqual(applianceReminderTurn(accepted).command,{action:'add',title:'Find the '+device+' model number'});
  accepted.at(-1).content='No thanks'; assert.ok(applianceReminderTurn(accepted).reply.includes("won't add"));
  accepted.at(-1).content='Tell me about loading plates'; assert.equal(applianceReminderTurn(accepted),null);
 });
}
test('serial is distinguished from model and does not restart intake',()=>{
 const h=turns('Your dishwasher model is ABC123. Do you have its serial number?',"I don't have a serial number.");
 assert.match(applianceReminderTurn(h).reply,/serial number is usually unnecessary/);
 assert.equal(applianceIntakeRequirement(h,[{type:'dishwasher',brand:'Bosch',model:'ABC123'}]),null);
});
test('absence, secrets, skip and a declined repeated offer do not create reminders',()=>{
 assert.equal(applianceReminderTurn(turns('What model is your oven?',"I don't have an oven")),null);
 assert.equal(applianceReminderTurn(turns('What model is your dishwasher?',"I don't know, skip it")),null);
 assert.equal(applianceReminderTurn(turns('What is your device password?',"I don't know my password")),null);
 const h=turns('What model is your oven?',"I don't know"); const o=applianceReminderTurn(h);
 h.push({role:'assistant',content:o.reply},{role:'user',content:'No thanks'},...turns('What model is your oven?',"I don't know"));
 assert.equal(applianceReminderTurn(h),null);
});

test('natural hob-model reminder offer in voice accepts an explicit reminder reply',()=>{
 const history=[
  {role:'assistant',content:'Which make is your hob, so I can find the right care instructions?'},
  {role:'user',content:'I do not have the model number.'},
  {role:'assistant',content:"Since you don't have the model number to hand, shall I add a to-do reminder to look it up later, or would you rather leave it for now?"},
  {role:'user',content:'And as a reminder.'}
 ];
 assert.deepEqual(applianceReminderTurn(history).command,{action:'add',title:'Find the hob model number'});
 history[3]={role:'user',content:'Yes, please add it'};
 assert.deepEqual(applianceReminderTurn(history).command,{action:'add',title:'Find the hob model number'});
 history[3]={role:'user',content:'Not now'};
 assert.match(applianceReminderTurn(history).reply,/won't add/);
 history[3]={role:'user',content:'What about my dishwasher?'};
 assert.equal(applianceReminderTurn(history),null);
});
test('yes alone must not create reminders if the robot did not offer one',()=>{
 const history=[{role:'assistant',content:'Which model is your hob?'},{role:'user',content:'Yes'}];
 assert.equal(applianceReminderTurn(history),null);
});
