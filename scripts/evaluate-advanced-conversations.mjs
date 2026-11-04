// Synthetic conversations only. Real runtime + migration SQL in local PGlite.
import {createHash} from 'node:crypto';
import {cases} from '../evals/advanced/cases.mjs';
import {createHarness} from '../evals/advanced/harness.mjs';
import {createCognitiveProvider} from '../server/cognitive-provider.js';
const key=process.env.DEEPSEEK_PERSON_API_KEY||process.env.DEEPSEEK_API_KEY;
if(!key){console.log(JSON.stringify({status:'blocked',reason:'missing_model_credentials'}));process.exit(2);}
const phase=process.env.AMIA_ADVANCED_PHASE||'development',shard=Number(process.env.AMIA_ADVANCED_SHARD)||0,shards=Number(process.env.AMIA_ADVANCED_SHARDS)||15;
const selected=cases.filter(c=>phase==='reserved'?c.split==='reserved':c.split!=='reserved').filter((_,i)=>i%shards===shard);
const repeats=3,results=[];let inputTokens=0,outputTokens=0;
const provider=createCognitiveProvider({key,model:process.env.DEEPSEEK_CHAT_MODEL||'deepseek-flash',onUsage:async d=>{inputTokens+=d?.usage?.prompt_tokens||0;outputTokens+=d?.usage?.completion_tokens||0;}});
let setupFailure=false;
outer:for(const c of selected)for(let repeat=0;repeat<repeats;repeat++){
 const h=await createHarness(provider),trace=[],failures=[];const started=Date.now();
 const check=(ok,code)=>{if(!ok)failures.push(code);};
 try{
  let lastQuestion;
  for(let i=0;i<c.turns.length;i++){
   if(i===8&&c.difficult){h.failNextCommit();let failed=false;try{await h.turn(c,i,repeat);}catch{failed=true;}check(failed,'failed_write_not_reported');check((await h.reminders()).length===0,'failed_write_created_reminder');}
   const response=await h.turn(c,i,repeat);await h.drain();
   trace.push({index:i,user:c.turns[i],reply:response.reply,modelCalls:response.runtime.modelCalls});
   if(i===0)check((await h.rules()).some(r=>r.statement.toLowerCase().includes(c.oldValue)),'initial_preference_missing');
   if(i===4){const active=await h.rules();check(active.some(r=>r.statement.toLowerCase().includes(c.newValue)),'correction_missing');check(!active.some(r=>r.statement.toLowerCase().includes(c.oldValue)&&!r.statement.toLowerCase().includes(c.newValue)&&r.status!=='conflicting'),'stale_preference_active');}
   if(i===5){check(response.reply.toLowerCase().includes(c.newValue),'recall_missing_current_value');lastQuestion=(await h.state(c.scope))?.lastQuestion;}
   if(i===7&&lastQuestion)check(response.reply.includes(lastQuestion),'resume_lost_question');
   if(i===8){const replay=await h.turn(c,i,repeat);check(replay.runtime.replayed===true,'retry_not_replayed');check((await h.reminders()).length===1,'duplicate_or_missing_reminder');}
   if(i===10)check(!(await h.rules()).some(r=>r.permission_policy==='allowed'),'negated_permission_became_allowed');
   if(i===11)check(response.reply.toLowerCase().includes(c.newValue),'final_recall_missing_current_value');
   check(await h.isolated(),'cross_owner_memory_leak');
  }
 }catch(error){failures.push(error.code||error.message);setupFailure=[400,401,402,403,404,422,429].includes(error.providerStatus);}
 results.push({id:c.id,repeat,status:failures.length?'failed':'passed',failures,turnsCompleted:trace.length,modelCalls:h.modelCalls,durationMs:Date.now()-started,trace});
 await h.close();
 console.error(JSON.stringify({id:c.id,repeat,failed:failures.length,turns:trace.length}));
 if(setupFailure)break outer;
}
const report={version:1,phase,shard,shards,datasetSha256:createHash('sha256').update(JSON.stringify(cases)).digest('hex'),plannedConversations:selected.length*repeats,completedConversations:results.length,userTurns:results.reduce((n,r)=>n+r.turnsCompleted,0),passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,inputTokens,outputTokens,results,limitations:'Deterministic checks of real runtime and migration SQL with live DeepSeek. Local PGlite adapters do not validate hosted PostgREST/Auth or device audio. Lexical memory checks do not establish full semantic equivalence or conversational enjoyment. Human evaluation is separate. Dataset has 50 topic families and 200 scripted variants; repeated variants are not independent users.'};
console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
