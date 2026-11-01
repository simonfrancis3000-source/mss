export function ruleSourceReferences(existing, timestamp) {
  const time = Date.parse(timestamp || '');
  const refs = (Array.isArray(existing) ? existing : []).filter((ref) =>
    ref?.conversation_key==='main' && ref.role==='user' && Number.isFinite(Date.parse(ref.message_timestamp || ''))
  ).map((ref) => ({ conversation_key:'main', role:'user', message_timestamp: new Date(ref.message_timestamp).toISOString() }));
  if (Number.isFinite(time) && time>=Date.UTC(2010,0,1) && time<=Date.now()+300000) {
    refs.push({ conversation_key:'main', role:'user', message_timestamp:new Date(time).toISOString() });
  }
  return [...new Map(refs.map((ref) => [ref.message_timestamp,ref])).values()].slice(-8);
}

export function scenarioReviewRecord({ userId, scenarioId, startedAt, checks, userTurnCount, reviewedTaskIds }) {
  if (!userId || !SCENARIOS.some((scenario) => scenario.id===scenarioId) || !Number.isFinite(Date.parse(startedAt || '')) || !Array.isArray(checks) || checks.length!==3 || !checks.every((value) => value===true) || !Number.isInteger(userTurnCount) || userTurnCount<1) return null;
  const scenario = SCENARIOS.find(item => item.id === scenarioId);
  if (reviewedTaskIds !== undefined && (!Array.isArray(reviewedTaskIds) || scenarioTasks(scenario).some(task => !reviewedTaskIds.includes(task.id)))) return null;
  return {
    user_id:userId, evaluation_key:'review:'+scenarioId+':'+new Date(startedAt).toISOString(), scope_key:scenarioId,
    evaluation_kind:'scenario_self_review', origin:'user_self_report', outcome:'self_reported_complete',
    checks:{ preferences_reviewed:true,boundaries_reviewed:true,exceptions_reviewed:true,user_turn_count:Math.min(userTurnCount,10000), ...(reviewedTaskIds ? {reviewed_task_ids:scenarioTasks(scenario).map(task => task.id)} : {}) },
    source_refs:[{ scenario_id:scenarioId,started_at:new Date(startedAt).toISOString() }],engine_version:'persistence-v1'
  };
}
import { SCENARIOS, scenarioTasks } from './scenario-journey.js';


export function scenarioTestRecord(userId, report) {
  if (!userId || !report || !/^[a-zA-Z0-9._:-]{1,120}$/.test(report.run_id || '') || !SCENARIOS.some((scenario) => scenario.id===report.scenario_id)
    || !/^[a-zA-Z0-9._:-]{1,80}$/.test(report.engine_version || '') || !Array.isArray(report.assertions) || report.assertions.length<1 || report.assertions.length>50
    || !report.assertions.every((item) => item && /^[a-zA-Z0-9._:-]{1,100}$/.test(item.id || '') && typeof item.passed==='boolean')
    || new Set(report.assertions.map((item) => item.id)).size!==report.assertions.length) return null;
  const assertions=report.assertions.map(({id,passed}) => ({id,passed}));
  const passed=assertions.filter((item) => item.passed).length;
  return {user_id:userId,evaluation_key:'test:'+report.run_id,scope_key:report.scenario_id,evaluation_kind:'scenario_test',
    origin:'test_runner',outcome:passed===assertions.length?'passed':'failed',engine_version:report.engine_version,
    checks:{assertions,total:assertions.length,passed,failed:assertions.length-passed},source_refs:[]};
}
