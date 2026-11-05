import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { evaluateMssEntitlement,createMssAccessPolicy } from '../server/access-policy.js';

const now=Date.parse('2026-11-05T16:00:00Z');
const settings={
 enforcement_enabled:false,free_trial_enforcement_enabled:true,
 free_trial_limit_usd:0.10,premium_limit_usd:0.50
};
const active={provider:'google_play',status:'active',valid_until:'2026-12-05T00:00:00Z'};
const beta={provider:'beta',status:'test',valid_until:'2027-04-05T00:00:00Z'};
const oldPaid={provider:'google_play',status:'expired',valid_until:'2026-10-05T00:00:00Z'};
const allowance={usedUsd:0.62,limitUsd:0.50};

function assess(entitlement,used=0,opts={}){
 return evaluateMssEntitlement({
   settings:{...settings,...opts},entitlement,
   usage:{used_usd:used},premiumAllowance:allowance,now,enabledByServer:false
 });
}
test('independent $0.10 free Chat: new users can Chat, not Talk',()=>{
 const free=assess(null,0);
 assert.equal(free.mode,'trial');
 assert.equal(free.enforcementEnabled,true);
 assert.equal(free.premiumEnforcementEnabled,false);
 assert.equal(free.freeTrialEnforcementEnabled,true);
 assert.equal(free.canChat,true);
 assert.equal(free.canTalk,false);
 assert.equal(free.trialLimitUsd,0.10);
});
test('independent free Chat stops at $0.10 and cannot reset by login',()=>{
 for(const spent of [0.10,0.20]){
  const free=assess(null,spent);
  assert.equal(free.mode,'free_trial_exhausted');
  assert.equal(free.canChat,false);
  assert.equal(free.canTalk,false);
  assert.equal(free.trialRemainingUsd,0);
 }
});
test('existing active, beta and expired Premium users remain in legacy mode even if past $0.50',()=>{
 for (const account of [active,beta,oldPaid]){
  const state=assess(account,0.12);
  assert.equal(state.enforcementEnabled,false);
  assert.equal(state.mode,'legacy');
  assert.equal(state.canChat,true);
  assert.equal(state.canTalk,true);
  assert.equal(state.premiumHardStop,false);
 }
});
test('both enforcement flags off leaves free and paying users unchanged',()=>{
 for(const account of [null,active,beta,oldPaid]){
  const state=assess(account,1,{free_trial_enforcement_enabled:false});
  assert.equal(state.mode,'legacy');
  assert.equal(state.canChat,true);
  assert.equal(state.canTalk,true);
 }
});
test('future Premium enforcement still requires paid status and existing $0.50 cap',()=>{
 const options={enforcement_enabled:true,free_trial_enforcement_enabled:false};
 const free=assess(null,0,options);
 assert.equal(free.mode,'trial');
 assert.equal(free.canTalk,false);
 const paid=assess(active,0,options);
 assert.equal(paid.mode,'premium_chat_exhausted');
 assert.equal(paid.premiumHardStop,true);
 assert.equal(paid.canChat,false);
});

function simulatedDb() {
 const ids={free:randomUUID(),paid:randomUUID()};
 const events=[];
 const db={
  from(table){
   const q={
    select(){return q;},
    eq(field,value){q.id=value;return q;},
    async single(){
      assert.equal(table,'mss_access_settings');
      return {data:settings,error:null};
    },
    async maybeSingle(){
      if(table==='mss_subscription_entitlements')return {
         data:q.id===ids.paid?{...active,period_start:'2026-11-05T00:00:00Z'}:null,error:null
      };
      if(table==='mss_free_chat_usage')return {data:{used_usd:0},error:null};
      return {data:null,error:null};
    },
    async upsert(){return {error:null};}
   };
   return q;
  },
  async rpc(op,args){
   events.push({op,args});
   if(op==='mss_get_chat_allowance')return {data:allowance,error:null};
   if(op==='mss_reserve_chat_request')return {data:{allowed:true,mode:'trial'},error:null};
   if(op==='mss_record_chat_cost')return {data:{recorded:true},error:null};
   if(op==='mss_release_chat_request')return {data:{released:true},error:null};
   throw Error('Unexpected RPC: '+op);
  }
 };
 return {db,ids,events};
}
test('only free users reserve and meter DeepSeek calls when Premium control is OFF',async()=>{
 const {db,ids,events}=simulatedDb();
 const policy=createMssAccessPolicy({db,enforcementEnabled:false});
 const free={id:ids.free,email:'free@example.invalid'};
 const paid={id:ids.paid,email:'premium@example.invalid'};
 const slot=await policy.reserve(free,'chat');
 assert.equal(slot.mode,'trial');
 assert.equal(slot.userId,free.id);
 await policy.recordCost(slot,'chat',0.00125,randomUUID());
 assert.equal(events.filter(x=>x.op==='mss_record_chat_cost').length,1);
 assert.equal(await policy.reserve(paid,'chat'),null);
 assert.equal(events.filter(x=>x.op==='mss_reserve_chat_request').length,1);
 await assert.rejects(policy.requireVoice(free),e=>e.statusCode===402&&e.code==='premium_required_for_feature');
 const paidVoice=await policy.requireVoice(paid);
 assert.equal(paidVoice.mode,'legacy');
 assert.equal(paidVoice.canTalk,true);
});
