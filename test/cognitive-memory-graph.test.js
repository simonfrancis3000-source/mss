import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeDatabase,OWNER,OTHER } from './fixtures/runtime-database.mjs';
import { hash } from '../server/cognitive-core.js';
import { validateMemoryProposals,createCognitiveMemoryWorker } from '../server/cognitive-memory.js';
import { buildDecisionPlan,evaluatePermission } from '../server/cognitive-planner.js';

const objectives=[{id:'hob',title:'Hob cleaning'}];
const candidate=(extra={})=>({statement:'I prefer a soft cloth on the hob.',topic:'kitchen',kind:'preference',scope_key:'kitchen.hob.cloth',relation:'new',status:'user_stated',conditions:[],permission_policy:'unspecified',source_quote:'soft cloth',attributes:{area_id:'hob'},...extra});
test('memory proposals preserve conditions, grounded evidence, correction targets and permissions',()=>{
 const context={latestUser:'Actually, I prefer a soft cloth except on the hot hob.',knownRules:[{memory_key:'old',scope_key:'kitchen.hob.cloth'}],objectives,turnKey:'turn',scope:'room:kitchen'};
 const [row]=validateMemoryProposals([candidate({relation:'updates',target_memory_key:'old',conditions:['except on the hot hob']})],context);
 assert.equal(row.explicit_correction,true);assert.deepEqual(row.conditions,['except on the hot hob']);
 assert.equal(validateMemoryProposals([candidate({source_quote:'not in the user message'})],context).length,0);
 assert.equal(validateMemoryProposals([candidate({target_memory_key:'someone-elses-rule'})],context).length,0);
 assert.equal(validateMemoryProposals([candidate()],{...context,latestUser:'My guest likes coffee and a soft cloth.'}).length,0);
 const allowed=validateMemoryProposals([candidate({kind:'boundary',permission_policy:'allowed'})],context)[0];assert.equal(allowed.permission_policy,'unspecified');
});

test('planner uses owner-reviewed areas, evidence and conflicts rather than message count',()=>{
 const plan=buildDecisionPlan({objectives:[...objectives,{id:'dishes',title:'Dishes'}],state:{objectiveId:'hob',dispositions:[]},context:{rules:[{memory_key:'rule',statement:'Ask first.',status:'conflicting',attributes:{area_id:'dishes'}}]},review:{reviewedAreaIds:['hob']}});
 assert.equal(plan.selected.id,'dishes');assert.equal(plan.selected.needsClarification,true);
 assert.equal(evaluatePermission({rules:[{scope_key:'buy',status:'user_confirmed',permission_policy:'allowed'}],actionScope:'buy',conditionsKnown:true,capabilityKnown:false}).outcome,'wait');
 assert.equal(evaluatePermission({rules:[{scope_key:'buy',status:'user_confirmed',permission_policy:'prohibited'}],actionScope:'buy',conditionsKnown:true,capabilityKnown:true}).outcome,'blocked');
});

