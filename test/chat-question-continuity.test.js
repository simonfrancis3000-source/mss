import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('the chat route rejects an older paraphrased question and records only its checked replacement', async () => {
  const script = `
    import http from 'node:http';
    import assert from 'node:assert/strict';
    import { once } from 'node:events';
    process.env.PORT='0'; process.env.DEEPSEEK_PERSON_API_KEY='fixture';
    process.env.SUPABASE_URL='https://fixture.test'; process.env.SUPABASE_PUBLISHABLE_KEY='fixture';
    const nativeFetch=globalThis.fetch; let server; const calls=[],observations=[];
    const listen=http.Server.prototype.listen;
    http.Server.prototype.listen=function(...args){server=this;return listen.apply(this,args)};
    globalThis.fetch=async(url,options={})=>{
      const target=String(url);
      if(target.includes('fixture.test/auth/v1/user'))return Response.json({id:'fixture-user'});
      if(target.includes('/synqme_decision_states?')){
        const params=new URL(target).searchParams;
        assert.equal(params.get('user_id'),'eq.fixture-user');
        assert.equal(params.get('or'),'(scope_key.eq.room:living_room,scope_key.like.room:living_room:*)');
        return Response.json([{decision_key:'old-question',question:'Where should I leave the remote controls?',status:'response_received'}]);
      }
      if(target.includes('/rpc/record_synqme_amia_turn')){observations.push(JSON.parse(options.body));return Response.json({saved:true});}
      if(target.includes('fixture.test/rest/v1/'))return Response.json([]);
      if(target==='https://api.deepseek.com/chat/completions'){
        const body=JSON.parse(options.body); calls.push(body);
        let content;
        if(body.response_format){
          const context=JSON.parse(body.messages[1].content);
          assert.equal(context.exchanges[0].answer,'On the side table.');
          content=JSON.stringify({repeated_question:context.candidate.includes('handset'),matched_question:'Where should I leave the remote controls?',reason:'Same placement decision, already answered.'});
        }else if(body.messages[0].content.includes('QUESTION CONTINUITY CORRECTION')){
          content='I will leave it on the side table. If a visitor leaves a bag blocking the doorway, should I ask them or you to move it?';
        }else{
          assert.match(body.messages[0].content,/EARLIER QUESTION AND ANSWER CONTINUITY/);
          assert.match(body.messages[0].content,/On the side table/);
          content='Understood. Where would you prefer the television handset kept?';
        }
        return Response.json({choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}});
      }
      throw Error('Unexpected external request');
    };
    await import('./server/index.js'); if(!server.listening)await once(server,'listening');
    try{
      const response=await nativeFetch('http://127.0.0.1:'+server.address().port+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture'},body:JSON.stringify({
        messages:[{role:'assistant',content:'Shall we continue with the living room?'},{role:'user',content:'Yes, please continue.'}],
        profile:{robotName:'Freddie',preferredLanguage:'en'},roomJourney:{activeRoomId:'living_room',activeTaskId:'guests',completedTaskIds:[],unlockedRoomCount:12},
        conversationContinuity:{scenarioId:'room:living_room',exchanges:[{question:'Where should I leave the remote controls?',answer:'On the side table.',scenarioId:'room:living_room'}]}
      })});
      const result=await response.json(); assert.equal(response.status,200,JSON.stringify(result));
      assert.match(result.reply,/bag blocking the doorway/); assert.doesNotMatch(result.reply,/handset/);
      assert.equal(calls.length,4); assert.equal(result.usedFallback,true);
      assert.equal(observations.length,1); assert.match(observations[0].p_question,/bag blocking the doorway/);
      assert.doesNotMatch(observations[0].p_question,/handset/);
    }finally{await new Promise(resolve=>server.close(resolve));}
  `;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), env: process.env });
    let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
    child.on('error', reject); child.on('close', code => resolve({ code, output }));
  });
  assert.equal(result.code, 0, result.output);
});
