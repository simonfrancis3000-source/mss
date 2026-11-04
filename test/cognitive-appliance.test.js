import test from 'node:test';import assert from 'node:assert/strict';
import { createCognitiveApplianceResolver,verifiedFeatureQuotes,applianceMemoryProposal } from '../server/cognitive-appliance.js';
test('runtime appliance lookup verifies official exact-model content and stores only identity/link metadata',async()=>{
 const calls=[];const resolver=createCognitiveApplianceResolver({key:'fixture',fetchImpl:async(url,options)=>{
  calls.push(JSON.parse(options.body));return url.endsWith('/search')?Response.json({results:[{url:'https://bosch-home.com/manual',title:'User manual'}]}):Response.json({title:'User manual',content:'Model ABC1234/01 manual. The delicate programme protects glasses. The timer can delay the start.'});
 }});
 const messages=[{role:'user',content:'My dishwasher is Bosch.'},{role:'user',content:'The exact model is ABC1234/01.'}];
 const found=await resolver({identity:{type:'dishwasher',brand:'Bosch',model:'ABC1234/01'},messages,saved:[]});
 assert.equal(found.record.manual_status,'matched');assert.equal(found.record.manual_url,'https://bosch-home.com/manual');assert.equal(found.record.excerpt,undefined);
 assert.deepEqual(verifiedFeatureQuotes(['The delicate programme protects glasses.','Wi-Fi is included.'],found.evidence),['The delicate programme protects glasses.']);
 assert.equal(applianceMemoryProposal(found.record,messages.at(-1).content).attributes.appliance_v1.excerpt,undefined);
 assert.equal(await resolver({identity:{type:'dishwasher',brand:'Bosch',model:'ABC9999'},messages,saved:[]}),null);
 assert.equal(calls.length,2);
});
