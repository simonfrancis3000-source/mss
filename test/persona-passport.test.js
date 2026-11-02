import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarioSummary,passportEligibleMemories,buildPersonaPassport,passportText} from '../src/persona-passport.js';

const scenarios=[{id:'room:living_room',title:'Living Room'},{id:'room:kitchen',title:'Kitchen'}];
const records=[
 {id:'one',statement:'Leave my papers on the coffee table.',status:'user_confirmed',conditions:['Unless I ask you to move them'],permission_policy:'prohibited',attributes:{scenario_id:'room:living_room',area_id:'tidying',apply_across_scenarios:true}},
 {id:'two',statement:'Ask before moving fragile bowls.',status:'user_stated',attributes:{scenario_id:'room:kitchen'}},
 {id:'three',statement:'Put everything on the shelf.',status:'inferred_pending_confirmation',attributes:{scenario_id:'room:living_room'}},
 {id:'four',statement:'Pick them up',status:'user_stated',attributes:{scenario_id:'room:living_room'}}
];
test('scenario summary uses only useful owner-stated rules belonging to the scenario',()=>{
 const groups=scenarioSummary(scenarios[0],[{id:'tidying',title:'Tidying'}],records);
 assert.equal(groups.length,1);assert.equal(groups[0].title,'Tidying');assert.deepEqual(groups[0].rules.map(r=>r.id),['one']);
});
test('passport exports only selected eligible preferences and retains conditions without personal chat data',()=>{
 assert.deepEqual(passportEligibleMemories(records).map(r=>r.id),['one','two']);
 const passport=buildPersonaPassport(records,new Set(['one','three','missing']),scenarios,'2026-01-01');
 assert.equal(passport.preferences.length,1);assert.equal(passport.preferences[0].scenario,'Living Room');
 assert.deepEqual(passport.preferences[0].conditions,['Unless I ask you to move them']);assert.equal(passport.preferences[0].permission_policy,'prohibited');assert.equal(passport.preferences[0].owner_marked_general,true);
 assert.match(passportText(passport),/Unless I ask you/);assert.doesNotMatch(JSON.stringify(passport),/source_message|source_refs|user_id/);
});
