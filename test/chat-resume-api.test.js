import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
test('chat resumes the unanswered products question rather than following a model topic change, then accepts the answer',async()=>{
 const script=`
 import http from 'node:http';import assert from 'node:assert/strict';import {once} from 'node:events';
 process.env.PORT='0';process.env.DEEPSEEK_PERSON_API_KEY='fixture';process.env.SUPABASE_URL='https://fixture.test';process.env.SUPABASE_PUBLISHABLE_KEY='fixture';
 const native=globalThis.fetch;let server,answering=false,reviews=0;const observations=[];
 const listen=http.Server.prototype.listen;http.Server.prototype.listen=function(...args){server=this;return listen.apply(this,args)};
 globalThis.fetch=async(url,options={})=>{
  const path=String(url);
  if(path.includes('/auth/v1/user'))return Response.json({id:'fixture-user'});
  if(path.includes('/rpc/record_synqme_amia_turn')){observations.push(JSON.parse(options.body));return Response.json({saved:true});}
  if(path.includes('/synqme_decision_states?'))return Response.json([{question:'Where do you keep them?',status:'response_received'}]);
  if(path.includes('/rest/v1/'))return Response.json([]);
  if(path==='https://api.deepseek.com/chat/completions'){
   const body=JSON.parse(options.body);let content;
   if(body.response_format){reviews++;content=JSON.stringify({repeated_question:false});}
   else if(answering)content='I will use only the approved products under the sink. Should I ask before using the last bottle?';
   else {assert.match(body.messages[0].content,/RESUMING AN UNANSWERED QUESTION/);content='Let us move to another area. Is anything in the kitchen off limits?';}
   return Response.json({choices:[{finish_reason:'stop',message:{content}}]});
  }throw Error('Unexpected request');
 };
 await import('./server/index.js');if(!server.listening)await once(server,'listening');
 const history=[{role:'assistant',content:'We were discussing the cleaning products you approve for me to use.\\n\\nWhere do you keep them?',scenario_id:'room:kitchen'},{role:'user',content:'What next?',scenario_id:'room:kitchen'},{role:'assistant',content:'Is anything in the kitchen off limits?',scenario_id:'room:kitchen'},{role:'user',content:'What next?',scenario_id:'room:kitchen'}];
 const request=async messages=>{const response=await native('http://127.0.0.1:'+server.address().port+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture'},body:JSON.stringify({messages,profile:{ownerName:'Simon',robotName:'Freddie',preferredLanguage:'en'},roomJourney:{activeRoomId:'kitchen',unlockedRoomCount:12},conversationContinuity:{scenarioId:'room:kitchen',exchanges:[{question:'Where do you keep them?',answer:'What next?',scenarioId:'room:kitchen'}]}})});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
 try {
  const resumed=await request(history);assert.equal(resumed.resumed,true);assert.match(resumed.reply,/Welcome back, Simon/);assert.match(resumed.reply,/cleaning products/);assert.match(resumed.reply,/Where do you keep them/);assert.doesNotMatch(resumed.reply,/off limits/);assert.equal(reviews,0);assert.equal(observations[0].p_response_question_key,null);assert.equal(observations[0].p_question,'Where do you keep them?');
  answering=true;const next=await request([...history,{role:'assistant',content:resumed.reply},{role:'user',content:'Under the sink.'}]);assert.equal(next.resumed,undefined);assert.match(next.reply,/last bottle/);assert.ok(observations[1].p_response_question_key);assert.equal(reviews,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
 `;
 const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),env:process.env});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);child.on('error',reject);child.on('close',code=>resolve({code,output}));});assert.equal(result.code,0,result.output);
});
