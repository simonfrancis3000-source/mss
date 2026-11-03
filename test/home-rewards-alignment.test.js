import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Home Rewards shares the same light grey as the detail page and Today’s Focus', async () => {
  const css = await readFile(new URL('../src/mss-interface.css', import.meta.url), 'utf8');
  assert.match(css, /\.mss-rewards-page \.mss-rewards-terms\{\s*background:linear-gradient\(125deg,#f0f0f5,#eceef4\)/);
  assert.match(css, /\.mss-home \.mss-rewards-teaser\{\s*background:linear-gradient\(125deg,#f0f0f5,#eceef4\)/);
});
test('Home training and rewards status bars have equal bottom insets', async () => {
  const css = await readFile(new URL('../src/mss-interface.css', import.meta.url), 'utf8');
  assert.match(css, /\.mss-home \.mss-progress\{padding:10px 14px 11px;/);
  assert.match(css, /\.mss-home \.mss-rewards-teaser\{\s*background:linear-gradient\(125deg,#f0f0f5,#eceef4\);\s*border-color:#d8dce5;\s*min-height:0;\s*box-sizing:border-box;\s*padding-top:10px;\s*padding-bottom:11px;/);
  assert.match(css, /\.mss-rewards-teaser-track\{[^}]*background:#eef0f3\}/);
  assert.match(css, /\.mss-rewards-teaser-track>span\{[^}]*background:#636a75\}/);
});
