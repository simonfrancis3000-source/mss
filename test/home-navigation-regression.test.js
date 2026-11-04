import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Home training progress and Robot Rewards cards are accessible navigation controls', async () => {
  const ui=await readFile(new URL('../src/mss-interface.js',import.meta.url),'utf8');
  assert.match(ui,/action\('', 'mss-card mss-progress', \(\) => navigate\('passport'\)\)/);
  assert.match(ui,/setAttribute\('aria-label', 'Open Passport training progress and modules'\)/);
  assert.match(ui,/action\('', 'mss-rewards-teaser', \(\) => navigate\('rewards'\)\)/);
  assert.doesNotMatch(ui,/symbol\('chevron', 'mss-rewards-teaser-chevron'\)/);
  assert.match(ui,/rewardTrack\('mss-rewards-teaser-track', summary\.percent/);
});

test('scenario Journey has only a back route to the unified Passport chart and module grid', async () => {
  const journey=await readFile(new URL('../src/synqme.js',import.meta.url),'utf8');
  const ui=await readFile(new URL('../src/mss-interface.js',import.meta.url),'utf8');
  assert.match(journey,/backToPassport\.addEventListener\("click", \(\) => selectAppView\("passport"\)\)/);
  assert.doesNotMatch(journey,/\[\["chart", "Chart"\], \["scenarios", "Scenarios"\]\]/);
  assert.doesNotMatch(journey,/target\.append\(mssInterface\.createProgressChart\(\)\)/);
  assert.match(ui,/passport\.replaceChildren\(heading\('Passport',[^\n]*progressChart\(snapshot\)/);
  assert.match(ui,/model\.modules\.forEach\(item => grid\.append\(moduleCard\(item\)\)\)/);
});

test('password reveal button has accessible show and hide states on the sign-in form', async () => {
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const code=await readFile(new URL('../src/synqme.js',import.meta.url),'utf8');
  const styles=await readFile(new URL('../src/synqme-soft.css',import.meta.url),'utf8');
  assert.match(html,/id="authPasswordToggle"[^>]*type="button"/);
  assert.match(html,/aria-controls="authPassword" aria-label="Show password" aria-pressed="false"/);
  assert.match(code,/elements\.authPasswordToggle\?\.addEventListener\("click"/);
  assert.match(code,/elements\.authPassword\.type = visible \? "text" : "password"/);
  assert.match(code,/setAttribute\("aria-label", visible \? "Hide password" : "Show password"\)/);
  assert.match(styles,/#authGate \.auth-password-control/);
});
