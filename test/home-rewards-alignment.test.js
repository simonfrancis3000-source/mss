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
  assert.match(css, /\.mss-rewards-teaser-track\{[^}]*background:#c1c6cf\}/);
  assert.match(css, /\.mss-rewards-teaser-track>span\{[^}]*background:#444b55\}/);
});

test('Home Robot Rewards track matches Training Progress width and chevron clears the bar', async () => {
  const css = await readFile(new URL('../src/mss-interface.css', import.meta.url), 'utf8');
  // Both cards have a 14px inset on each side and a 7px progress bar.
  assert.match(css, /\.mss-home \.mss-progress\{padding:10px 14px 11px;/);
  assert.match(css, /\.mss-home \.mss-progress-track\{height:7px;/);
  assert.match(css, /\.mss-home \.mss-rewards-teaser\{\s*padding-left:14px;\s*padding-right:14px;/);
  assert.match(css, /\.mss-rewards-teaser-track\{[^}]*height:7px;/);
  // Header content alone reserves room for the icon, not the track.
  assert.match(css, /\.mss-home \.mss-rewards-teaser-row\{\s*padding-right:29px;/);
  assert.match(css, /\.mss-home \.mss-rewards-teaser-chevron\{\s*top:11px;\s*right:11px;\s*width:19px;\s*height:19px;\s*transform:none;/);
});

test('Home training percentage and Robot Rewards amount use the same font size', async () => {
  const css = await readFile(new URL('../src/mss-interface.css', import.meta.url), 'utf8');
  assert.match(css, /\.mss-home \.mss-progress-heading strong\{font-size:15px;font-weight:750;/);
  // This selector also overrides the older 12px narrow-screen rule.
  assert.match(css, /\.mss-home \.mss-rewards-teaser-value\{\s*font-size:15px;\s*font-weight:750;/);
});
