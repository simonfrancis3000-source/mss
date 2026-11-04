import {runtimeDatabase,OWNER,OTHER} from '../../test/fixtures/runtime-database.mjs';
import {createCognitiveRuntime} from '../../server/cognitive-runtime.js';
import {RuntimeError} from '../../server/cognitive-core.js';
export async function createHarness(generate){
 const db=await runtimeDatabase();let failCommit=false,modelCalls=0;
 const rpc=async(sql,args=[])=>{try{return (await db.query(sql,args)).rows[0]?.v;}catch(e){throw new RuntimeError(e.message,e.message.startsWith('runtime_')?409:503);}};
 const rules=async(user=OWNER)=>(await db.query("select * from public.synqme_persona_memories where user_id=$1::uuid and status not in ('superseded','archived') order by created_at",[user])).rows;
 const store={
  claim:(a,i)=>rpc('select public.claim_synqme_cognitive_turn($1::uuid,0,$2,$3,$4) v',[a.user.id,i.scope,i.key,i.fingerprint]),
  commit:(a,i)=>{if(failCommit){failCommit=false;throw new RuntimeError('runtime_storage_unavailable');}return rpc('select public.commit_synqme_cognitive_turn_v2($1::uuid,0,$2,$3,$4::uuid,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb) v',[a.user.id,i.scope,i.key,i.lease,JSON.stringify(i.state),JSON.stringify(i.result),i.action ? JSON.stringify(i.action) : null,JSON.stringify(i.enrichment)]);},
  release:(a,i)=>rpc('select public.release_synqme_cognitive_turn($1::uuid,0,$2,$3,$4::uuid) v',[a.user.id,i.scope,i.key,i.lease]),
  reminders:async(a)=>(await db.query('select id,title,completed from public.synqme_reminders where user_id=$1::uuid',[a.user.id])).rows,
  review:async()=>({relations:[]})
 };
 const contextStore={loadContext:async(a)=>({available:true,rules:await rules(a.user.id),decisions:[],appliances:[]})};
 const runtime=createCognitiveRuntime({store,contextStore,generate:async input=>{modelCalls++;return generate(input);}});
 async function drain(){for(let i=0;i<10;i++){const job=await rpc('select public.claim_synqme_cognitive_memory_job() v');if(!job)return;await rpc('select public.complete_synqme_cognitive_memory_job($1::uuid,$2::uuid) v',[job.id,job.lease_token]);}throw Error('memory_queue_did_not_drain');}
 return {db,rules,drain,get modelCalls(){return modelCalls;},failNextCommit(){failCommit=true;},
  async turn(c,index,repeat=0){return runtime.turn({auth:{user:{id:OWNER},trainingRevision:'0'},scope:c.scope,objectives:[c.objective],profile:{ownerName:'Synthetic owner',companionName:'Vikki',preferredLanguage:'en'},body:{clientTurnId:c.id.replaceAll('/','-')+'-'+repeat+'-'+index,messages:[{role:'user',content:c.turns[index]}]}});},
  async state(scope){return (await db.query('select state from public.synqme_cognitive_sessions where user_id=$1::uuid and scope_key=$2',[OWNER,scope])).rows[0]?.state;},
  async reminders(){return store.reminders({user:{id:OWNER}});},
  async isolated(){return (await rules(OTHER)).length===0;},close:()=>db.close()
 };
}
