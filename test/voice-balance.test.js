import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceBalanceModel,createVoiceBalance} from '../src/voice-balance.js';
const now=Date.parse('2026-11-03T10:00:00Z');
const wallet={premiumActive:true,monthlyRemainingMs:2700000,topupRemainingMs:1200000,monthlyValidUntil:'2026-12-03T10:00:00Z'};
test('subscription and purchased minutes stay separate with accurate remaining progress',()=>{
 const v=voiceBalanceModel(wallet,now);assert.equal(v.total,'65 min');assert.equal(v.monthlyLabel,'45 min');assert.equal(v.topupLabel,'20 min');assert.equal(v.remainingPercent,75);assert.equal(v.periodEnd,wallet.monthlyValidUntil.replace('Z','.000Z'));
 const expired=voiceBalanceModel(wallet,now+40*86400000);assert.equal(expired.monthly,0);assert.equal(expired.total,'20 min');assert.equal(expired.periodEnd,null);
 assert.equal(voiceBalanceModel({...wallet,topupRemainingMs:1000,monthlyRemainingMs:0},now).total,'Less than 1 min');
 assert.equal(voiceBalanceModel(null,now).total,'0 min');
});
test('fetch uses authenticated status endpoint once, without background polling',async()=>{
 let calls=0;const c=createVoiceBalance({apiBase:'https://example.test',getUserId:()=> 'a',getHeaders:async()=>({Authorization:'Bearer test'}),onChange(){},fetcher:async(url,options)=>{calls++;assert.equal(url,'https://example.test/api/billing/status');assert.equal(options.headers.Authorization,'Bearer test');return {ok:true,json:async()=>wallet};}});
 await c.refresh();assert.equal(calls,1);assert.equal(c.snapshot().status,'ready');assert.deepEqual(c.snapshot().wallet,wallet);
});
test('failure shows unavailable instead of zero and switching account hides prior balance',async()=>{
 let owner='a';let fail=false;const c=createVoiceBalance({apiBase:'',getUserId:()=>owner,getHeaders:async()=>({}),onChange(){},fetcher:async()=>({ok:!fail,json:async()=>wallet})});
 await c.refresh();owner='b';assert.equal(c.snapshot().wallet,null);fail=true;await c.refresh();assert.equal(c.snapshot().status,'error');assert.equal(c.snapshot().wallet,null);
});
test('an old account response cannot replace a different account balance',async()=>{
 let owner='a',release;const c=createVoiceBalance({apiBase:'',getUserId:()=>owner,getHeaders:async()=>({}),onChange(){},fetcher:()=>new Promise(resolve=>{release=resolve;})});
 const loading=c.refresh();await Promise.resolve();owner='b';release({ok:true,json:async()=>wallet});await loading;assert.equal(c.snapshot().wallet,null);
});
