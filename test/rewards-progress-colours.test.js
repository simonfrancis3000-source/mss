import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('training progress remains purple and is visible when no progress is earned', async () => {
  const css = await readFile(new URL('../src/mss-interface.css', import.meta.url), 'utf8');
  assert.match(css, /\.mss-home \.mss-progress-track\{height:7px;background:#bfa7ef\}/);
  assert.match(css, /\.mss-rewards-training-track\{background:#bca3ed\}/);
  assert.match(css, /\.mss-rewards-training-track>span\{background:linear-gradient\(90deg,#7956d8,#af91ef\)\}/);
});

test('Home rewards track remains visible at zero and fills with dark grey', async () => {
  const css = await readFile(new URL('../src/mss-interface.css', import.meta.url), 'utf8');
  assert.match(css, /\.mss-rewards-teaser-track\{[^}]*background:#c1c6cf\}/);
  assert.match(css, /\.mss-rewards-teaser-track>span\{[^}]*background:#444b55\}/);
  // The detailed account credit progress keeps its existing green styling.
  assert.match(css, /\.mss-rewards-credit-track>span,\.mss-rewards-training-track>span\{[^}]*background:#12a454\}/);
});