test('PostgreSQL durable memory jobs apply corrections, graph links, ownership and retry safely',async t=>{
 const db=await runtimeDatabase();let sequence=0;
 const queue=async(raw,latestUser,knownRules=[])=>{
  const key=hash('job-'+ ++sequence),scope='room:kitchen';
  const proposals=validateMemoryProposals(raw,{latestUser,knownRules,objectives,turnKey:key,scope});
  const claim=(await db.query('select public.claim_synqme_cognitive_turn($1::uuid,0,$2,$3,$4) v',[OWNER,scope,key,hash(latestUser)])).rows[0].v;
  const state={messages:[{role:'assistant',content:'Which cloth?'},{role:'user',content:latestUser},{role:'assistant',content:'When should I ask you?'}]};
  await db.query('select public.commit_synqme_cognitive_turn_v2($1::uuid,0,$2,$3,$4::uuid,$5::jsonb,$6::jsonb,null,$7::jsonb)',[OWNER,scope,key,claim.lease,JSON.stringify(state),JSON.stringify({reply:'When should I ask you?',runtime:{}}),JSON.stringify({memories:proposals,sourceTimestamp:new Date().toISOString()})]);
  return proposals;
 };
 const finish=async()=>{const job=(await db.query('select public.claim_synqme_cognitive_memory_job() v')).rows[0].v;assert.ok(job);return (await db.query('select public.complete_synqme_cognitive_memory_job($1::uuid,$2::uuid) v',[job.id,job.lease_token])).rows[0].v;};
 try{
  let old;
  await t.test('source proposals enqueue with the committed turn and persist without a browser',async()=>{
   await queue([candidate()],'Use a soft cloth.');assert.equal((await finish()).saved,1);
   old=(await db.query('select * from public.synqme_persona_memories')).rows[0];assert.equal(old.statement,'I prefer a soft cloth on the hob.');assert.equal(old.source_refs.length,1);
   const job=(await db.query('select * from public.synqme_memory_jobs')).rows[0];assert.equal(job.status,'done');assert.equal(job.user_message,'');assert.deepEqual(job.proposals,[]);
  });
  await t.test('explicit correction supersedes the old rule and preserves an exception',async()=>{
   await queue([candidate({statement:'I prefer a damp cloth on the hob, except while it is hot.',source_quote:'damp cloth',relation:'updates',target_memory_key:old.memory_key,conditions:['except while it is hot'],relations:[{kind:'depends_on',target_memory_key:old.memory_key}]})],'Actually, use a damp cloth, except while the hob is hot.',[old]);
   // Exercise the SQL defense with a pre-existing, unsanitized queued proposal.
   await db.query("update public.synqme_memory_jobs set proposals=jsonb_set(proposals,'{0,relations}',$1::jsonb) where server_owned and status='pending'",[JSON.stringify([{kind:'depends_on',target_memory_key:old.memory_key}])]);
   await finish();const rules=(await db.query('select * from public.synqme_persona_memories order by created_at')).rows;
   assert.equal(rules[0].status,'superseded');assert.deepEqual(rules[1].conditions,['except while it is hot']);assert.equal(rules[1].supersedes_id,old.id);
   assert.equal((await db.query('select relation from public.synqme_rule_relations')).rows[0].relation,'supersedes');
  });
  await t.test('a source quote beyond the legacy text limit remains grounded in the queued source turn',async()=>{
   const latest='Background context. '.repeat(100)+'I prefer a soft cloth for the dining table.';
   await queue([candidate({statement:'I prefer a soft cloth for the dining table.',scope_key:'dining.table.cloth'})],latest);
   assert.equal((await finish()).saved,1);
   assert.equal((await db.query("select count(*)::int n from public.synqme_persona_memories where scope_key='dining.table.cloth'")).rows[0].n,1);
  });
  await t.test('reverified appliance metadata replaces the earlier unavailable status without duplicating the rule',async()=>{
   const raw=candidate({statement:'My hob is Bosch model TEST123.',scope_key:'appliance.bosch.test123',source_quote:'TEST123'});
   const key=hash('appliance-fixed');
   const initial={...raw,memory_key:key,attributes:{appliance_v1:{type:'hob',brand:'Bosch',model:'TEST123',manual_status:'unavailable'}}};
   await db.query("insert into public.synqme_persona_memories(user_id,memory_key,topic,kind,scope_key,statement,status,relation,confidence,conditions,permission_policy,attributes,source_timestamp) values($1::uuid,$2,'kitchen','fact',$3,$4,'user_stated','new',1,'[]','unspecified',$5::jsonb,now()-interval '1 minute')",[OWNER,key,raw.scope_key,raw.statement,JSON.stringify(initial.attributes)]);
   // The server-generated appliance proposal carries nested verified metadata.
   const turnKey=hash('appliance-recheck');
   const claim=(await db.query('select public.claim_synqme_cognitive_turn($1::uuid,0,$2,$3,$4) v',[OWNER,'room:kitchen',turnKey,hash('TEST123')])).rows[0].v;
   const proposal={...initial,attributes:{appliance_v1:{...initial.attributes.appliance_v1,manual_status:'matched',manual_url:'https://www.bosch-home.com/manual'}}};
   const state={messages:[{role:'user',content:'TEST123'},{role:'assistant',content:'What should I learn next?'}]};
   await db.query('select public.commit_synqme_cognitive_turn_v2($1::uuid,0,$2,$3,$4::uuid,$5::jsonb,$6::jsonb,null,$7::jsonb)',[OWNER,'room:kitchen',turnKey,claim.lease,JSON.stringify(state),JSON.stringify({reply:'What should I learn next?'}),JSON.stringify({memories:[proposal]})]);
   await finish();
   const rows=(await db.query('select attributes from public.synqme_persona_memories where memory_key=$1',[key])).rows;
   assert.equal(rows.length,1);assert.equal(rows[0].attributes.appliance_v1.manual_status,'matched');
  });
  await t.test('dependency edges reject cycles and cross-owner rule links',async()=>{
   const a=(await db.query('select id from public.synqme_persona_memories order by created_at')).rows;
   await db.query("insert into public.synqme_rule_relations(user_id,from_rule_id,to_rule_id,relation) values($1::uuid,$2::uuid,$3::uuid,'depends_on')",[OWNER,a[0].id,a[1].id]);
   await assert.rejects(db.query("insert into public.synqme_rule_relations(user_id,from_rule_id,to_rule_id,relation) values($1::uuid,$2::uuid,$3::uuid,'depends_on')",[OWNER,a[1].id,a[0].id]),/cognitive_dependency_cycle/);
   await assert.rejects(db.query("insert into public.synqme_rule_relations(user_id,from_rule_id,to_rule_id,relation) values($1::uuid,$2::uuid,$3::uuid,'conflicts_with')",[OTHER,a[0].id,a[1].id]),/foreign key/);
  });
  await t.test('reset removes pending server jobs and rules cannot be restored by stale work',async()=>{
   await queue([candidate({statement:'I prefer a dry cloth for the table.'})],'Use a soft cloth.');
   const job=(await db.query('select public.claim_synqme_cognitive_memory_job() v')).rows[0].v;
   await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OWNER]);await db.exec('set role authenticated');
   const before=(await db.query('select proposals from public.synqme_memory_jobs where id=$1::uuid',[job.id])).rows[0].proposals;
   await db.query("update public.synqme_memory_jobs set proposals='[]' where server_owned");
   assert.deepEqual((await db.query('select proposals from public.synqme_memory_jobs where id=$1::uuid',[job.id])).rows[0].proposals,before);
   await db.query('update public.synqme_training_revisions set revision=revision+1 where user_id=$1::uuid',[OWNER]);
   await db.exec('reset role;set role service_role');
   await assert.rejects(db.query('select public.complete_synqme_cognitive_memory_job($1::uuid,$2::uuid)',[job.id,job.lease_token]),/memory_lease_expired/);
  });
 }finally{await db.close();}
});

