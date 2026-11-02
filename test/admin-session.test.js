import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createAuthTurnstile} from '../src/auth-turnstile.js';

async function harness(fetchImpl) {
  const nodes=new Map();
  const element=(id)=>{
    if(!nodes.has(id))nodes.set(id,{hidden:id==='dashboard',value:'30d',textContent:'',innerHTML:'',dataset:{},selectedOptions:[{textContent:'Last 30 days'}],addEventListener(){},querySelector(){return null;}});
    return nodes.get(id);
  };
  const session={access_token:'fixture-token',user:{id:'fixture-admin'}};
  const client={auth:{getSession:async()=>({data:{session}}),onAuthStateChange(){},signOut:async()=>{}}};
  const source=(await readFile(new URL('../src/admin.js',import.meta.url),'utf8'))
    .replace('import { createClient } from "@supabase/supabase-js";','')
    .replace('import { createAuthTurnstile } from "./auth-turnstile.js";','')
    .replaceAll('import.meta.env','env');
  const context=vm.createContext({Intl,Date,Number,Set,Map,URL,Blob,console,
    env:{VITE_SUPABASE_URL:'https://fixture.test',VITE_SUPABASE_ANON_KEY:'public-key'},createClient:()=>client,createAuthTurnstile,
    document:{getElementById:element},window:{setTimeout(){}},fetch:fetchImpl});
  vm.runInContext(source+'\n;globalThis.harness={loadDashboard,showLogin,showDashboard,getData:()=>currentData,setSession:(s)=>{currentSession=s}};',context);
  // Let the initial getSession-driven request settle.
  await new Promise(setImmediate);
  return {api:context.harness,element,session};
}
test('administrator dashboard remains hidden until its data request is authorised',async()=>{
  const {element,api}=await harness(async()=>new Response(JSON.stringify({error:'This account is not authorised to view SYNQ.ME administration.'}),{status:403}));
  assert.equal(element('dashboard').hidden,true);
  assert.equal(api.getData(),null);
  assert.match(element('loginNotice').textContent,/not authorised/);
});
test('a delayed admin request cannot restore data after sign-out',async()=>{
  let resolvePending;
  let requests=0;
  const {element,api}=await harness(async()=>{
    requests++;
    if(requests===1)return new Response(JSON.stringify({totals:{registeredUsers:4},users:[{userId:'private-user',email:'private@example.invalid'}]}));
    return new Promise(resolve=>{resolvePending=resolve;});
  });
  assert.equal(element('dashboard').hidden,false);
  const refreshing=api.loadDashboard();
  await new Promise(setImmediate);
  api.setSession(null);
  api.showLogin('Signed out.');
  resolvePending(new Response(JSON.stringify({totals:{registeredUsers:999},users:[{email:'old@example.invalid'}]})));
  await refreshing;
  assert.equal(element('dashboard').hidden,true);
  assert.equal(api.getData(),null);
  assert.equal(element('registeredUsers').textContent,'0');
  assert.doesNotMatch(element('userTableBody').innerHTML,/private@example|old@example/);
});
