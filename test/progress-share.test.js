import test from 'node:test';
import assert from 'node:assert/strict';
import { progressOwnerLabel, progressShareMessage, MYSECONDSELF_URL, shareProgressImage } from '../src/progress-share.js';
import { scenarioProgressSummary, SCENARIOS } from '../src/scenario-journey.js';
test('progress and journey use the owner first name with safe unnamed fallback',()=>{
 assert.equal(progressOwnerLabel('  Simon Francis  ','progress'),"Simon's progress");
 assert.equal(progressOwnerLabel('Freddie','journey'),"Freddie's journey");
 assert.equal(progressOwnerLabel('','progress'),'Your progress');
});
test('share image source counts include all four categories and use confirmed completion',()=>{
 const summary=scenarioProgressSummary(SCENARIOS.map(item=>item.id));
 assert.equal(summary.percent,100);assert.equal(summary.groups.length,4);
 assert.equal(summary.groups.reduce((total,item)=>total+item.completed,0),26);
 assert.equal(scenarioProgressSummary([]).percent,0);
});
test('sharing includes the promotional message and a website link alongside the progress image',async(t)=>{
 const originals = new Map();
 const install = (key,value) => { originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key)); Object.defineProperty(globalThis,key,{value,configurable:true,writable:true}); };
 t.after(()=>{for(const [key,descriptor] of originals) descriptor ? Object.defineProperty(globalThis,key,descriptor) : delete globalThis[key];});
 const rendered=[], ctx={fillRect(){},fillText(value){rendered.push(value);},save(){},restore(){},beginPath(){},arc(){},fill(){},stroke(){},roundRect(){},createLinearGradient(){return {addColorStop(){}};}};
 const canvas={getContext:()=>ctx,toBlob:callback=>callback(new Blob(['image'],{type:'image/png'}))};
 let shared;
 install('document',{createElement:type=>{assert.equal(type,'canvas');return canvas;}});
 install('navigator',{canShare:()=>true,share:async payload=>{shared=payload;}});
 const progress=scenarioProgressSummary([]);
 assert.equal(await shareProgressImage(progress,'Simon Francis'),'shared');
 assert.equal(shared.url,MYSECONDSELF_URL);
 assert.equal(shared.text,'Simon is preparing for the arrival of their domestic humanoid robot. Are you? Learn more at MySecondSelf.');
 assert.equal(shared.files[0].type,'image/png');
 assert.ok(rendered.includes('Simon is preparing for the arrival of their'));
 assert.ok(rendered.includes('mysecondself.app'));
 assert.ok(rendered.includes("Simon's progress"));
 assert.match(progressShareMessage(''),/^Someone is preparing/);
});
