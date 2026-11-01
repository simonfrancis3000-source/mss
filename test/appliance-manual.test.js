import test from 'node:test';
import assert from 'node:assert/strict';
import { manufacturerDomains, validateManualUrl, exactModelMentioned, findApplianceManual } from '../server/appliance-manual.js';

test('manual links must use the correct manufacturer domain over HTTPS', () => {
  const domains = manufacturerDomains('Bosch');
  assert.equal(validateManualUrl('https://media3.bosch-home.com/Documents/manual.pdf', domains), 'https://media3.bosch-home.com/Documents/manual.pdf');
  for (const url of ['http://bosch-home.com/manual', 'https://bosch-home.com.evil.test/manual', 'https://user:pass@bosch-home.com/manual', 'https://127.0.0.1/manual']) assert.equal(validateManualUrl(url, domains), null);
  assert.equal(exactModelMentioned('SMS4HVI45E/01', 'SMS4HVI45E/02 instruction manual'), false);
  assert.equal(exactModelMentioned('SMS4HVI45E/01', 'SMS4HVI45E/01 instruction manual'), true);
});

test('manual lookup only returns a matched document after fetching model-specific contents', async () => {
  const calls = [];
  const mock = async (url, options) => {
    calls.push({url, body: JSON.parse(options.body)});
    if (url.endsWith('/search')) return { ok: true, json: async () => ({ results: [{url:'https://evil.test/fake'}, {url:'https://bosch-home.com/manual'}] }) };
    return { ok: true, json: async () => ({ title: 'User manual', content: 'SMS4HVI45E/01 user manual. Delicate programme.' }) };
  };
  const result = await findApplianceManual({brand:'Bosch', model:'SMS4HVI45E/01', type:'dishwasher', key:'test', fetchImpl:mock});
  assert.equal(result.status, 'matched');
  assert.equal(result.url, 'https://bosch-home.com/manual');
  assert.equal(calls.length, 2);
  const bad = await findApplianceManual({brand:'unknown', model:'A1234', type:'coffee maker', key:'test', fetchImpl:mock});
  assert.equal(bad.status, 'manufacturer_unverified');
});

test('saved manual is reread only from the manufacturer and must still match the model', async () => {
  const { readSavedApplianceManual } = await import('../server/appliance-manual.js');
  let calls = 0;
  const mock = async () => { calls++; return { ok: true, json: async () => ({title:'User manual', content:'Model ABC1234 user manual'}) }; };
  assert.equal(await readSavedApplianceManual({brand:'Bosch', model:'ABC1234', url:'https://evil.test/manual', key:'x', fetchImpl:mock}), null);
  assert.equal(calls, 0);
  assert.equal((await readSavedApplianceManual({brand:'Bosch', model:'ABC1234', url:'https://bosch-home.com/manual', key:'x', fetchImpl:mock})).url, 'https://bosch-home.com/manual');
  assert.equal(await readSavedApplianceManual({brand:'Bosch', model:'ABC9999', url:'https://bosch-home.com/manual', key:'x', fetchImpl:mock}), null);
});

test('identity is accepted only when brand and full model were stated by the user', async () => {
  const { validateApplianceIdentity } = await import('../server/appliance-manual.js');
  const messages = [{role:'user',content:'My dishwasher is Bosch'}, {role:'assistant',content:'What model?'}, {role:'user',content:'ABC1234/01'}];
  assert.deepEqual(validateApplianceIdentity({type:'dishwasher',brand:'Bosch',model:'ABC1234/01'},messages), {type:'dishwasher',brand:'Bosch',model:'ABC1234/01'});
  assert.equal(validateApplianceIdentity({type:'dishwasher',brand:'Bosch',model:'ABC1234/02'},messages), null);
  assert.equal(validateApplianceIdentity({type:'dishwasher',brand:'Samsung',model:'ABC1234/01'},messages), null);
});
