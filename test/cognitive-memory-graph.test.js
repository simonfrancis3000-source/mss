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
 assert.throws(()=>validateMemoryProposals([candidate({target_memory_key:'someone-elses-rule'})],context),/invalid_memory_target/);
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
  await t.test('later proposals in one job can confirm the version replaced earlier in that same job',async()=>{
   const target=(await db.query("select * from public.synqme_persona_memories where scope_key='kitchen.hob.cloth' and status not in ('superseded','archived') order by created_at desc limit 1")).rows[0];
   await queue([candidate({statement:'I prefer a soft cloth on the cool hob.',relation:'updates',target_memory_key:target.memory_key}),candidate({statement:'I prefer a soft cloth on the cool hob.',relation:'confirms',target_memory_key:target.memory_key})],'Actually, use a soft cloth on the cool hob.',[target]);
   await finish();
   const active=(await db.query("select * from public.synqme_persona_memories where scope_key='kitchen.hob.cloth' and status not in ('superseded','archived')")).rows;
   assert.equal(active.length,1);assert.equal(active[0].status,'user_confirmed');assert.match(active[0].statement,/soft cloth/);
  });
  await t.test('dependency edges reject cycles and cross-owner rule links',async()=>{
   const a=(await db.query('select id from public.synqme_persona_memories order by created_at')).rows;
   await db.query("insert into public.synqme_rule_relations(user_id,from_rule_id,to_rule_id,relation) values($1::uuid,$2::uuid,$3::uuid,'depends_on')",[OWNER,a[0].id,a[1].id]);
   await assert.rejects(db.query("insert into public.synqme_rule_relations(user_id,from_rule_id,to_rule_id,relation) values($1::uuid,$2::uuid,$3::uuid,'depends_on')",[OWNER,a[1].id,a[0].id]),/cognitive_dependency_cycle/);
   await assert.rejects(db.query("insert into public.synqme_rule_relations(user_id,from_rule_id,to_rule_id,relation) values($1::uuid,$2::uuid,$3::uuid,'conflicts_with')",[OTHER,a[0].id,a[1].id]),/foreign key/);
  });
  await t.test('a correction and confirmed exception link to the current version in one transaction',async()=>{
   const target=(await db.query("select * from public.synqme_persona_memories where scope_key='kitchen.hob.cloth' and status not in ('superseded','archived') order by created_at desc limit 1")).rows[0];
   await queue([candidate({statement:'Ask before changing the hob cloth when guests visit.',scope_key:'kitchen.hob.guest.approval',source_quote:'Ask before changing',kind:'boundary',permission_policy:'ask_first'})],'Ask before changing the hob cloth when guests visit.');
   await finish();
   const exception=(await db.query("select * from public.synqme_persona_memories where scope_key='kitchen.hob.guest.approval'")).rows[0];
   await queue([candidate({statement:'Use a dry cloth on the hob.',source_quote:'dry cloth',relation:'updates',target_memory_key:target.memory_key}),candidate({statement:exception.statement,scope_key:exception.scope_key,kind:'boundary',permission_policy:'ask_first',source_quote:'Keep asking',relation:'confirms',target_memory_key:exception.memory_key,relations:[{kind:'exception_to',target_memory_key:target.memory_key}]})],'Actually, use a dry cloth. Keep asking when guests visit.',[target,exception]);
   await finish();
   const linked=(await db.query("select m.statement,m.status from public.synqme_rule_relations e join public.synqme_persona_memories m on m.id=e.to_rule_id where e.from_rule_id=$1::uuid and e.relation='exception_to'",[exception.id])).rows;
   assert.equal(linked.length,1);assert.match(linked[0].statement,/dry cloth/);assert.notEqual(linked[0].status,'superseded');
   // A later stale job cannot silently point a dependency at a new version.
   await queue([candidate({statement:'Keep a separate cloth for the table.',scope_key:'table.cloth',source_quote:'separate cloth',relations:[{kind:'depends_on',target_memory_key:target.memory_key}]})],'Use a separate cloth.',[target]);
   await assert.rejects(finish(),/relation_target_changed/);
   await db.query("delete from public.synqme_memory_jobs where status='processing'");
  });
  await t.test('corrections remain current when extraction runs before earlier memory jobs finish',async()=>{
   const scope_key='kitchen.queued.cloth';
   await queue([candidate({scope_key})],'Use a soft cloth.');
   // No supplied target: the preceding preference is still queued, so the
   // context read cannot yet provide a stored memory key to the model.
   await queue([candidate({statement:'Use a damp cloth on the hob.',scope_key,source_quote:'damp cloth'})],'Actually, use a damp cloth on the hob.');
   await finish();await finish();
   let active=(await db.query("select * from public.synqme_persona_memories where scope_key=$1 and status not in ('superseded','archived')",[scope_key])).rows;
   assert.equal(active.length,1);assert.equal(active[0].status,'user_stated');assert.match(active[0].statement,/damp cloth/);
   // Returning to a previously retired value must create a fresh current rule.
   await queue([candidate({scope_key})],'Actually, use a soft cloth.');await finish();
   active=(await db.query("select * from public.synqme_persona_memories where scope_key=$1 and status not in ('superseded','archived')",[scope_key])).rows;
   assert.equal(active.length,1);assert.equal(active[0].status,'user_stated');assert.match(active[0].statement,/soft cloth/);
   const raceScope='kitchen.outoforder.cloth';
   await queue([candidate({scope_key:raceScope})],'Use a soft cloth.');
   await queue([candidate({statement:'Use a damp cloth on the hob.',scope_key:raceScope,source_quote:'damp cloth'})],'Actually, use a damp cloth on the hob.');
   const earlier=(await db.query('select public.claim_synqme_cognitive_memory_job() v')).rows[0].v;
   const later=(await db.query('select public.claim_synqme_cognitive_memory_job() v')).rows[0].v;
   for(const job of [later,earlier])await db.query('select public.complete_synqme_cognitive_memory_job($1::uuid,$2::uuid)',[job.id,job.lease_token]);
   active=(await db.query("select * from public.synqme_persona_memories where scope_key=$1 and status not in ('superseded','archived')",[raceScope])).rows;
   assert.equal(active.length,1);assert.match(active[0].statement,/damp cloth/);
  });
  await t.test('same-batch dependencies preserve evidence and retire descriptive facts after a correction',async()=>{
   const latest='For my throw placement, I prefer chair. Please treat this as my normal arrangement. Ask before moving throws when I work.';
   const arrangement=candidate({statement:'The owner prefers throws on the chair.',scope_key:'throws.arrangement',decision_key:'throws.arrangement',source_quote:'I prefer chair'});
   const description=candidate({statement:'The chair is the normal standing arrangement for throws.',kind:'fact',scope_key:'throws.arrangement_status',decision_key:'throws.arrangement_status',source_quote:'Please treat this as my normal arrangement',relations:[{kind:'depends_on',target_memory_key:'throws.arrangement'}]});
   const restriction=candidate({statement:'Ask before moving throws when I work.',kind:'boundary',permission_policy:'ask_first',scope_key:'throws.work_approval',decision_key:'throws.work_approval',source_quote:'Ask before moving throws when I work',relations:[{kind:'depends_on',target_memory_key:'throws.arrangement'}]});
   const proposals=await queue([arrangement,description,restriction],latest);
   assert.equal(proposals[1].relations[0].target_memory_key,proposals[0].memory_key);
   await finish();
   const known=(await db.query("select * from public.synqme_persona_memories where scope_key like 'throws.%'")).rows;
   const target=known.find(r=>r.scope_key==='throws.arrangement');
   await queue([candidate({statement:'The owner prefers throws on the sofa.',scope_key:'throws.arrangement',source_quote:'sofa',relation:'updates',target_memory_key:target.memory_key})],'Actually, use the sofa.',known);
   await finish();
   const rows=(await db.query("select * from public.synqme_persona_memories where scope_key like 'throws.%'")).rows;
   const fact=rows.find(r=>r.scope_key==='throws.arrangement_status');
   assert.equal(fact.status,'superseded');assert.equal(fact.attributes.invalidated_dependency_id,target.id);assert.ok(fact.source_refs.length);assert.match(fact.statement,/chair/);
   assert.equal(rows.find(r=>r.scope_key==='throws.work_approval').status,'user_stated');
   const active=rows.filter(r=>!['superseded','archived'].includes(r.status));
   assert.ok(!active.some(r=>/chair/.test(r.statement)));assert.equal(active.length,2);
   assert.equal(evaluatePermission({rules:active,actionScope:'throws.work_approval',conditionsKnown:true,capabilityKnown:true}).outcome,'ask');
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

test('an approval exception remains a structured boundary even if labelled as an exception',()=>{
 const [row]=validateMemoryProposals([candidate({statement:'Ask before changing book arrangement while guests visit.',kind:'exception',scope_key:'books.visitor.approval',permission_policy:'ask_first',source_quote:'ask before changing'})],{latestUser:'Please ask before changing book arrangement while guests visit.',objectives,turnKey:'exception',scope:'room:living_room'});
 assert.equal(row.kind,'boundary');assert.equal(row.permission_policy,'ask_first');
 assert.equal(evaluatePermission({rules:[row],actionScope:row.scope_key,conditionsKnown:true,capabilityKnown:true}).outcome,'ask');
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

test('a refinement retains the operative preference and boundary while adding a reason',()=>{
 const old={memory_key:'old',scope_key:'towels.arrangement',statement:'Keep towels folded.',kind:'boundary',permission_policy:'ask_first'};
 const [row]=validateMemoryProposals([candidate({statement:'The reason is to find towels quickly.',relation:'refines',target_memory_key:'old',source_quote:'find towels quickly'})],{latestUser:'I want to find towels quickly.',knownRules:[old],objectives,turnKey:'reason',scope:'room:bathroom'});
 assert.ok(row.statement.includes('Keep towels folded.'));assert.equal(row.permission_policy,'ask_first');
});

test('a corrected exception retains approval without duplicating its old placement',()=>{
 const old={memory_key:'old',scope_key:'slippers.working_approval',statement:'Ask before moving slippers from bedside while I work.',kind:'boundary',permission_policy:'ask_first'};
 const [row]=validateMemoryProposals([candidate({statement:'Ask before moving slippers from the wardrobe while I work.',relation:'refines',target_memory_key:'old',source_quote:'Keep asking'})],{latestUser:'Actually, use the wardrobe. Keep asking while I work.',knownRules:[old],objectives,turnKey:'correction',scope:'room:bedroom'});
 assert.equal(row.relation,'updates');assert.equal(row.permission_policy,'ask_first');assert.equal(row.kind,'boundary');assert.ok(!row.statement.includes('bedside'));
});

test('circular same-job dependencies are rejected before any memory job is committed',()=>{
 const knownRules=[{memory_key:'arrangement',scope_key:'pens.arrangement',statement:'Keep pens in a cup.'},{memory_key:'approval',scope_key:'pens.approval',statement:'Ask before changing damaged pens.'}];
 const raw=[candidate({statement:'Keep pens in a drawer.',relation:'updates',target_memory_key:'arrangement',source_quote:'drawer',relations:[{kind:'depends_on',target_memory_key:'approval'}]}),candidate({statement:'Ask before changing damaged pens.',relation:'confirms',target_memory_key:'approval',source_quote:'Keep asking',relations:[{kind:'depends_on',target_memory_key:'arrangement'}]})];
 const context={latestUser:'Actually, use a drawer. Keep asking about damage.',knownRules,objectives,turnKey:'cycle',scope:'room:office'};
 assert.throws(()=>validateMemoryProposals(raw,context),/invalid_memory_graph_proposal/);
 raw[0].relations=[];
 assert.equal(validateMemoryProposals(raw,context).length,2);
});

test('ambiguous and forward scope dependencies request repair instead of silently losing the link',()=>{
 const input=candidate({relations:[{kind:'depends_on',target_memory_key:'pens.arrangement'}]});
 const context={latestUser:'Use a soft cloth.',objectives,turnKey:'dependency',scope:'room:kitchen'};
 assert.throws(()=>validateMemoryProposals([input],{...context,knownRules:[{memory_key:'one',scope_key:'pens.arrangement'},{memory_key:'two',scope_key:'pens.arrangement'}]}),/invalid_memory_target/);
 assert.throws(()=>validateMemoryProposals([input,candidate({scope_key:'pens.arrangement'})],context),/invalid_memory_target/);
});

test('an explicit owner correction remains owner evidence when a household label mentions a guest',()=>{
 const old={memory_key:'old',scope_key:'visitor.towels.location',statement:'Keep visitor towels in a basket.',status:'user_stated'};
 const [row]=validateMemoryProposals([candidate({statement:'Keep visitor towels in the cupboard.',scope_key:old.scope_key,relation:'updates',target_memory_key:'old',source_quote:'I now prefer cupboard instead of basket'})],{latestUser:'Actually, change my guest towel storage preference: I now prefer cupboard instead of basket.',knownRules:[old],objectives,turnKey:'adverb',scope:'room:bathroom'});
 assert.equal(row.target_memory_key,'old');assert.match(row.statement,/cupboard/);
 assert.equal(validateMemoryProposals([candidate({source_quote:'soft cloth'})],{latestUser:'My guest now prefers a soft cloth.',knownRules:[],objectives,turnKey:'third-party',scope:'room:kitchen'}).length,0);
});

test('owner corrections resolve a unique exact fact dimension and reject ambiguous or foreign references',()=>{
 const old={memory_key:'correct-id',scope_key:'kitchen.hob.cloth',statement:'Use a soft cloth.',status:'user_stated'};
 const context={latestUser:'Actually, use a damp cloth.',knownRules:[old],objectives,turnKey:'resolved',scope:'room:kitchen'};
 for(const target_memory_key of ['mistyped-id',old.scope_key]){
  const [row]=validateMemoryProposals([candidate({statement:'Use a damp cloth.',source_quote:'damp cloth',relation:'updates',target_memory_key})],context);
  assert.equal(row.target_memory_key,old.memory_key);assert.equal(row.attributes.target_resolution,'exact_scope');
 }
 const [confirmed]=validateMemoryProposals([candidate({relation:'confirms',target_memory_key:old.scope_key})],{...context,latestUser:'Keep using a soft cloth.'});
 assert.equal(confirmed.target_memory_key,old.memory_key);
 assert.throws(()=>validateMemoryProposals([candidate({relation:'updates',target_memory_key:'unknown'})],{...context,knownRules:[old,{...old,memory_key:'other'}],latestUser:'Actually, use a soft cloth.'}),/invalid_memory_target/);
 assert.throws(()=>validateMemoryProposals([candidate({scope_key:'other.scope',relation:'updates',target_memory_key:'foreign'})],{...context,latestUser:'Actually, use a soft cloth.'}),/invalid_memory_target/);
});
test('new fact dimensions do not collide merely because they share a room',()=>{
 const context={latestUser:'Use a soft cloth.',knownRules:[],objectives,turnKey:'dimensions',scope:'room:kitchen'};
 const a=validateMemoryProposals([candidate({decision_key:'hob.cloth',scope_key:'hob'})],context)[0];
 const b=validateMemoryProposals([candidate({decision_key:'hob.reason',scope_key:'hob'})],context)[0];
 assert.notEqual(a.scope_key,b.scope_key);
});
