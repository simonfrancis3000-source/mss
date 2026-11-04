// Live-model evaluation uses synthetic owners and never writes real accounts.
// Run: DEEPSEEK_PERSON_API_KEY=... node scripts/evaluate-cognitive-runtime.mjs
import {cognitiveCases} from '../evals/cognitive-cases.mjs';
import {createCognitiveProvider,generateCheckedCognitiveTurn} from '../server/cognitive-provider.js';
import {validateMemoryProposals} from '../server/cognitive-memory.js';
const key=process.env.DEEPSEEK_PERSON_API_KEY||process.env.DEEPSEEK_API_KEY;
if(!key){console.log(JSON.stringify({status:'blocked',mode:'live_model',reason:'DeepSeek credentials are not present in this execution environment.'},null,2));process.exit(2);}
const model=process.env.DEEPSEEK_CHAT_MODEL||'deepseek-flash';
const limit=Math.max(1,Math.min(150,Number(process.env.AMIA_EVAL_LIMIT)||30));
let inputTokens=0,outputTokens=0,stoppedEarly=false;const durations=[],results=[];
const provider=createCognitiveProvider({key,model,onUsage:async data=>{inputTokens+=Number(data?.usage?.prompt_tokens)||0;outputTokens+=Number(data?.usage?.completion_tokens)||0;}});
for(const c of cognitiveCases.filter(c=>c.split==='held-out').slice(0,limit)){
 const started=performance.now();
 try{
  const state={messages:[{role:'assistant',content:c.domain.question},{role:'user',content:c.domain.instruction}],lastQuestion:null,dispositions:[{question:c.domain.question,status:'response_received'}]};
  const objectives=[{id:c.domain.id,title:c.domain.title}];
  const context={scope:c.domain.scope,language:'en',state,latestUser:c.domain.exception,activeTraining:true,objectives,memory:[],plan:{selected:objectives[0]},intent:'answer'};
  const {proposal,attempts}=await generateCheckedCognitiveTurn({generate:provider,context,objectives,quality:{state,active:true}});
  const memories=validateMemoryProposals(proposal.memoryProposals,{latestUser:context.latestUser,knownRules:[],objectives,turnKey:c.id,scope:c.domain.scope});
  results.push({id:c.id,status:'passed',attempts,groundedMemoryCount:memories.length,reply:proposal.reply});
 }catch(error){results.push({id:c.id,status:'failed',errorCode:error.code||'provider_unavailable',attempts:error.attempts || [],...(error.providerStatus?{providerStatus:error.providerStatus}:{})});
  if([400,401,402,403,404,422,429].includes(error.providerStatus))stoppedEarly=true;
 }
 durations.push(performance.now()-started);if(stoppedEarly)break;
}
const sorted=durations.toSorted((a,b)=>a-b);const percentile=q=>sorted[Math.max(0,Math.ceil(sorted.length*q)-1)]||0;
const report={status:results.every(r=>r.status==='passed')?'passed':'failed',mode:'live_model',model,sampleCount:results.length,plannedSampleCount:Math.min(limit,cognitiveCases.filter(c=>c.split==='held-out').length),stoppedEarly,firstPassPassedCount:results.filter(r=>r.attempts?.[0]?.qualityViolation===null&&!r.attempts?.[0]?.errorCode).length,repairCount:results.reduce((n,r)=>n+Math.max(0,(r.attempts?.length || 0)-1),0),generationCalls:results.reduce((n,r)=>n+(r.attempts?.length || 0),0),p50Ms:Math.round(percentile(.5)),p95Ms:Math.round(percentile(.95)),inputTokens,outputTokens,results,
 limitations:'This measures the shared runtime generation/validation path, including at most one repair, on synthetic template-based held-out checks across ten domain contexts. First-pass failures remain visible in attempts and aggregate counts. It does not replace human semantic review, authenticated end-to-end/device tests or Phonic listening tests.'};
console.log(JSON.stringify(report,null,2));if(report.status!=='passed')process.exitCode=1;
