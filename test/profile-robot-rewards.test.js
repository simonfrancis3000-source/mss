import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Profile exposes Robot Rewards directly beside the heading', async () => {
  const source = await readFile(new URL('../src/mss-interface.js', import.meta.url), 'utf8');
  assert.match(source, /const profileHeading = heading\('Profile'\);/);
  assert.match(source, /profileHeading\.classList\.add\('mss-profile-heading'\)/);
  assert.match(source, /action\('Robot Rewards', 'mss-profile-rewards-button', \(\) => navigate\('rewards'\)\)/);
  assert.match(source, /profileHeading\.append\(profileRewards\)/);
});
test('Rewards surfaces share medium-grey backgrounds and robot images are preserved', async () => {
  const css = await readFile(new URL('../src/mss-interface.css', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/mss-interface.js', import.meta.url), 'utf8');
  assert.match(css, /\.mss-home \.mss-rewards-teaser,[\s\S]*?\.mss-rewards-terms\s*\{\s*background:#d5d7dd;/);
  assert.match(css, /\.mss-profile \.mss-profile-heading\s*\{\s*display:flex;/);
  assert.match(source, /image\.src = COMPANION_IMAGE/);
  assert.match(source, /photo\.src = BOOSTER_T2_IMAGE/);
  assert.match(source, /rewardTeaser\(snapshot\)/);
});
