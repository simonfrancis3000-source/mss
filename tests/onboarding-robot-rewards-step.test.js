import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onboardingPages } from '../src/getting-started-content.js';

test('Getting Started has five steps, with Robot Rewards immediately before What happens next', () => {
  const pages = onboardingPages('Vikki');
  assert.equal(pages.length, 5);
  assert.deepEqual(pages.map(page => page.title), [
    'Meet Vikki',
    'How training works',
    'Your journey, your pace',
    'Robot Rewards',
    'What happens next?'
  ]);
});

test('Robot Rewards step explains earning, limits, readiness and conditional redemption concisely', () => {
  const page = onboardingPages()[3];
  const copy = [page.lead, ...page.paragraphs].join(' ');
  assert.match(copy, /\$2/);
  assert.match(copy, /\$1/);
  assert.match(copy, /\$100 per month/);
  assert.match(copy, /\$1,000/);
  assert.match(copy, /80%/);
  assert.match(copy, /six qualifying paid subscription months/);
  assert.match(copy, /5%/);
  assert.match(copy, /participating robots/);
  assert.ok(copy.split(/\s+/).length < 125, 'onboarding copy must remain short enough for a small panel');
});

test('Guide uses dynamic page count and rewards-specific compact presentation', () => {
  const help = readFileSync(new URL('../src/help-interface.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/mss-interface.css', import.meta.url), 'utf8');
  assert.match(help, /'Step ' \+ \(index \+ 1\) \+ ' of ' \+ pages\.length/);
  assert.match(help, /mss-guide-rewards/);
  assert.match(css, /\.mss-onboarding\.mss-guide-rewards/);
  assert.match(css, /max-height:620px/);
});
