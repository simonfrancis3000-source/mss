// The runner submits measured assertion results for its authenticated test
// account. It never accepts an account ID or a claimed overall pass/fail score.
import { readFile } from 'node:fs/promises';
import { scenarioTestRecord } from '../src/amia-persistence.js';

const url=String(process.env.SUPABASE_URL || '').replace(/\/+$/,'');
const key=process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const token=process.env.SUPABASE_TEST_ACCESS_TOKEN;
if (!url || !key || !token || !process.argv[2]) throw new Error('Provide a report path and SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_TEST_ACCESS_TOKEN in the environment.');
const headers={apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json'};
const account=await fetch(url+'/auth/v1/user',{headers,signal:AbortSignal.timeout(10000)});
if (!account.ok) throw new Error('The test account session is invalid.');
const user=await account.json();
if (user.is_anonymous) throw new Error('A registered test account is required.');
const record=scenarioTestRecord(user.id,JSON.parse(await readFile(process.argv[2],'utf8')));
if (!record) throw new Error('Invalid evaluation report. Use a valid scenario ID, unique assertion IDs and measured boolean results.');
const response=await fetch(url+'/rest/v1/synqme_evaluation_records?on_conflict=user_id,evaluation_key',{
  method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(record),signal:AbortSignal.timeout(10000)
});
if (!response.ok) throw new Error('The evaluation could not be saved (HTTP '+response.status+').');
console.log('Recorded scenario test: '+record.outcome+' ('+record.checks.passed+'/'+record.checks.total+' assertions).');
