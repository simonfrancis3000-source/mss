// Isolated process fixture. No external requests leave this process.
const memories=[];
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  const body = options.body ? JSON.parse(options.body) : {};
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  if (url.endsWith('/auth/v1/user')) return response({id:'test-user', email:'test@example.test'});
  if (url.includes('/rest/v1/synqme_usage_events')) return response({});
  if (url.includes('/rest/v1/rpc/record_synqme_amia_turn')) return response({saved:true,evaluation_id:'fixture-evaluation'});
  if (url.includes('/rest/v1/synqme_persona_memories')) {
    if (options.method==='POST') { memories.push({...body,id:'fixture-memory'}); return response([memories.at(-1)]); }
    return response(memories);
  }
  if (url.includes('/rest/v1/synqme_decision_states')) return response([]);
  // The actual application stores these records in persona memory. Do not
  // invent normalized appliance rows in the fixture.
  if (url.includes('/rest/v1/synqme_appliance_references')) return response([]);
  if (url.endsWith('/v1/tools/search')) return response({results:[{url:'https://bosch-home.com/manual',title:'User manual'}]});
  if (url.endsWith('/v1/tools/fetch')) return response({title:'User manual', content:'Model ABC1234/01 user manual. A delicate programme is available.'});
  if (url.endsWith('/chat/completions')) {
    const isExtract = body.response_format?.type === 'json_object';
    const content = isExtract ? JSON.stringify({type:'dishwasher',brand:'Bosch',model:'ABC1234/01'}) : 'The manual mentions a delicate programme. Would you like me to use it for your glasses?';
    return response({choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}});
  }
  throw new Error('Unexpected network request in test fixture');
};
