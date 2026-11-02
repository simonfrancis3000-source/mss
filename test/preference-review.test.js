import test from 'node:test';
import assert from 'node:assert/strict';
import { isUsefulStandalonePreference,cleanPersonaMemoryCandidate } from '../src/persona-memory.js';
import { isReviewableFragment,findPreferenceSource,collectReviewableFragments,preferenceDisplayLabel,preferenceIdentity } from '../src/preference-review.js';

const conversation=[{role:'assistant',content:'What should I do with the cushions?',scenario_id:'room:living_room',timestamp:'2026-01-01T12:00:00Z'},{role:'user',content:'Pick them up',scenario_id:'room:living_room',timestamp:'2026-01-01T12:00:01Z'}];
test('ambiguous fragments are excluded from preferences but made available for review',()=>{
 for(const text of ['Pick them up','All three',"Tell me what you’re unsure of",'I want them cleaned']) {assert.equal(isUsefulStandalonePreference(text),false,text);assert.equal(isReviewableFragment(text),true,text);assert.equal(cleanPersonaMemoryCandidate({statement:text}),null,text);}
 assert.equal(isReviewableFragment('We already covered that'),false);
 assert.equal(isUsefulStandalonePreference('Pick up cushions from the floor after guests leave.'),true);
});
test('source context is used only when the user answer has an unambiguous match',()=>{
 assert.equal(findPreferenceSource({text:'Pick them up'},conversation).question,conversation[0].content);
 const duplicate=[...conversation,{role:'assistant',content:'And the books?',scenario_id:'room:living_room'},{role:'user',content:'Pick them up',scenario_id:'room:living_room',timestamp:'2026-01-01T13:00:00Z'}];
 assert.equal(findPreferenceSource({text:'Pick them up'},duplicate),null);
 assert.equal(findPreferenceSource({text:'Pick them up',source_timestamp:'2026-01-01T13:00:00Z'},duplicate).question,'And the books?');
 assert.equal(findPreferenceSource({text:'Pick them up'},[{role:'assistant',content:'What is your password?'},conversation[1]]),null);
});
test('linked legacy records do not duplicate a reviewed memory',()=>{
 const memory={id:'m',statement:'Pick them up',status:'user_stated',source_preference_id:'p'};
 const preference={id:'p',text:'Pick them up'};
 const result=collectReviewableFragments([memory],[preference],conversation);
 assert.equal(result.length,1);assert.equal(result[0].kind,'memory');
 assert.equal(collectReviewableFragments([{...memory,statement:'Pick up cushions after guests leave.'}],[preference],conversation).length,0);
});
test('labels use only linked scenario and area, and duplicates preserve distinct conditions',()=>{
 const scenarios=[{id:'room:living_room',title:'Living Room'}];const getTasks=()=>[{id:'guests',title:'Guests'}];
 assert.equal(preferenceDisplayLabel({topic:'guests',attributes:{scenario_id:'room:living_room',area_id:'guests'}},scenarios,getTasks),'Living Room · Guests');
 assert.equal(preferenceDisplayLabel({topic:'guests'},scenarios,getTasks),'Scenario not linked · guests');
 assert.equal(preferenceIdentity('Leave books.',[]),preferenceIdentity('leave books',[]));
 assert.notEqual(preferenceIdentity('Leave books',['when guests visit']),preferenceIdentity('Leave books',['when alone']));
 assert.notEqual(preferenceIdentity('Leave books',[],'prohibited'),preferenceIdentity('Leave books',[],'allowed'));
});

test('a suggested replacement is reviewed before it updates a saved memory',async()=>{
 const {readFile}=await import('node:fs/promises'); const vm=await import('node:vm');
 const source=await readFile(new URL('../src/synqme.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('function renderPreferenceReview()'),source.indexOf('\nfunction activeLegacyPreferences()'));
 class Node {constructor(tag){this.tag=tag;this.children=[];this.events={};this.textContent='';this.value='';this.hidden=false;} append(...nodes){this.children.push(...nodes);} replaceChildren(...nodes){this.children=nodes;} setAttribute(){} addEventListener(type,fn){this.events[type]=fn;} }
 const panel=new Node('details'),list=new Node('div'),counter=new Node('span');
 const nodes={'#preferenceReview':panel,'#preferenceReviewList':list,'#preferenceReviewCount':counter};
 const memory={id:'m1',statement:'Pick them up',status:'user_stated'}; const updates=[];
 const context=vm.createContext({preferenceReviewDrafts:new Map(),preferenceReviewOpenKey:null,document:{querySelector:s=>nodes[s]||null,createElement:t=>new Node(t)},collectReviewableFragments:()=>[{kind:'memory',id:'m1',text:'Pick them up',source:{question:'What should I do with the cushions?',answer:'Pick them up',scenarioId:'room:living_room'}}],personaMemoryRecords:[memory],state:{preferences:[],messages:[]},cloudUserId:'user-a',supabase:{},API_BASE:'https://api.test',authenticatedApiHeaders:async()=>({}),fetch:async()=>({ok:true,json:async()=>({memories:[{statement:'Pick up cushions left on the floor.',status:'user_stated'}]})}),cleanPersonaMemoryCandidate,isUsefulStandalonePreference,memoryIsActive:()=>true,scenarioForId:id=>({id}),deriveMemoryTopic:()=> 'living_room',deriveMemoryKind:()=> 'preference',deriveMemoryScopeKey:()=> 'living_room.cushions',buildPersonaMemorySearchKeys:()=>[],updatePersonaMemoryRow:async(id,patch)=>updates.push({id,patch}),renderAll:()=>{}});
 vm.runInContext(body+'\n;globalThis.render=renderPreferenceReview;',context);context.render();
 const card=list.children[0],suggest=card.children.find(node=>node.textContent==='Suggest wording'),form=card.children.find(node=>node.tag==='form'),input=form.children[0].children[0];
 await suggest.events.click(); assert.equal(input.value,'Pick up cushions left on the floor.');assert.equal(updates.length,0);
 await form.events.submit({preventDefault(){}});assert.equal(updates.length,1);assert.equal(updates[0].patch.statement,input.value);assert.equal(updates[0].patch.status,'user_confirmed');
});
