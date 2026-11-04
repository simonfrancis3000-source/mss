import test from 'node:test';import assert from 'node:assert/strict';
import {cases} from '../evals/advanced/cases.mjs';
import {createHarness} from '../evals/advanced/harness.mjs';
import {validateTurnProposal} from '../server/cognitive-core.js';
import {checkPreferenceCorrection,containsPreferenceValue} from '../evals/advanced/checks.mjs';
test('correction grading permits historical reasons but rejects an operative old default or conflict',()=>{
 assert.equal(containsPreferenceValue('Blankets go on shelves.','shelf'),true);
 assert.equal(containsPreferenceValue('Blankets go in baskets.','shelf'),false);
 const scopes=new Set(['books.arrangement']),values={oldValue:'author',newValue:'colour'};
 const rows=[{scope_key:'books.arrangement',statement:'Arrange books by colour.',status:'user_stated'},{scope_key:'books.reason',statement:'The reason for author order was quick finding.',status:'user_stated'}];
 assert.deepEqual(checkPreferenceCorrection(rows,scopes,values),{correctionPresent:true,stalePreferenceActive:false});
 assert.equal(checkPreferenceCorrection([...rows,{scope_key:'books.arrangement',statement:'Arrange books by author.',status:'conflicting'}],scopes,values).stalePreferenceActive,true);
 assert.equal(checkPreferenceCorrection([rows[1]],scopes,values).correctionPresent,false);
});
test('received replies preserve unanswered decision status across database commits',async()=>{
 const c=cases[0];let n=0;
 const h=await createHarness(async()=>validateTurnProposal({schema_version:1,reply:++n===1?'Where should damaged books wait?':'When should I check the books?',decision_key:n===1?'books.damage_location':'books.check_time',previous_answer:{answered:false,source_quote:''},actions:[]},[c.objective]));
 try{
  await h.turn(c,0);await h.turn(c,1);
  const row=(await h.db.query("select status,source_refs from public.synqme_decision_states where decision_key='cogd:books.damage_location'")).rows[0];
  assert.equal(row.status,'response_received');assert.equal(row.source_refs.at(-1).answered,false);
 }finally{await h.close();}
});
test('advanced dataset has the agreed counts, twelve turns, and separate reserved topics',()=>{
 assert.deepEqual(['everyday','difficult','reserved'].map(s=>cases.filter(c=>c.split===s).length),[100,50,50]);
 assert.equal(new Set(cases.map(c=>c.id)).size,200);assert.ok(cases.every(c=>c.turns.length===12));
 const dev=new Set(cases.filter(c=>c.split!=='reserved').map(c=>c.objective.id));assert.ok(cases.filter(c=>c.split==='reserved').every(c=>!dev.has(c.objective.id)));
});
test('advanced harness commits migration SQL, drains memory and preserves retry/rollback across a long conversation',async()=>{
 let seq=0;const c=cases.find(c=>c.split==='difficult');
 const h=await createHarness(async({context})=>{
  const user=context.latestUser,correct=user.startsWith('Actually');const target=context.memory.find(r=>r.statement.includes(c.oldValue));
  return validateTurnProposal({schema_version:1,reply:'I will follow the current arrangement. What should change in situation '+ ++seq+'?',actions:[],objective_id:c.objective.id,memory_proposals:seq===1||correct?[{statement:user,source_quote:user,topic:'general_household',kind:'preference',scope_key:'book.arrangement',status:'user_stated',relation:correct?'updates':'new',target_memory_key:correct?target?.id:'',attributes:{area_id:c.objective.id},conditions:[],permission_policy:'unspecified'}]:[]},[c.objective]);
 });
 try{
  for(let i=0;i<12;i++){
   if(i===8){h.failNextCommit();await assert.rejects(h.turn(c,i));assert.equal((await h.reminders()).length,0);}
   const r=await h.turn(c,i);await h.drain();
   if(i===8){assert.equal((await h.turn(c,i)).runtime.replayed,true);assert.equal((await h.reminders()).length,1);}
   assert.equal(await h.isolated(),true);assert.ok(r.reply);
  }
  assert.ok((await h.rules()).some(r=>r.statement.includes(c.newValue)));
 }finally{await h.close();}
});
