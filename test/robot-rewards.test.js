import test from 'node:test';
import assert from 'node:assert/strict';
import { paidUsdCents, normalizeGoogleRewardOrder, summarizeRobotRewardOrders, loadRobotRewards } from '../server/robot-rewards.js';

function order(id, cents, date='2026-11-03T12:00:00Z', state='PROCESSED') {
  return {orderId:id,state,createTime:date,lineItems:[{productId:'mss_premium',total:{currencyCode:'USD',units:String(Math.floor(cents/100)),nanos:(cents%100)*10000000}}]};
}
test('actual USD paid price gives 2x credit, not assumed subscription price',()=>{
  const actual=normalizeGoogleRewardOrder(order('GPA.111',999),'mss_premium');
  assert.equal(actual.paid_usd_cents,999);
  assert.equal(summarizeRobotRewardOrders([actual]).earnedCents,1998);
  assert.equal(paidUsdCents({currencyCode:'USD',units:'18',nanos:990000000}),1899);
});
test('monthly credit cannot exceed $100 and lifetime cannot exceed $1000',()=>{
  const sameMonth=Array.from({length:20},(_,i)=>({ ...normalizeGoogleRewardOrder(order('GPA.'+i,999),'mss_premium'),order_id:'GPA.'+i}));
  assert.equal(summarizeRobotRewardOrders(sameMonth).earnedCents,10000);
  const manyMonths=Array.from({length:15},(_,i)=>({ ...normalizeGoogleRewardOrder(order('GPA.month'+i,9900,new Date(Date.UTC(2026+i,0,3)).toISOString()),'mss_premium'),order_id:'GPA.month'+i}));
  assert.equal(summarizeRobotRewardOrders(manyMonths).earnedCents,100000);
});
test('refunded, testing, non-dollar, zero-price and mismatched purchases do not earn',()=>{
  const refunded=normalizeGoogleRewardOrder(order('GPA.refund',999,'2026-11-03T12:00:00Z','REFUNDED'),'mss_premium');
  assert.equal(refunded.status,'refunded');
  assert.equal(summarizeRobotRewardOrders([refunded]).earnedCents,0);
  const free=normalizeGoogleRewardOrder(order('GPA.free',0),'mss_premium');
  assert.equal(free.status,'excluded');
  const eur=order('GPA.eur',999);eur.lineItems[0].total.currencyCode='EUR';
  assert.equal(normalizeGoogleRewardOrder(eur,'mss_premium').status,'pending_currency');
  const testOrder=order('GPA.test',999);testOrder.testPurchase={};
  assert.equal(normalizeGoogleRewardOrder(testOrder,'mss_premium').status,'test');
  assert.throws(()=>normalizeGoogleRewardOrder(order('GPA.wrong',999),'mss_voice_300'),/does not match/);
});
test('an account with test minutes but no actual purchase grants has zero rewards',async()=>{
  const db={from(table){
    assert.equal(table,'mss_voice_credit_grants');
    return {select(){return this},eq(){return this},order(){return this},async limit(){return {data:[],error:null}}};
  }};
  const state=await loadRobotRewards({db,userId:'aws1-user-id',getOrder:()=>{throw Error('should not be called')}});
  assert.equal(state.status,'ready');assert.equal(state.earnedCents,0);assert.equal(state.pendingOrders,0);
});
