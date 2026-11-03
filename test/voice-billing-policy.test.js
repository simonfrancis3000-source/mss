import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldMeterVoice} from '../server/voice-billing-policy.js';
test('metering opt-in never expands account eligibility or breaks older clients',()=>{
 for(const client of ['android-1.7','web-profile-balance-v1']){
  assert.equal(shouldMeterVoice({accountEligible:true,client}),true);
  assert.equal(shouldMeterVoice({accountEligible:false,client}),false);
 }
 for(const client of ['', 'old-app', 'web-profile-balance-v1-fake'])assert.equal(shouldMeterVoice({accountEligible:true,client}),false);
 assert.equal(shouldMeterVoice({globallyEnabled:true,client:''}),true);
});
