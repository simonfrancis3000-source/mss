import test from 'node:test';
import assert from 'node:assert/strict';
import { findApplianceManual, readSavedApplianceManual } from '../server/appliance-manual.js';
import { createCognitiveApplianceResolver } from '../server/cognitive-appliance.js';

test('Parallel uses official manufacturer source filtering and exact model evidence', async () => {
  const calls = [];
  const mock = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({url, body, headers: options.headers});
    if (url.endsWith('/search')) {
      return Response.json({results:[
        {url:'https://fake.example/manual',title:'Untrusted'},
        {url:'https://bosch-home.com/support/manual-model',title:'Operating manual - ABC7582/01'}
      ]});
    }
    return Response.json({results:[{
      url:'https://bosch-home.com/support/manual-model',
      title:'Operating manual ABC7582/01',
      excerpts:['ABC7582/01 manual. Delicate cycle.']
    }]});
  };
  const usage = [];
  const result = await findApplianceManual({
    brand:'Bosch',model:'ABC7582/01',type:'dishwasher',
    key:'fake-key',provider:'parallel',fetchImpl:mock,onUsage: kind=>usage.push(kind)
  });
  assert.equal(result.status,'matched');
  assert.equal(result.url,'https://bosch-home.com/support/manual-model');
  assert.deepEqual(usage,['search','fetch']);
  assert.equal(calls.length,2);
  assert.equal(calls[0].url,'https://api.parallel.ai/v1/search');
  assert.equal(calls[1].url,'https://api.parallel.ai/v1/extract');
  assert.deepEqual(calls[0].body.advanced_settings.source_policy.include_domains,['bosch-home.com','bosch-home.co.uk']);
  assert.equal(calls[0].body.mode,'fast');
  assert.deepEqual(calls[1].body.urls,['https://bosch-home.com/support/manual-model']);
  assert.equal(calls[0].headers['x-api-key'],'fake-key');
  assert.doesNotMatch(JSON.stringify(calls), /account|email|owner|persona/i);
  assert.match(result.excerpt,/Delicate cycle/);
});

test('Parallel rejects an official webpage that lacks exact-model proof', async () => {
  const mock = async (url) => url.endsWith('/search')
    ? Response.json({results:[{url:'https://siemens-home.bsh-group.com/manual',title:'User guide'}]})
    : Response.json({results:[{url:'https://siemens-home.bsh-group.com/manual', title:'User guide', excerpts:['Manual for ABC9999 but not the requested model.']}]});
  const result = await findApplianceManual({
    brand:'Siemens',model:'ABC2222',type:'dishwasher',key:'key',provider:'parallel',fetchImpl:mock
  });
  assert.equal(result.status,'manual_unverified');
});

test('Parallel saved-manual reread preserves manufacturer allowlist', async () => {
  let calls=0;
  const mock=async () => {calls++;return Response.json({results:[{url:'https://miele.com/manual',title:'Operating manual',excerpts:['MIE1234 official operating manual']} ]});};
  assert.equal(await readSavedApplianceManual({brand:'Miele',model:'MIE1234',url:'https://untrusted.example/manual',key:'key',provider:'parallel',fetchImpl:mock}),null);
  assert.equal(calls,0);
  const saved=await readSavedApplianceManual({brand:'Miele',model:'MIE1234',url:'https://miele.com/manual',key:'key',provider:'parallel',fetchImpl:mock});
  assert.equal(saved.url,'https://miele.com/manual');
  assert.match(saved.excerpt,/MIE1234/);
});

test('Cognitive resolver retains verified URL, not manual contents, in memory record',async()=>{
  const mock=async(url)=>url.endsWith('/search')
    ? Response.json({results:[{url:'https://bosch-home.com/support/cog',title:'ABC4588/01 user manual'}]})
    : Response.json({results:[{url:'https://bosch-home.com/support/cog',title:'ABC4588/01 user manual',excerpts:['ABC4588/01 manual. Glass programme.']}]});
  const resolver=createCognitiveApplianceResolver({key:'key',provider:'parallel',fetchImpl:mock});
  const messages=[{role:'user',content:'Bosch dishwasher'},{role:'user',content:'It is Bosch model ABC4588/01'}];
  const found=await resolver({identity:{brand:'Bosch',model:'ABC4588/01',type:'dishwasher'},messages,saved:[]});
  assert.equal(found.record.manual_status,'matched');
  assert.equal(found.record.manual_url,'https://bosch-home.com/support/cog');
  assert.equal(found.record.excerpt,undefined);
  assert.match(found.evidence.excerpt,/Glass programme/);
});
