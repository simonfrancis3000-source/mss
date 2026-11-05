import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeDatabase,OWNER } from './fixtures/runtime-database.mjs';
import { hash } from '../server/cognitive-core.js';
import { cognitiveRollout } from '../server/cognitive-rollout.js';
import { createCognitiveClient } from '../src/cognitive-client.js';
import { measurePcmQuality } from '../src/audio-quality.js';

test('rollout checks verified account IDs/emails and defaults to disabled',()=>{
 assert.equal(cognitiveRollout()({id:'a'}),false);
 assert.equal(cognitiveRollout({enabled:true})({id:'a'}),false);
 const enabled=cognitiveRollout({enabled:true,userIds:'a',emails:'owner@example.test'});
 assert.equal(enabled({id:'a'}),true);assert.equal(enabled({id:'b',email:'OWNER@example.test'}),true);assert.equal(enabled({id:'b'}),false);
});
test('reset policies explicitly reject anonymous authenticated sessions and preserve owner cleanup',async()=>{
 const db=await runtimeDatabase();
 try{
  await db.query('insert into public.synqme_training_revisions(user_id,revision) values($1,1)',[OWNER]);
  const insert=()=>db.query("insert into public.synqme_cognitive_sessions(user_id,scope_key,training_revision) values($1,'room:kitchen',0)",[OWNER]);
  await insert();
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OWNER]);await db.query("select set_config('request.jwt.claims','{\"is_anonymous\":true}',false)");await db.exec('set role authenticated');
  assert.equal((await db.query('delete from public.synqme_cognitive_sessions returning user_id')).rows.length,0);
  await db.exec('reset role');
  const policies=(await db.query("select qual from pg_policies where schemaname='public' and policyname in ('cognitive_sessions_reset','cognitive_turns_reset','cognitive_jobs_reset')")).rows;
  assert.equal(policies.length,3);assert.ok(policies.every(p=>p.qual.includes('is_anonymous')));
  await db.query("select set_config('request.jwt.claims','{\"is_anonymous\":false}',false)");await db.exec('set role authenticated');
  assert.equal((await db.query('delete from public.synqme_cognitive_sessions returning user_id')).rows.length,1);
 }finally{await db.close();}
});
test('client account negotiation is isolated and failed verification cannot enable mutations',async()=>{
 let owner='a',calls=0;
 const client=createCognitiveClient({apiBase:'https://fixture',getUserId:()=>owner,getHeaders:async()=>({}),fetchImpl:async()=>{calls++;return Response.json({enabled:owner==='a'});}});
 const capabilities={version:1,languages:['en'],requiresAccountCheck:true};
 assert.equal(await client.enabled(capabilities),true);assert.equal(await client.enabled(capabilities),true);assert.equal(calls,1);
 owner='b';assert.equal(await client.enabled(capabilities),false);assert.equal(calls,2);
});
test('delivery observations serialize and never cross an account change',async()=>{
 let user='owner';const events=[];
 const client=createCognitiveClient({apiBase:'https://fixture',getUserId:()=>user,getHeaders:async()=>({}),fetchImpl:async(url,options)=>{events.push(JSON.parse(options.body));return Response.json({recorded:true});}});
 client.remember('source',{turnId:'turn'});
 await Promise.all([client.report({turnId:'turn',deliveryKey:'voice',channel:'phonic',status:'dispatched',sequence:1}),client.report({turnId:'turn',deliveryKey:'voice',channel:'phonic',status:'playback_started',sequence:2})]);
 assert.deepEqual(events.map(e=>e.sequence),[1,2]);user='other';await client.report({turnId:'turn',deliveryKey:'voice',channel:'phonic',status:'playback_completed',sequence:3});assert.equal(events.length,2);
});
test('audio diagnostics distinguish a clipped source from clean PCM without storing audio',()=>{
 const clean=measurePcmQuality(Int16Array.from([0,1000,-1000,2000]));const clipped=measurePcmQuality(Int16Array.from([32767,-32768,32767,1000]));
 assert.equal(clean.clippedRatio,0);assert.equal(clipped.clippedRatio,.75);assert.ok(clipped.rms>clean.rms);
});
test('PostgreSQL delivery terminals and retention tombstones preserve truthful replay',async()=>{
 const db=await runtimeDatabase();const key=hash('delivery');
 try{
  const claim=(await db.query('select public.claim_synqme_cognitive_turn($1::uuid,0,$2,$3,$4) v',[OWNER,'room:kitchen',key,hash('source')])).rows[0].v;
  await db.query('select public.commit_synqme_cognitive_turn($1::uuid,0,$2,$3,$4::uuid,$5::jsonb,$6::jsonb,null)',[OWNER,'room:kitchen',key,claim.lease,'{"messages":[]}','{"reply":"A generated reply.","runtime":{}}']);
  const report=(status,sequence)=>db.query("select public.record_synqme_cognitive_delivery($1::uuid,0,$2,'voice','phonic',$3,$4)",[OWNER,key,status,sequence]);
  await report('dispatched',1);await report('playback_started',2);await report('interrupted',3);await report('playback_completed',4);
  assert.equal((await db.query('select status from public.synqme_cognitive_deliveries')).rows[0].status,'interrupted');
  await db.query("update public.synqme_cognitive_turns set updated_at=now()-interval '91 days'");
  await db.query('select public.prune_synqme_cognitive_history()');
  const replay=(await db.query('select public.claim_synqme_cognitive_turn($1::uuid,0,$2,$3,$4) v',[OWNER,'room:kitchen',key,hash('source')])).rows[0].v;
  assert.equal(replay.status,'completed');assert.deepEqual(replay.result,{expired:true});
 }finally{await db.close();}
});
