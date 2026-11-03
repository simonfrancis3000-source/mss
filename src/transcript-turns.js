export function isServiceErrorText(value) {
 return /^(?:i (?:can['’]?t|cannot|couldn['’]?t) generate a reply right now|am[ïi]a is temporarily unavailable|i(?:['’]m| am) having trouble (?:preparing|making a useful connection)|voice connection failed|the voice connection paused)/i.test(String(value||'').trim());
}
export function preferTranscriptTurn(first,second) {
 if(first.transcript_final && !second.transcript_final)return {...second,...first,scenario_id:first.scenario_id||second.scenario_id};
 if(second.transcript_final && !first.transcript_final)return {...first,...second,scenario_id:second.scenario_id||first.scenario_id};
 return String(second.content||'').length>String(first.content||'').length ? {...first,...second,scenario_id:second.scenario_id||first.scenario_id} : {...second,...first,scenario_id:first.scenario_id||second.scenario_id};
}
export function coalesceTranscriptTurns(messages) {
 const result=[],byId=new Map();
 for(const item of messages||[]){
  if(!item || item.transcript_final===false || (item.role==='assistant'&&isServiceErrorText(item.content)))continue;
  const stamp=item.timestamp||item.created_at||item.createdAt;
  const id=item.voice_turn_id || (stamp && Number.isFinite(Date.parse(stamp)) ? new Date(stamp).toISOString() : null);
  const key=id ? item.role+':'+id : null;
  if(key&&byId.has(key)){const i=byId.get(key);result[i]=preferTranscriptTurn(result[i],item);}
  else {if(key)byId.set(key,result.length);result.push({...item});}
 }
 if(result.every(item=>item.timestamp&&Number.isFinite(Date.parse(item.timestamp))))result.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
 return result;
}
export function bestUserTranscript(itemText,toolText){
 const item=String(itemText||'').trim(),tool=String(toolText||'').trim();
 if(!item)return tool;if(!tool)return item;
 return tool.length>item.length&&tool.toLowerCase().startsWith(item.toLowerCase())?tool:item;
}
