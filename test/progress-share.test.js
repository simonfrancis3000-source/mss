import test from 'node:test';
import assert from 'node:assert/strict';
import { progressOwnerLabel } from '../src/progress-share.js';
import { scenarioProgressSummary, SCENARIOS } from '../src/scenario-journey.js';
test('progress and journey use the owner first name with safe unnamed fallback',()=>{
 assert.equal(progressOwnerLabel('  Simon Francis  ','progress'),"Simon's progress");
 assert.equal(progressOwnerLabel('Freddie','journey'),"Freddie's journey");
 assert.equal(progressOwnerLabel('','progress'),'Your progress');
});
test('share image source counts include all four categories and use confirmed completion',()=>{
 const summary=scenarioProgressSummary(SCENARIOS.map(item=>item.id));
 assert.equal(summary.percent,100);assert.equal(summary.groups.length,4);
 assert.equal(summary.groups.reduce((total,item)=>total+item.completed,0),25);
 assert.equal(scenarioProgressSummary([]).percent,0);
});
