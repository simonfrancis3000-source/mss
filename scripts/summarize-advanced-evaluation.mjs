import {readdir,readFile,writeFile,appendFile} from 'node:fs/promises';
const path=process.argv[2]||'reports';const files=(await readdir(path,{recursive:true})).filter(f=>f.endsWith('.json'));
const reports=[];for(const f of files){const r=JSON.parse(await readFile(path+'/'+f,'utf8'));if(Array.isArray(r.results))reports.push(r);}
const results=reports.flatMap(r=>r.results),unique=new Set(results.map(r=>r.id+'/'+r.repeat));
const summary={status:reports.length&&unique.size===results.length?'complete':'incomplete',shards:reports.length,conversations:results.length,plannedConversations:reports.reduce((n,r)=>n+r.plannedConversations,0),passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,userTurns:results.reduce((n,r)=>n+r.turnsCompleted,0),inputTokens:reports.reduce((n,r)=>n+r.inputTokens,0),outputTokens:reports.reduce((n,r)=>n+r.outputTokens,0),evaluationVersions:[...new Set(reports.map(r=>r.version||1))],correctionChecks:[...new Set(reports.map(r=>r.correctionCheck||'all_active_words_v1'))],datasetHashes:[...new Set(reports.map(r=>r.datasetSha256))],failures:{}};
for(const r of results)for(const f of r.failures)summary.failures[f]=(summary.failures[f]||0)+1;
if(unique.size!==results.length||summary.datasetHashes.length!==1||summary.evaluationVersions.length!==1||summary.correctionChecks.length!==1||summary.conversations!==summary.plannedConversations)summary.status='incomplete';
console.log(JSON.stringify(summary,null,2));await writeFile('advanced-summary.json',JSON.stringify(summary,null,2));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'## AMIA advanced conversation evaluation\n\n```json\n'+JSON.stringify(summary,null,2)+'\n```\n');
