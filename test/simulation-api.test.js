import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('simulation API scopes evidence to the signed-in scenario and rejects invented sources', async () => {
 const script = `
   import http from 'node:http'; import assert from 'node:assert/strict'; import {once} from 'node:events';
   process.env.PORT='0';process.env.DEEPSEEK_PERSON_API_KEY='fixture';process.env.SUPABASE_URL='https://fixture.test';process.env.SUPABASE_PUBLISHABLE_KEY='fixture';
   const nativeFetch=globalThis.fetch;let server;let mode='valid';let generatedContext;
   const listen=http.Server.prototype.listen;http.Server.prototype.listen=function(...args){server=this;return listen.apply(this,args)};
   globalThis.fetch=async(url,options={})=>{
     const target=String(url);
     if(target.includes('/auth/v1/user'))return Response.json({id:'owner-one'});
     if(target.includes('synqme_persona_memories?')){
       const params=new URL(target).searchParams;assert.equal(params.get('user_id'),'eq.owner-one');if(params.has('attributes->>apply_across_scenarios')) return Response.json(mode==='general'?[{id:'global',statement:'Ask me before moving my private papers.',status:'user_confirmed',conditions:['Whenever I am away'],permission_policy:'ask_first',attributes:{apply_across_scenarios:true}}]:[]);assert.equal(params.get('attributes->>scenario_id'),'eq.room:living_room');
       return Response.json(mode==='empty'?[]:[
        {id:'m1',statement:'Leave my papers on the coffee table.',status:'user_confirmed',conditions:[],permission_policy:'prohibited',attributes:{scenario_id:'room:living_room',area_id:'tidying'}},
        {id:'bad',statement:'We already covered that',status:'user_stated',attributes:{scenario_id:'room:living_room',area_id:'tidying'}},
        {id:'other',statement:'Use the dishwasher in the kitchen.',status:'user_stated',attributes:{scenario_id:'room:kitchen',area_id:'dishwashing'}},
        {id:'conflict',statement:'Move my papers whenever you like.',status:'conflicting',attributes:{scenario_id:'room:living_room',area_id:'tidying'}}]);
     }
     if(target.includes('/rest/v1/'))return Response.json([]);
     if(target==='https://api.deepseek.com/chat/completions'){
       const body=JSON.parse(options.body); const system=body.messages[0].content; let value;
       if(system.startsWith('Review a hypothetical')) {const review=JSON.parse(body.messages[1].content);if(mode==='general')assert.ok(review.applicable_rules.some(rule=>rule.permission_policy==='ask_first'));value=JSON.stringify({supported:mode!=='unsupported'});}
       else { generatedContext=JSON.parse(body.messages[1].content);assert.equal(generatedContext.memories.length,mode==='empty'?0:mode==='general'?2:1);if(mode==='general')assert.ok(generatedContext.memories.some(rule=>rule.owner_marked_general===true));
        value=JSON.stringify({situation:'Papers are on the coffee table.',proposed_response:'I would leave your papers where they are.',evidence_ids:mode==='invented'?['unknown']:mode==='empty'?[]:['m1'],follow_up_question:''}); }
       return Response.json({choices:[{finish_reason:'stop',message:{content:value}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}});
     }
     throw Error('Unexpected external request');
   };
   await import('./server/index.js');if(!server.listening)await once(server,'listening');
   try{
     const url='http://127.0.0.1:'+server.address().port+'/api/simulation';
     const request=()=>nativeFetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture'},body:JSON.stringify({scenarioId:'room:living_room',areaId:'tidying',preferredLanguage:'en'})});
     let response=await request();let result=await response.json();assert.equal(response.status,200);assert.equal(result.sources.length,1);assert.equal(result.sources[0].id,'m1');assert.match(result.proposed_response,/leave your papers/);
     mode='general';response=await request();assert.equal(response.status,200);
     mode='empty';response=await request();result=await response.json();assert.equal(response.status,200);assert.match(result.proposed_response,/don't have a linked preference/);
     mode='invented';response=await request();assert.equal(response.status,502);
     mode='unsupported';response=await request();result=await response.json();assert.equal(response.status,200);assert.equal(result.evidence_status,'needs_information');assert.match(result.proposed_response,/ask you first/);
     response=await nativeFetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,401);
   }finally{await new Promise(resolve=>server.close(resolve));}
 `;
 const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),env:process.env});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('error',reject);child.on('close',code=>resolve({code,output}));});
 assert.equal(result.code,0,result.output);
});
