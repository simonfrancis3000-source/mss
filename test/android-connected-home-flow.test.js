import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

class Element {
  constructor(tag) {
    this.tagName=tag;this.children=[];this.hidden=false;this.isConnected=false;
    this.textContent='';this.events={};this.attrs={};
    this.classList={add(){},remove(){}};
  }
  append(...nodes){this.children.push(...nodes);for(const node of nodes)if(node&&typeof node==='object')node.isConnected=this.isConnected;}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(key,value){this.attrs[key]=value;}
  addEventListener(event,callback){this.events[event]=callback;}
  focus(){this.focused=true;}
}
const body=new Element('body');body.isConnected=true;
const doc={body,events:{},createElement:t=>new Element(t),addEventListener(name,cb){this.events[name]=cb;},visibilityState:'visible'};
const win={location:{href:'capacitor://localhost'},events:{},addEventListener(name,cb){this.events[name]=cb;},confirm:()=>true};
globalThis.document=doc;globalThis.window=win;
let openedUrl='',returnedStatus='connected';
globalThis.__smartThingsBridge={
  async openAuthorization({url}){openedUrl=url;},
  async consumeRedirect(){return {outcome:returnedStatus};}
};
const source=readFileSync(new URL('../src/connected-home.js',import.meta.url),'utf8')
  .replace('import "./connected-home.css";','')
  .replace('import { Capacitor, registerPlugin } from "@capacitor/core";',
    'const Capacitor={getPlatform:()=> "android"}; const registerPlugin=()=>globalThis.__smartThingsBridge;');
const moduleUrl='data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const {createConnectedHome}=await import(moduleUrl);

test('Android SmartThings panel opens, completes external browser flow and refreshes inventory',async()=>{
  let connected=false,syncs=0,disconnected=0;
  const requests=[];
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    requests.push({url:String(url),method:options.method,client:options.headers?.['X-MSS-Connected-Home-Client']});
    if(String(url).endsWith('/status')) return {ok:true,json:async()=>({
      connected,devices:connected?[{label:'Dishwasher',manufacturer:'Samsung',model:'DW-1',capabilities:['refresh']}]:[],
      syncedAt:connected?'2026-11-05T12:00:00Z':null
    })};
    if(String(url).endsWith('/start')) return {ok:true,json:async()=>({
      authorizationUrl:'https://api.smartthings.com/v1/oauth/authorize?state=abcdef&client_id=example'
    })};
    if(String(url).endsWith('/sync')) {syncs++;return {ok:true,json:async()=>({connected:true})};}
    if(String(url).endsWith('/disconnect')) {connected=false;disconnected++;return {ok:true,json:async()=>({connected:false,devices:[]})};}
    throw Error('unexpected SmartThings endpoint: '+url);
  };
  try {
    const panel=createConnectedHome({
      apiBase:'https://synqme-api.onrender.com',
      getHeaders:async()=>({Authorization:'Bearer test'}),getUserId:()=> 'test-user'
    });
    await panel.open();
    const overlay=body.children.at(-1);
    assert.equal(overlay.hidden,false);
    const dialog=overlay.children[0];
    assert.equal(dialog.children[0].children[1].focused,true);
    const controls=dialog.children[5];
    const [connect,sync,disconnect]=controls.children;
    assert.equal(connect.hidden,false);
    await connect.events.click();
    assert.match(openedUrl,/^https:\/\/api\.smartthings\.com\/v1\/oauth\/authorize/);
    assert.equal(requests.find(r=>r.url.endsWith('/start')).client,'android');
    connected=true;
    win.events.focus();
    await new Promise(resolve=>setTimeout(resolve,15));
    assert.equal(connect.hidden,true);
    assert.equal(sync.hidden,false);
    assert.equal(disconnect.hidden,false);
    assert.equal(dialog.children[4].children[0].children[0].textContent,'Dishwasher');
    await sync.events.click();
    assert.equal(syncs,1);
    await disconnect.events.click();
    assert.equal(disconnected,1);
    assert.equal(connect.hidden,false);
    panel.close();
    assert.equal(overlay.hidden,true);
  } finally {globalThis.fetch=oldFetch;}
});
