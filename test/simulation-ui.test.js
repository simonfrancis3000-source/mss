import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class Node {
  constructor(tag) { this.tag=tag; this.children=[]; this.events={}; this.attributes={}; this.value=''; this.textContent=''; this.isConnected=true; this.disabled=false; }
  append(...nodes) { this.children.push(...nodes); if (this.tag==='select' && !this.value && nodes[0]?.value) this.value=nodes[0].value; }
  replaceChildren(...nodes) { this.children=nodes; }
  setAttribute(key,value) { this.attributes[key]=value; }
  addEventListener(event,handler) { this.events[event]=handler; }
  dispatchEvent(event) { this.events[event.type]?.(event); }
  focus() {}
}
function find(root, text) { if (root.textContent === text) return root; for(const child of root.children){const result=find(child,text);if(result)return result;}return null; }

test('a situation displays saved evidence, records feedback and sends corrections to chat', async () => {
 const source=await readFile(new URL('../src/synqme.js',import.meta.url),'utf8');
 const functions=['renderSituationPreview','saveSituationFeedback'].map(name=>source.match(new RegExp('(?:async )?function '+name+'\\([^]*?\\n\\}'))?.[0]).join('\n');
 const writes=[];const input=new Node('textarea');const scenario={id:'room:living_room',title:'Living Room'};
 const task={id:'tidying',title:'Tidying and object placement'};
 const preview={situation:'A guest leaves papers on the sofa.',proposed_response:'I would leave the papers alone.',follow_up_question:'',sources:[{id:'m1',statement:'Leave my papers alone.',status:'user_confirmed',conditions:[]} ]};
 const supabase={from(table){assert.equal(table,'synqme_evaluation_records');return {async upsert(record,opts){writes.push({record,opts});return {error:null};}};}};
 const context=vm.createContext({document:{createElement:tag=>new Node(tag)},scenarioTasks:()=>[task],ACTIVITIES:[{id:'tidying',label:'Tidying'}],simulationSession:null,
  simulationCapabilitySummary:()=>({text:'Robot capabilities are unknown.'}),pexiCapabilityManifest:null,state:{profile:{robotType:'Humanoid',preferredLanguage:'en'}},
  cloudUserId:'account-one',supabase,selectedCompanionDisplayName:()=> 'Freddie',API_BASE:'https://api.fixture',
  authenticatedApiHeaders:async()=>({Authorization:'Bearer fixture'}),fetch:async()=>({ok:true,json:async()=>preview}),
  startJourneyScenario:async()=>true,elements:{messageInput:input},Event:class {constructor(type){this.type=type;}},renderScenarioJourney() {}});
 vm.runInContext(functions+'\n;globalThis.make=renderSituationPreview;',context);
 const root=context.make(scenario); const button=find(root,'Create a situation');
 await button.events.click();
 assert.ok(find(root,'A guest leaves papers on the sofa.'));
 assert.ok(find(root,'I would leave the papers alone.'));
 assert.ok(find(root,'Leave my papers alone. (reviewed)'));
 await find(root,"That's right").events.click();
 assert.equal(writes[0].record.user_id,'account-one');assert.equal(writes[0].record.scope_key,scenario.id);
 assert.equal(writes[0].record.checks.user_feedback,'agreed');assert.equal(writes[0].record.outcome,'observed');
 await find(root,'I would do it differently').events.click();
 assert.equal(writes[1].record.checks.user_feedback,'different');assert.equal(writes[1].opts.ignoreDuplicates,false);
 assert.match(input.value,/practice situation.*A guest leaves papers on the sofa/);
});
