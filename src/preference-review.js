import { isUsefulStandalonePreference, memoryIsActive, SENSITIVE_MEMORY_PATTERN } from './persona-memory.js';

const textKey = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase().replace(/[.!?]+$/,'');
export function preferenceIdentity(statement, conditions = [], permission = 'unspecified') {
  const safeConditions = Array.isArray(conditions) ? conditions.map(textKey).filter(Boolean).sort() : [];
  return JSON.stringify([textKey(statement),safeConditions,String(permission || 'unspecified')]);
}
export function isReviewableFragment(value) {
  const text = String(value || '').normalize('NFKC').trim();
  if (!text || isUsefulStandalonePreference(text) || SENSITIVE_MEMORY_PATTERN.test(text)) return false;
  if (/^(?:i\s+)?(?:want|prefer|would like)\s+(?:it|this|that|them|those)\b/i.test(text)) return true;
  return /^(?:(?:all|any|either|both|the first|the second|the third|number)\s+(?:of\s+)?(?:them|those|these|one|two|three|four|five|\d+)|(?:(?:i|we|you)\s+)?(?:(?:would|will|can|should|want to|prefer to)\s+)?(?:(?:quietly|gently|slowly|carefully|just|please)\s+)*(?:do|put|pick|move|leave|take|clean|wash|keep|replace|return|handle|arrange)\s+(?:it|that|this|them|those)\b.*|tell me what (?:you're|you’re|you are) unsure (?:of|about)|quietly|separate|separately)[.!? ]*$/i.test(text);
}

// Only use a matching owner message once. A repeated answer such as “all three”
// is ambiguous unless its timestamp identifies one exact occurrence.
export function findPreferenceSource(entry, messages) {
  const candidates = [entry?.sourceMessage,entry?.source_message,entry?.text,entry?.statement].map(textKey).filter(Boolean);
  const indexes=[];
  for (let i=0;i<(messages || []).length;i++) if(messages[i]?.role==='user' && candidates.includes(textKey(messages[i].content))) indexes.push(i);
  const stamp=Date.parse(entry?.source_timestamp || entry?.recordedAt || '');
  const stamped=Number.isFinite(stamp) ? indexes.filter(i=>Date.parse(messages[i].timestamp || '')===stamp) : [];
  const matches=stamped.length===1?stamped:indexes;
  if(matches.length!==1) return null;
  const index=matches[0], answer=messages[index], previous=messages[index-1];
  if(previous?.role!=='assistant' || !/[?？؟]/u.test(previous.content || '')) return null;
  if(previous.scenario_id && answer.scenario_id && previous.scenario_id!==answer.scenario_id) return null;
  if(SENSITIVE_MEMORY_PATTERN.test(String(previous.content||'')+' '+String(answer.content||''))) return null;
  return { question:String(previous.content).slice(-1200), answer:String(answer.content).slice(0,1200), scenarioId:answer.scenario_id || previous.scenario_id || null };
}
export function collectReviewableFragments(memories, preferences, messages) {
  const result=[], seen=new Set(), covered = new Set();
  for (const item of memories || []) {
    if (item.source_preference_id) covered.add(String(item.source_preference_id));
    if (!memoryIsActive(item) || !['user_stated','user_confirmed'].includes(item.status)) continue;
    if(!isReviewableFragment(item.statement)) continue;
    const key=textKey(item.statement)+'|'+String(item.source_timestamp || item.id);
    if(seen.has(key))continue; seen.add(key);
    result.push({kind:'memory',id:item.id,text:item.statement,source:findPreferenceSource(item,messages)});
  }
  for (const item of preferences || []) {
    if(['superseded','rejected','archived'].includes(String(item.status || item.preference_status || '').toLowerCase()) || covered.has(String(item.id)) || !isReviewableFragment(item.text)) continue;
    const key=textKey(item.text)+'|'+String(item.recordedAt || item.id);
    if(seen.has(key))continue; seen.add(key);
    result.push({kind:'legacy',id:item.id,text:item.text,source:findPreferenceSource(item,messages)});
  }
  return result;
}
export function preferenceDisplayLabel(memory, scenarios, getTasks) {
  const scenario = (scenarios || []).find(item=>item.id===memory?.attributes?.scenario_id);
  const area = scenario && memory?.attributes?.area_id ? getTasks(scenario).find(task=>task.id===memory.attributes.area_id) : null;
  const topic=String(memory?.topic || 'personal preference').replace(/_/g,' ').trim();
  return [scenario?.title || 'Scenario not linked', area?.title || topic].filter(Boolean).join(' · ');
}
