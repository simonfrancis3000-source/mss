export function createCognitiveClient({apiBase,getUserId,getHeaders,fetchImpl=fetch}) {
 let capability=null;const turns=new Map(),pending=new Map();
 return {
  async enabled(advertised,language='en'){
   const user=getUserId();if(!user||advertised?.version!==1||!advertised.languages?.includes(language))return false;
   if(!advertised.requiresAccountCheck)return true;
   if(capability?.user===user&&capability.until>Date.now())return capability.enabled;
   const response=await fetchImpl(apiBase+'/api/runtime/status',{headers:await getHeaders()});if(!response.ok)throw Error('Conversation runtime could not be verified.');
   const value=await response.json();if(getUserId()!==user)throw Error('Account changed.');capability={user,until:Date.now()+60000,enabled:value.enabled===true};return capability.enabled;
  },
  remember(source,runtime){if(!runtime?.turnId)return;turns.set(source,{...runtime,user:getUserId()});while(turns.size>128)turns.delete(turns.keys().next().value);},
  forSource:source=>turns.get(source),
  report({turnId,deliveryKey,channel,status,sequence}){
   const user=getUserId();if(!user||![...turns.values()].some(t=>t.user===user&&t.turnId===turnId))return Promise.resolve();
   const key=turnId+':'+deliveryKey;
   const operation=async()=>{if(getUserId()!==user)return;const headers=await getHeaders();for(let attempt=0;attempt<2;attempt++){try{const r=await fetchImpl(apiBase+'/api/runtime/delivery',{method:'POST',headers,body:JSON.stringify({turnId,deliveryKey,channel,status,sequence})});if(r.ok||r.status<500)return;}catch{}}};
   const result=(pending.get(key)||Promise.resolve()).then(operation).catch(()=>{});pending.set(key,result);void result.finally(()=>{if(pending.get(key)===result)pending.delete(key);});return result;
  }
 };
}
