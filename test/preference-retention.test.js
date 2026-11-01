import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
test('account preference merging retains more than 24 learnings and deduplicates matching records',async()=>{
 const source=await readFile(new URL('../src/synqme.js',import.meta.url),'utf8');
 const start=source.indexOf('function mergePreferences(');
 const end=source.indexOf('\nfunction ',start+1);
 const context=vm.createContext({cleanPreference:(text,item)=>({...item,text,normalised:text.toLowerCase()})});
 vm.runInContext(source.slice(start,end),context);
 const remote=Array.from({length:60},(_,i)=>({text:'Preference '+i,normalised:'preference '+i,status:'user_confirmed'}));
 context.remote=remote;
 const result=vm.runInContext('mergePreferences(remote,[{text:"Preference 5",normalised:"preference 5"},{text:"New preference",normalised:"new preference"}])',context);
 assert.equal(result.length,61);
 assert.ok(result.some(item=>item.text==='Preference 0'));
 assert.ok(result.some(item=>item.text==='Preference 59'));
 assert.ok(result.some(item=>item.text==='New preference'));
});
