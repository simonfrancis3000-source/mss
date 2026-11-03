import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Robot Rewards detail panels use the soft grey Today’s Focus palette', async () => {
  const css = await readFile(new URL('../src/mss-interface.css', import.meta.url), 'utf8');
  // Keep this assertion scoped to the detail styling block. Home has its own
  // independent palette rules and corresponding regression tests.
  const scoped = css.split('/* Rewards detail only:')[1]?.split('/* Match Home Robot Rewards')[0] || '';
  assert.match(scoped, /\.mss-rewards-page \.mss-rewards-partner,/);
  assert.match(scoped, /\.mss-rewards-page \.mss-rewards-credit,/);
  assert.match(scoped, /\.mss-rewards-page \.mss-rewards-training,/);
  assert.match(scoped, /\.mss-rewards-page \.mss-rewards-offer,/);
  assert.match(scoped, /\.mss-rewards-page \.mss-rewards-partner-footer,/);
  assert.match(scoped, /\.mss-rewards-page \.mss-rewards-terms\{/);
  assert.match(scoped, /background:linear-gradient\(125deg,#f0f0f5,#eceef4\)/);
  assert.match(scoped, /\.mss-rewards-page \.mss-rewards-credit-track\{\s*background:#a7cfb6;/);
  assert.match(scoped, /\.mss-rewards-page \.mss-rewards-credit-track>span\{\s*background:#08783f;/);
  assert.doesNotMatch(scoped, /\.mss-home \.mss-rewards-teaser/);
});
