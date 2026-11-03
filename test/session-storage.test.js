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
