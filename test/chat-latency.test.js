import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

test('usage tracking runs alongside the semantic repeat check and completes before response', async()=>{
 const script=`
 import http from 'node:http';import assert from 'node:assert/strict';import {once} from 'node:events';
 process.env.PORT='0';process.env.DEEPSEEK_PERSON_API_KEY='fixture';process.env.SUPABASE_URL='https://fixture.test';process.env.SUPABASE_PUBLISHABLE_KEY='fixture';
 const nativeFetch=globalThis.fetch;let server, releaseUsage, reviewStarted=false,usageFinished=false;const gate=new Promise(resolve=>{releaseUsage=resolve});
 const listen=http.Server.prototype.listen;http.Server.prototype.listen=function(...args){server=this;return listen.apply(this,args)};
 globalThis.fetch=async(url,options={})=>{const target=String(url);
  if(target.includes('/auth/v1/user'))return Response.json({id:'fixture-user'});
  if(target.includes('/synqme_usage_events')){await gate;usageFinished=true;return new Response('',{status:201})}
  if(target.includes('/rpc/record_synqme_amia_turn'))return Response.json({saved:true});
  if(target.includes('/synqme_decision_states?'))return Response.json([{question:'Where should I put the remote?',status:'response_received'}]);
  if(target.includes('/rest/v1/'))return Response.json([]);
  if(target==='https://api.deepseek.com/chat/completions'){
   const body=JSON.parse(options.body);let content;
   if(body.response_format){reviewStarted=true;releaseUsage();content=JSON.stringify({repeated_question:false});}
   else content='Understood. If a guest leaves a bag in the doorway, should I ask before moving it?';
   return Response.json({choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}});
  }throw Error('Unexpected fixture request');
 };
 await import('./server/index.js');if(!server.listening)await once(server,'listening');
 try {
  const response=await nativeFetch('http://127.0.0.1:'+server.address().port+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture'},body:JSON.stringify({messages:[{role:'assistant',content:'Where should the remote go?'},{role:'user',content:'On the side table.'}],profile:{preferredLanguage:'en'},roomJourney:{activeRoomId:'living_room',unlockedRoomCount:12},conversationContinuity:{scenarioId:'room:living_room',exchanges:[{question:'Where should I put the remote?',answer:'On the side table.',scenarioId:'room:living_room'}]}}),signal:AbortSignal.timeout(2000)});
  assert.equal(response.status,200);assert.equal(reviewStarted,true);assert.equal(usageFinished,true);
 }finally{await new Promise(resolve=>server.close(resolve))}
 `;
 const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),env:process.env});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);child.on('error',reject);child.on('close',code=>resolve({code,output}));});
 assert.equal(result.code,0,result.output);
});

test('keyword and full-text account lookups run concurrently and preserve both results',async()=>{
 const {readFile}=await import('node:fs/promises');const vm=await import('node:vm');
 const source=await readFile(new URL('../src/synqme.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('async function getRelevantPersonaMemories('),source.indexOf('\nfunction findLinkedPreference('));
 let started=0;const resolvers=[];
 const builder=()=>{let method='';const query={select(){return this},eq(){return this},overlaps(){method='keys';return this},in(){return this},textSearch(){method='text';return this},order(){return this},limit(){return this},abortSignal(){return this},then(resolve){started++;resolvers.push(()=>resolve({data:[{id:method}],error:null}));if(started===2)resolvers.forEach(fn=>fn());}};return query;};
 const context=vm.createContext({personaMemoryRecords:[],personaMemoryTableUnavailable:false,personaMemoryWarningShown:false,supabase:{from:builder},cloudUserId:'user-a',buildPersonaMemorySearchKeys:()=>['word:books'],deriveMemoryTopic:()=> 'living_room',PERSONA_MEMORY_SELECT_COLUMNS:'id',AbortSignal,rankPersonaMemories:(_query,items)=>items,console});
 vm.runInContext(body+'\n;globalThis.lookup=getRelevantPersonaMemories;',context);
 const results=await Promise.race([context.lookup('books'),new Promise((_,reject)=>setTimeout(()=>reject(Error('lookups did not run concurrently')),1000))]);
 assert.equal(started,2);assert.deepEqual(Array.from(results, item=>item.id).sort(),['keys','text']);
});
