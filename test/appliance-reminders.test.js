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
