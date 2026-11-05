import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {
 obfuscatedPlayAccountId,hashPurchaseToken,verifyGooglePlaySubscriptionState,
 getGooglePlaySubscriptionSnapshot
} from '../server/google-play-billing.js';
import {verifyGooglePubSubPush,parseGooglePlayRtdn} from '../server/google-play-rtdn.js';

const userId='64fd7531-32fd-4043-ae67-c5f62f24d5a2';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const privateKeyPem=privateKey.export({type:'pkcs8',format:'pem'});
const originalAccount=process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
const originalFetch=globalThis.fetch;

function mockPublisher(state,overrides={}){
 const accountId=obfuscatedPlayAccountId(userId);
 let oauthCalls=0,playCalls=0;
 const payload={
   subscriptionState:state,
   acknowledgementState:'ACKNOWLEDGEMENT_STATE_PENDING',
   externalAccountIdentifiers:{obfuscatedExternalAccountId:accountId},
   lineItems:[{productId:'mss_premium',expiryTime:'2026-12-05T12:00:00Z',latestSuccessfulOrderId:'test-order-2026-12'}],
   testPurchase:{},
   ...overrides
 };
 globalThis.fetch=async url=>{
   const text=String(url);
   if(text==='https://oauth2.googleapis.com/token'){
     oauthCalls++;
     return {ok:true,json:async()=>({access_token:'fake-publisher-token',expires_in:3600})};
   }
   if(text.includes('purchases/subscriptionsv2/tokens/')){
     playCalls++;
     return {ok:true,json:async()=>payload};
   }
   throw Error('Unexpected network call');
 };
 return {get oauthCalls(){return oauthCalls},get playCalls(){return playCalls}};
}
test('Play v2 subscription receipts verify the exact signed-in account, state and period',async()=>{
 process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON=JSON.stringify({
   type:'service_account',client_email:'test-billing@example.invalid',
   private_key:privateKeyPem
 });
 const network=mockPublisher('SUBSCRIPTION_STATE_ACTIVE');
 const token='unit-test-play-token-'+randomUUID()+'-long';
 const snapshot=await verifyGooglePlaySubscriptionState({purchaseToken:token,userId});
 assert.equal(snapshot.state,'SUBSCRIPTION_STATE_ACTIVE');
 assert.equal(snapshot.periodEnd,'2026-12-05T12:00:00Z');
 assert.equal(snapshot.accountId,obfuscatedPlayAccountId(userId));
 assert.equal(snapshot.tokenHash,hashPurchaseToken(token));
 assert.equal(snapshot.requiresAcknowledgement,true);
 assert.equal(snapshot.isTest,true);
 assert.equal(network.playCalls,1);
});
test('Play API refuses receipts tied to another MSS account',async()=>{
 mockPublisher('SUBSCRIPTION_STATE_ACTIVE');
 const token='unit-test-play-token-'+randomUUID()+'-long';
 await assert.rejects(
   ()=>verifyGooglePlaySubscriptionState({purchaseToken:token,userId:'11111111-1111-4111-8111-111111111111'}),
   /account mismatch/i
 );
});
test('Play API supports hold and expired states without accidentally issuing new minutes',async()=>{
 mockPublisher('SUBSCRIPTION_STATE_ON_HOLD');
 const token='unit-test-play-token-'+randomUUID()+'-long';
 const held=await getGooglePlaySubscriptionSnapshot(token);
 assert.equal(held.state,'SUBSCRIPTION_STATE_ON_HOLD');
 assert.equal(held.periodEnd,'2026-12-05T12:00:00Z');
});
test('Google Pub/Sub notification requires a valid signed OIDC identity',async()=>{
 const now=Date.now();const claims={
  iss:'https://accounts.google.com', aud:'https://synqme-api.onrender.com/api/google-play/rtdn',
  email:'play-push@example.invalid',email_verified:true,sub:'service-1234',
  iat:Math.floor(now/1000),exp:Math.floor(now/1000)+1800
 };
 const jwk=publicKey.export({format:'jwk'});
 const header={alg:'RS256',kid:'test-kid',typ:'JWT'};
 const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const signed=b64(header)+'.'+b64(claims);
 const jwt=signed+'.'+sign('RSA-SHA256',Buffer.from(signed),privateKey).toString('base64url');
 const result=await verifyGooglePubSubPush('Bearer '+jwt,{
   audience:claims.aud,serviceAccountEmail:claims.email,now,
   fetchImpl:async()=>({ok:true,json:async()=>({keys:[{...jwk,kid:'test-kid',use:'sig'}]})})
 });
 assert.equal(result.email,claims.email);
 await assert.rejects(
  ()=>verifyGooglePubSubPush('Bearer '+jwt,{audience:'https://wrong.example',serviceAccountEmail:claims.email,now}),
  /invalid_pubsub_claims/
 );
});
test('Google Play RTDN notification body is not treated as entitlement proof',()=>{
 const token='unit-test-token-not-real-'+randomUUID()+'-sufficient';
 const body={message:{data:Buffer.from(JSON.stringify({
    packageName:'app.mysecondself',eventTimeMillis:String(Date.now()),
    subscriptionNotification:{version:'1.0',notificationType:2,purchaseToken:token}
 })).toString('base64')}};
 const result=parseGooglePlayRtdn(body);
 assert.equal(result.purchaseToken,token);
 assert.equal(result.notificationType,2);
 const wrong={message:{data:Buffer.from(JSON.stringify({packageName:'evil.app',
  subscriptionNotification:{purchaseToken:token}})).toString('base64')}};
 assert.throws(()=>parseGooglePlayRtdn(wrong),/wrong_rtdn_package/);
});
test.after(()=>{
 globalThis.fetch=originalFetch;
 if(originalAccount===undefined)delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
 else process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON=originalAccount;
});
