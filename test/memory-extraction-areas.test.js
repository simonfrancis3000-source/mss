import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('memory extraction preserves several decisions, validates area IDs and retries malformed output', async () => {
  const script = `
    import http from 'node:http'; import assert from 'node:assert/strict'; import {once} from 'node:events';
    process.env.PORT='0'; process.env.DEEPSEEK_PERSON_API_KEY='fixture'; process.env.SUPABASE_URL='https://fixture.test'; process.env.SUPABASE_PUBLISHABLE_KEY='fixture';
    const nativeFetch=globalThis.fetch; let server,calls=0;
    const listen=http.Server.prototype.listen; http.Server.prototype.listen=function(...args){server=this;return listen.apply(this,args)};
    globalThis.fetch=async(url,options={})=>{
      const target=String(url);
      if(target.includes('/auth/v1/user'))return Response.json({id:'fixture-user'});
      if(target.includes('/rest/v1/'))return Response.json([]);
      if(target==='https://api.deepseek.com/chat/completions'){
        const request=JSON.parse(options.body);const data=JSON.parse(request.messages[1].content);
        assert.ok(data.learningObjectives.some(area=>area.id==='tidying')); assert.match(data.messages.at(-1).content,/END_OF_LONG_ANSWER/);
        calls++;
        const content = calls===1 ? JSON.stringify({eligible:true,memories:[
          {statement:'I prefer cushions arranged in the evening.',topic:'living_room',kind:'preference',status:'user_stated',attributes:{area_id:'tidying'},conditions:['in the evening']},
          {statement:'I do not want my papers moved.',topic:'living_room',kind:'boundary',status:'user_stated',permission_policy:'prohibited',attributes:{area_id:'made-up-area'}}
        ]}) : '{malformed';
        return Response.json({choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}});
      }
      throw Error('unexpected request');
    };
    await import('./server/index.js'); if(!server.listening)await once(server,'listening');
    try {
      const send=()=>nativeFetch('http://127.0.0.1:'+server.address().port+'/api/memory/extract',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture'},body:JSON.stringify({scenarioId:'room:living_room',messages:[{role:'assistant',content:'How should I tidy?'},{role:'user',content:'Cushions in the evening, but leave my papers. ' + 'detail '.repeat(240) + 'END_OF_LONG_ANSWER'}]})});
      let response=await send();let result=await response.json();assert.equal(response.status,200);assert.equal(result.memories.length,2);
      assert.equal(result.memories[0].attributes.area_id,'tidying');assert.equal(result.memories[1].attributes.area_id,null);assert.equal(result.memories[1].permission_policy,'prohibited');
      response=await send();result=await response.json();assert.equal(response.status,502);assert.match(result.error,/retried/);
    }finally{await new Promise(resolve=>server.close(resolve));}
  `;
  const result = await new Promise((resolve,reject) => {
    const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),env:process.env});let output='';
    child.stdout.on('data',data=>output+=data); child.stderr.on('data',data=>output+=data);child.on('error',reject);child.on('close',code=>resolve({code,output}));
  });
  assert.equal(result.code,0,result.output);
});
