import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

test('chat route repairs premature room changes and carries room depth, names and selected language', async () => {
  const script = `
    import http from 'node:http';
    import assert from 'node:assert/strict';
    import {once} from 'node:events';
    process.env.PORT='0'; process.env.DEEPSEEK_PERSON_API_KEY='synthetic-test';
    process.env.SUPABASE_URL='https://synthetic.test';process.env.SUPABASE_PUBLISHABLE_KEY='synthetic-test';
    const nativeFetch=globalThis.fetch;let server,calls=0;const prompts=[];
    const listen=http.Server.prototype.listen;
    http.Server.prototype.listen=function(...args){server=this;return listen.apply(this,args)};
    globalThis.fetch=async(url,options={})=>{
      const target=String(url);
      if(target.includes('synthetic.test/auth/v1/user'))return Response.json({id:'synthetic-user',email:'fixture@example.test'});
      if(target.includes('synthetic.test/rest/v1/'))return Response.json(target.includes('/rpc/')?{saved:true}:[]);
      if(target==='https://api.deepseek.com/chat/completions'){
        const body=JSON.parse(options.body);prompts.push(body.messages[0].content);calls++;
        return Response.json({choices:[{finish_reason:'stop',message:{content:calls===1?'Now that the living room is mostly settled, shall we move on to the kitchen?':'Simon, we will leave the candle alone. How do you like the living room lighting when you are reading?'}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}});
      }
      throw Error('Unexpected external request');
    };
    await import('./server/index.js');if(!server.listening)await once(server,'listening');
    try{
      const response=await nativeFetch('http://127.0.0.1:'+server.address().port+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-test'},body:JSON.stringify({messages:[{role:'assistant',content:'Where should I put the remote?'},{role:'user',content:'Put it somewhere sensible.'}],profile:{ownerName:'Simon',robotName:'Freya',preferredLanguage:'de'},roomJourney:{activeRoomId:'living_room',completedTaskIds:['boundaries'],completionConfirmed:false,unlockedRoomCount:12},welcomeBack:true})});
      const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
      assert.equal(calls,2);assert.match(body.reply,/living room lighting/);
      assert.match(prompts[0],/30 minutes/);assert.match(prompts[0],/NOT confirmed/);
      assert.match(prompts[0],/Spills, candles and hazards/);assert.match(prompts[0],/Simon/);
      assert.match(prompts[0],/German/);assert.match(prompts[0],/12 hours/);
    }finally{await new Promise(resolve=>server.close(resolve));}
  `;
  const result = await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),env:process.env});
    let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
    child.on('error',reject);child.on('close',code=>resolve({code,output}));
  });
  assert.equal(result.code,0,result.output);
});
