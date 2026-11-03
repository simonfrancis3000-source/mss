import test from 'node:test';
import assert from 'node:assert/strict';
import { createRememberedSessionStorage, nativePersistentSessionStorage } from '../src/session-storage.js';
const key='sb-fixture-auth-token';
const memory=()=>{const data=new Map();return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
const preferences=data=>({async get({key}){return {value:data.get(key)??null};},async set({key,value}){data.set(key,value);},async remove({key}){data.delete(key);}});

test('native remembered sessions survive a new app instance and token refresh, and sign-out removes all copies',async()=>{
 const disk=new Map(), legacy=memory();
 const open=()=>createRememberedSessionStorage({persistent:nativePersistentSessionStorage(preferences(disk),legacy),temporary:memory(),getRemember:()=>true});
 await open().setItem(key,'initial-session');
 const restarted=open();assert.equal(await restarted.getItem(key),'initial-session');
 await restarted.setItem(key,'refreshed-session');assert.equal(await open().getItem(key),'refreshed-session');
 await restarted.removeItem(key);assert.equal(await open().getItem(key),null);assert.equal(legacy.getItem(key),null);
});

test('unchecked Remember me removes durable sessions and expires when the app instance ends',async()=>{
 const disk=new Map([[key,'old-session']]),temporary=memory();
 const persistent=nativePersistentSessionStorage(preferences(disk),memory());
 const store=createRememberedSessionStorage({persistent,temporary,getRemember:()=>false});
 await store.setItem(key,'temporary-session');assert.equal(disk.has(key),false);
 assert.equal(await store.getItem(key),'temporary-session');
 const reopened=createRememberedSessionStorage({persistent,temporary:memory(),getRemember:()=>false});
 assert.equal(await reopened.getItem(key),null);
});

test('legacy session migration saves before deleting and failed writes retain the recoverable original',async()=>{
 const legacy=memory();legacy.setItem(key,'legacy-session');const disk=new Map();
 const native=nativePersistentSessionStorage(preferences(disk),legacy);
 assert.equal(await native.getItem(key),'legacy-session');assert.equal(legacy.getItem(key),null);assert.equal(disk.get(key),'legacy-session');
 const temporary=memory();temporary.setItem(key,'recoverable');
 const broken=createRememberedSessionStorage({persistent:{setItem(){throw Error('disk unavailable');}},temporary,getRemember:()=>true});
 await assert.rejects(broken.setItem(key,'replacement'),/disk unavailable/);assert.equal(temporary.getItem(key),'recoverable');
});

test('a pending storage read cannot undo an explicit checkbox selection during login',async()=>{
 let release, remember=false, explicit=false;
 const persistent=memory(), temporary=memory();temporary.setItem(key,'older-session');
 const baseGet=persistent.getItem;persistent.getItem=async k=>{await new Promise(resolve=>release=resolve);return baseGet(k);};
 const store=createRememberedSessionStorage({persistent,temporary,getRemember:()=>remember,onRestore:value=>{if(!explicit)remember=value;}});
 const reading=store.getItem(key);remember=true;explicit=true;release();await reading;
 await store.setItem(key,'new-session');assert.equal(persistent.data.get(key),'new-session');assert.equal(temporary.getItem(key),null);
});


test('an explicit remembered choice promotes a previous temporary session to native storage', async () => {
 const disk=new Map(), transient=memory(), legacy=memory();
 transient.setItem(key,'temporary-login');
 const native=nativePersistentSessionStorage(preferences(disk),legacy);
 const session=createRememberedSessionStorage({
  persistent:native,temporary:transient,getRemember:()=>true,
  hasExplicitChoice:()=>true
 });
 assert.equal(await session.getItem(key),'temporary-login');
 assert.equal(disk.get(key),'temporary-login');
 assert.equal(transient.getItem(key),null);
 const reopened=createRememberedSessionStorage({
  persistent:native,temporary:memory(),getRemember:()=>true,
  hasExplicitChoice:()=>true
 });
 assert.equal(await reopened.getItem(key),'temporary-login');
});

test('an explicit Remember me off never revives a stale persistent token', async () => {
 const disk=new Map([[key,'old-persistent-token']]);
 const session=createRememberedSessionStorage({
  persistent:nativePersistentSessionStorage(preferences(disk),memory()),
  temporary:memory(),getRemember:()=>false,hasExplicitChoice:()=>true
 });
 assert.equal(await session.getItem(key),null);
 assert.equal(disk.get(key),'old-persistent-token');
 await session.setItem(key,'session-only-token');
 assert.equal(disk.has(key),false);
});

test('changing the selection migrates the current token without losing it', async () => {
 const disk=new Map(), transient=memory(), native=nativePersistentSessionStorage(preferences(disk),memory());
 let remember=false;
 const session=createRememberedSessionStorage({
  persistent:native,temporary:transient,getRemember:()=>remember,
  hasExplicitChoice:()=>true
 });
 await session.setItem(key,'signed-in-user');
 remember=true;
 await session.syncChoice();
 assert.equal(disk.get(key),'signed-in-user');
 assert.equal(transient.getItem(key),null);
 remember=false;
 await session.syncChoice();
 assert.equal(transient.getItem(key),'signed-in-user');
 assert.equal(disk.has(key),false);
});

test('restore waits for asynchronous native preference loading', async () => {
 const disk=new Map([[key,'remembered-token']]);
 let release;
 const ready=new Promise(resolve=>{release=resolve;});
 let nativeReady=false;
 const session=createRememberedSessionStorage({
  persistent:nativePersistentSessionStorage(preferences(disk),memory()),
  temporary:memory(),getRemember:()=>nativeReady,
  hasExplicitChoice:()=>nativeReady,beforeRead:()=>ready
 });
 const pending=session.getItem(key);
 nativeReady=true;
 release();
 assert.equal(await pending,'remembered-token');
});

test('login no longer offers browser persona import and uses durable native choice', async () => {
 const { readFile }=await import('node:fs/promises');
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 const js=await readFile(new URL('../src/synqme.js',import.meta.url),'utf8');
 assert.doesNotMatch(html,/authImportDraft|Import this browser.s existing persona/);
 assert.doesNotMatch(js,/elements\.authImportDraft/);
 assert.match(js,/Preferences\.get\(\{ key: REMEMBER_CHOICE_KEY \}\)/);
 assert.match(js,/Preferences\.set\(\{ key: REMEMBER_CHOICE_KEY/);
 assert.match(js,/rememberMeStorage\.syncChoice\(\)/);
});