test('background worker bounds concurrency and retries failed leased jobs',async()=>{
 let claims=0,retries=0;const worker=createCognitiveMemoryWorker({batchSize:2,logger:{warn(){}},store:{async claimMemoryJob(){return ++claims===1?{id:'one',attempts:1}:null;},async completeMemoryJob(){throw Error('offline');},async retryMemoryJob(){retries++;}}});
 await Promise.all([worker.drain(),worker.drain()]);assert.equal(retries,1);assert.equal(claims,2);worker.stop();
});

test('a negated permission cannot be saved as authorization',()=>{
 const context={latestUser:"You can't spend money without asking me.",knownRules:[],objectives,turnKey:'permission',scope:'room:kitchen'};
 const [row]=validateMemoryProposals([candidate({statement:'You can spend money without asking me.',kind:'boundary',permission_policy:'allowed',source_quote:"You can't spend money"})],context);
 assert.notEqual(row?.permission_policy,'allowed');
});

test('permission evidence stays conservative for denials and requires quoted explicit consent',()=>{
 const cases=[
  ["You cannot spend money without asking.","You cannot spend money",'unspecified'],
  ["Never spend money without asking.","Never spend money",'unspecified'],
  ["No puedes gastar dinero sin preguntar.","No puedes gastar dinero",'unspecified'],
  ["You can buy tea without asking.","buy tea",'unspecified'],
  ["You may buy tea without asking.","You may buy tea without asking",'allowed']
 ];
 for(const [latestUser,source_quote,expected] of cases){
  const [row]=validateMemoryProposals([candidate({statement:'You may buy tea without asking.',kind:'boundary',permission_policy:'allowed',source_quote})],{latestUser,knownRules:[],objectives,turnKey:'permission',scope:'room:kitchen'});
  assert.equal(row?.permission_policy,expected,latestUser);
 }
});
