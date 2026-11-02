import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApplianceConversationGuidance, isApplianceIdentityAnswer } from '../src/appliance-persona.js';

test('short appliance identity answers are considered for private memory extraction', () => {
  assert.equal(isApplianceIdentityAnswer('Bosch', 'What brand is your dishwasher?'), true);
  assert.equal(isApplianceIdentityAnswer('SMS4HVI45E/01', 'What is the model number?'), true);
  assert.equal(isApplianceIdentityAnswer('I do not know', 'What is the model number?'), false);
  assert.equal(isApplianceIdentityAnswer('Bosch', 'What would you like to do?'), false);
});

test('device guidance supports all appliance types and requires verified source evidence', () => {
  const prompt = buildApplianceConversationGuidance();
  assert.match(prompt, /an appliance or device/i);
  assert.match(prompt, /vacuum, air fryer, microwave or coffee maker/i);
  assert.match(prompt, /never say you found, read or saved a manual/i);
  assert.match(prompt, /only when it is supported/i);
  assert.match(prompt, /let the owner skip/i);
  assert.match(prompt, /first mentions an appliance/i);
  assert.match(prompt, /letters and numbers/i);
  assert.match(prompt, /door frame/i);
  assert.match(prompt, /reviewed the available manual text/i);
  assert.match(prompt, /up to two useful features/i);
});
