import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

class Element {
  constructor(tag) {
    this.tagName=tag;this.children=[];this.events={};this.attributes={};
    this.textContent='';this.open=false;this.disabled=false;this.hidden=false;
    this.className='';this.type='';
  }
  append(...nodes){this.children.push(...nodes);}
  prepend(...nodes){this.children.unshift(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  addEventListener(kind,fn){this.events[kind]=fn;}
  setAttribute(k,v){this.attributes[k]=v;}
  showModal(){this.open=true;}
  close(){this.open=false;}
  querySelectorAll(selector){
    const results=[];
    const visit=x=>{
      if(x.tagName===selector)results.push(x);
      for(const c of x.children)if(c instanceof Element)visit(c);
    };
    visit(this);return results;
  }
}
const body=new Element('body');
const win={events:{},addEventListener(name,callback){this.events[name]=callback;}};
const doc={
  body,visibilityState:'visible',events:{},
  createElement:tag=>new Element(tag),
  addEventListener(name,callback){this.events[name]=callback;}
};
globalThis.document=doc;globalThis.window=win;

const native={
  subscriptionQueryCalls:0,topupQueryCalls:0,
  subscriptionPurchases:[],topupPurchases:[],
  async getExistingPurchases(){
    this.subscriptionQueryCalls++;
    return {purchases:this.subscriptionPurchases};
  },
  async getExistingVoiceTopUpPurchases(){
    this.topupQueryCalls++;
    return {purchases:this.topupPurchases};
  },
  async getSubscriptionOffers(){return {offers:[]};},
  async getVoiceTopUpOffers(){return {offers:[]};},
  async startSubscriptionPurchase(){return {};},
  async startVoiceTopUpPurchase(){return {};},
  async addListener(){return {remove(){}};}
};
globalThis.__mssTestBillingNative=native;
const source=readFileSync(new URL('../src/google-play-checkout.js',import.meta.url),'utf8')
 .replace(/^import \{ isGooglePlayBillingSupported, MSSBilling, MSS_PLAY_TOPUP_PRODUCTS \} from "\.\/google-play-billing\.js";/u,
   'const isGooglePlayBillingSupported=()=>true; const MSSBilling=globalThis.__mssTestBillingNative; const MSS_PLAY_TOPUP_PRODUCTS=[];')
 .replace('import.meta.env.VITE_PLAY_BILLING_ENABLED','"true"');
const {createGooglePlayCheckout}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const purchase=(id,token)=>({
 purchaseState:1,products:[id],purchaseToken:token
});

test('Android restores and verifies paid Premium on sign-in using the authenticated backend',async()=>{
 const sent=[];
 const previousFetch=globalThis.fetch;
 native.subscriptionPurchases=[purchase('mss_premium','sub-test-strong-token-12345678')];
 native.topupPurchases=[];
 globalThis.fetch=async(url,options={})=>{
   const path=String(url);
   if(path.endsWith('/health')) return {ok:true,json:async()=>({paidVoiceEnabled:true})};
   if(path.endsWith('/api/billing/status')) return {ok:true,json:async()=>({
      billingEnabledForUser:true,premiumActive:true,
      monthlyRemainingMs:3600000,topupRemainingMs:3600000,
      monthlyValidUntil:'2026-12-05T00:00:00Z'
   })};
   if(path.endsWith('/api/billing/verify')){
     assert.equal(options.headers.Authorization,'Bearer signed-qa-token');
     const body=JSON.parse(options.body);
     sent.push(body);
     return {ok:true,json:async()=>({
       verified:true,productId:body.productId,minutes:60,
       newlyCredited:false,finalizationPending:false,subscriptionActive:true
     })};
   }
   throw Error('unexpected network URL: '+path);
 };
 try {
   const checkout=createGooglePlayCheckout({
      apiBase:'https://synqme-api.onrender.com',
      getHeaders:async()=>({Authorization:'Bearer signed-qa-token'}),
      getUserId:()=> '64fd7531-32fd-4043-ae67-c5f62f24d5a2'
   });
   assert.equal(checkout.enabled,true);
   const success=await checkout.syncOnSignIn();
   assert.equal(success,true);
   assert.equal(sent.length,1);
   assert.equal(sent[0].productId,'mss_premium');
   assert.equal(sent[0].purchaseToken,'sub-test-strong-token-12345678');
   checkout.close();
 } finally {globalThis.fetch=previousFetch;}
});

test('Android never considers expired Premium receipt an active restored purchase',async()=>{
 const sent=[];
 const previousFetch=globalThis.fetch;
 native.subscriptionPurchases=[purchase('mss_premium','expired-token-123456789012345')];
 globalThis.fetch=async(url,options={})=>{
   const path=String(url);
   if(path.endsWith('/api/billing/status')) return {ok:true,json:async()=>({
      billingEnabledForUser:true,premiumActive:false,
      monthlyRemainingMs:0,topupRemainingMs:3600000
   })};
   if(path.endsWith('/api/billing/verify')){
      sent.push(JSON.parse(options.body));
      return {ok:true,json:async()=>({
        verified:true,subscriptionActive:false,productId:'mss_premium',
        newlyCredited:false,minutes:0,finalizationPending:false
      })};
   }
   throw Error('unexpected request '+path);
 };
 try {
   const checkout=createGooglePlayCheckout({
     apiBase:'https://synqme-api.onrender.com',
     getHeaders:async()=>({Authorization:'Bearer signed-qa-token'}),
     getUserId:()=> '64fd7531-32fd-4043-ae67-c5f62f24d5a2'
   });
   const restored=await checkout.restorePurchases();
   assert.equal(restored,0,'inactive receipts do not restore Premium');
   assert.equal(sent.length,1,'inactive receipt still reconciles with server');
   checkout.close();
 } finally {globalThis.fetch=previousFetch;}
});

test('Android re-verifies purchase status after returning from the Play app',async()=>{
 const previousFetch=globalThis.fetch;
 let verified=0;
 native.subscriptionPurchases=[purchase('mss_premium','new-period-verified-1234567890')];
 globalThis.fetch=async(url)=>{
   const path=String(url);
   if(path.endsWith('/health'))return {ok:true,json:async()=>({paidVoiceEnabled:true})};
   if(path.endsWith('/api/billing/status'))return {ok:true,json:async()=>({
     billingEnabledForUser:true,premiumActive:true,
     monthlyRemainingMs:200000,topupRemainingMs:0
   })};
   if(path.endsWith('/api/billing/verify')){
     verified++;
     return {ok:true,json:async()=>({verified:true,newlyCredited:false,minutes:60,finalizationPending:false})};
   }
   throw Error('unexpected request '+path);
 };
 try {
   const checkout=createGooglePlayCheckout({
     apiBase:'https://synqme-api.onrender.com',
     getHeaders:async()=>({Authorization:'Bearer signed-qa-token'}),
     getUserId:()=> '64fd7531-32fd-4043-ae67-c5f62f24d5a2'
   });
   assert.equal(typeof win.events.focus,'function');
   win.events.focus();
   await new Promise(resolve=>setTimeout(resolve,25));
   assert.equal(verified,1);
   win.events.focus();
   await new Promise(resolve=>setTimeout(resolve,25));
   assert.equal(verified,1,'foreground reconciliation is throttled');
   checkout.close();
 } finally{globalThis.fetch=previousFetch;}
});
