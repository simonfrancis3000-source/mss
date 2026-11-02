import { isUsefulStandalonePreference } from './persona-memory.js';

const allowed = item => item && ['user_stated','user_confirmed'].includes(item.status) && isUsefulStandalonePreference(item.statement);
export function scenarioSummary(scenario, tasks, memories) {
  const rules=(Array.isArray(memories)?memories:[]).filter(item=>allowed(item) && item.attributes?.scenario_id===scenario?.id);
  const groups=[];
  for(const task of tasks||[]) {
    const entries=rules.filter(item=>item.attributes?.area_id===task.id);
    if(entries.length)groups.push({id:task.id,title:task.title,rules:entries});
  }
  const taskIds=new Set((tasks||[]).map(t=>t.id));
  const unassigned=rules.filter(item=>!taskIds.has(item.attributes?.area_id));
  if(unassigned.length)groups.push({id:null,title:'Other preferences',rules:unassigned});
  return groups;
}
export function passportEligibleMemories(memories) {
  return (Array.isArray(memories)?memories:[]).filter(allowed).filter(item=>typeof item.id==='string');
}
export function buildPersonaPassport(memories,selectedIds,scenarios,generatedAt=new Date().toISOString()) {
  const selected=new Set(selectedIds || []), byScenario=new Map((scenarios||[]).map(item=>[item.id,item.title]));
  const rules=passportEligibleMemories(memories).filter(item=>selected.has(item.id)).map(item=>({
    statement:item.statement, status:item.status, conditions:Array.isArray(item.conditions)?item.conditions.filter(value=>typeof value==='string'):[],
    permission_policy:['ask_first','allowed','prohibited'].includes(item.permission_policy)?item.permission_policy:'unspecified',
    scenario:byScenario.get(item.attributes?.scenario_id)||null, scenario_id:byScenario.has(item.attributes?.scenario_id)?item.attributes.scenario_id:null,
    area_id:typeof item.attributes?.area_id==='string'?item.attributes.area_id:null,
    owner_marked_general:item.attributes?.apply_across_scenarios===true
  }));
  return {schema:'app.mysecondself.persona-passport',schema_version:'1.0.0',generated_at:generatedAt,
    note:'Owner-selected personal preferences for review. This is not a robot control command, proof of compatibility or a safety assessment.',preferences:rules};
}
export function passportText(passport) {
  const labels={ask_first:'Ask first',allowed:'Owner explicitly allowed',prohibited:'Prohibited',unspecified:'Not specified'};
  return ['MYSECONDSELF PERSONA PASSPORT','Owner-selected preferences for review',passport.note,'',...passport.preferences.flatMap((rule,index)=>[
    `${index+1}. ${rule.scenario || 'Scenario not linked'}`,rule.statement,
    ...(rule.conditions.length?['Conditions: '+rule.conditions.join('; ')]:[]),
    'Permission: '+(labels[rule.permission_policy]||labels.unspecified),
    ...(rule.owner_marked_general?['Owner marked this as general guidance, subject to its stated conditions.']:[]),''
  ])].join('\n');
}
