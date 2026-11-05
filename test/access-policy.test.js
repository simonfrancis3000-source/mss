import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMssEntitlement, createMssAccessPolicy } from '../server/access-policy.js';

const now = Date.parse('2026-11-05T12:00:00Z');
const settings = {
  enforcement_enabled:true,
  premium_limit_usd:0.50,
  free_trial_limit_usd:0.10
};
const premium = { status:'active',valid_until:'2026-12-05T12:00:00Z' };
const expired = { status:'expired',valid_until:'2026-11-01T12:00:00Z' };
const grant = ({ usedUsd=0,limitUsd=0.50,bonusUsd=0 }={}) =>
  ({usedUsd,limitUsd,bonusUsd,remainingUsd:Math.max(0,limitUsd-usedUsd)});

function entitlement(ent,used=0,allowance,enabled=true) {
  return evaluateMssEntitlement({
    settings,entitlement:ent,usage:{used_usd:used},
    premiumAllowance:allowance,enabledByServer:enabled,now
  });
}

test('one-time $0.10 free trial has Chat but no Talk access',()=>{
  const state=entitlement(null,0.08);
  assert.equal(state.mode,'trial');
  assert.equal(state.canChat,true);
  assert.equal(state.canTalk,false);
  assert.ok(Math.abs(state.trialRemainingUsd-0.02)<1e-9);
});

test('free chat ends at $0.10 without renewal on next calendar month',()=>{
  const state=entitlement(null,0.10);
  assert.equal(state.mode,'free_trial_exhausted');
  assert.equal(state.canChat,false);
  assert.equal(state.canTalk,false);
});

test('Premium $0.50 limit permits Chat and Talk until exhausted',()=>{
  const state=entitlement(premium,0,grant({usedUsd:0.49999}));
  assert.equal(state.mode,'premium');
  assert.equal(state.canChat,true);
  assert.equal(state.canTalk,true);
  assert.equal(state.premiumLimitUsd,0.50);
});

test('Premium hard stop at $0.50 pauses both Chat and Talk',()=>{
  const state=entitlement(premium,0,grant({usedUsd:0.50}));
  assert.equal(state.mode,'premium_chat_exhausted');
  assert.equal(state.premiumHardStop,true);
  assert.equal(state.canChat,false);
  assert.equal(state.canTalk,false);
});

test('a verified minute pack raises Premium allowance by $0.50',()=>{
  const state=entitlement(premium,0,grant({usedUsd:0.50,limitUsd:1,bonusUsd:0.50}));
  assert.equal(state.mode,'premium');
  assert.equal(state.canChat,true);
  assert.equal(state.canTalk,true);
  assert.equal(state.premiumLimitUsd,1);
  assert.equal(state.premiumBonusUsd,0.5);
});

test('purchase of two verified packs supports additional $1 in chat allowance',()=>{
  const state=entitlement(premium,0,grant({usedUsd:1.2,limitUsd:1.5,bonusUsd:1}));
  assert.ok(Math.abs(state.premiumRemainingUsd-0.3)<1e-9);
  assert.equal(state.canChat,true);
});

test('canceled paid subscription retains access until the actual paid period ends',()=>{
  const state=entitlement({...premium,status:'canceled'},0,grant({usedUsd:0.1}));
  assert.equal(state.premiumActive,true);
  assert.equal(state.canChat,true);
});

test('grace-period subscription retains eligibility until validUntil',()=>{
  const state=entitlement({...premium,status:'grace'},0,grant({usedUsd:0.2}));
  assert.equal(state.premiumActive,true);
});

test('expired Premium account cannot fall back to original one-time trial',()=>{
  const state=entitlement(expired,0);
  assert.equal(state.mode,'subscription_required');
  assert.equal(state.canChat,false);
  assert.equal(state.canTalk,false);
});

test('disabled enforcement preserves existing users during the staged rollout',()=>{
  const state=entitlement(null,0.10,null,false);
  assert.equal(state.mode,'legacy');
  assert.equal(state.canChat,true);
  assert.equal(state.canTalk,true);
});

test('verified top-up must be a current-period grant and stays idempotent',async()=>{
  const inserts=[];
  const currentPeriod='2026-11-05T00:00:00.000Z';
  const db={
    from(table){
      return {
        select(){
          const q={
            eq(){return q;},
            order(){return q;},
            async maybeSingle(){
              if(table==='mss_subscription_entitlements')return {data:{
                status:'active',valid_until:'2026-12-05T00:00:00Z',
                period_start:currentPeriod
              },error:null};
              return {data:null,error:null};
            },
            async limit(){
              return {data:table==='mss_voice_credit_grants'?[
                {user_id:'user-1',created_at:'2026-11-05T11:00:00Z',product_id:'mss_voice_60'}
              ]:[],error:null};
            }
          };
          return q;
        },
        async upsert(row,options){
          inserts.push({table,row,options});
          return {error:null};
        }
      };
    }
  };
  const policy=createMssAccessPolicy({db,enforcementEnabled:true});
  const purchase={kind:'topup',tokenHash:'a'.repeat(64),productId:'mss_voice_60'};
  assert.deepEqual(await policy.recordVerifiedTopup('user-1',purchase),{granted:true,bonusUsd:0.5});
  assert.equal(inserts.length,1);
  assert.equal(inserts[0].table,'mss_chat_bonus_grants');
  assert.equal(inserts[0].row.bonus_usd,0.5);
  assert.equal(inserts[0].options.ignoreDuplicates,true);
});
