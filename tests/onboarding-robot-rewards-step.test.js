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

test('Robot Rewards step is inviting, explains double credit and qualifies priority access', () => {
  const page = onboardingPages()[3];
  const copy = [page.lead, ...page.paragraphs].join(' ');
  assert.match(copy, /every \$1 of eligible spending/);
  assert.match(copy, /earns \$2 in Robot Rewards credit/);
  assert.match(copy, /priority purchase opportunities/);
  assert.match(copy, /working with robot partners/);
  assert.match(copy, /partner availability/);
  assert.match(copy, /See Robot Rewards for full terms and conditions/);
  assert.ok(copy.split(/\s+/).length < 125, 'copy must fit the onboarding panel');
});

test('Guide uses dynamic page count and rewards-specific compact presentation', () => {
  const help = readFileSync(new URL('../src/help-interface.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/mss-interface.css', import.meta.url), 'utf8');
  assert.match(help, /'Step ' \+ \(index \+ 1\) \+ ' of ' \+ pages\.length/);
  assert.match(help, /mss-guide-rewards/);
  assert.match(css, /\.mss-onboarding\.mss-guide-rewards/);
  assert.match(css, /max-height:620px/);
});

test('What happens next stays short and keeps final navigation accessible', () => {
  const page = onboardingPages()[4];
  const copy = [page.lead, ...page.paragraphs].join(' ');
  assert.ok(copy.split(/\s+/).length < 80, 'final page must use compact wording');
  assert.match(copy, /Persona Passport/);
  assert.match(copy, /verified compatibility/);
  assert.match(copy, /Privacy settings/);
  const help = readFileSync(new URL('../src/help-interface.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/mss-interface.css', import.meta.url), 'utf8');
  assert.match(help, /mss-guide-final/);
  assert.match(help, /Return to my journey/);
  assert.match(css, /mss-guide-final \.mss-guide-actions\{flex-shrink:0/);
  assert.match(css, /mss-guide-final \.mss-guide-content\{min-height:0;overflow-y:auto/);
});

test('Journey step stays compact and explains free Chat, Premium voice and profile settings', () => {
  const page = onboardingPages()[2];
  const copy = [page.lead, ...page.paragraphs].join(' ');
  assert.match(copy, /Chat starts free for a limited time/);
  assert.match(copy, /\$9\.99\/month/);
  assert.match(copy, /two-way voice conversation/);
  assert.match(copy, /Profile - Edit Profile/);
  assert.match(copy, /conversation language/);
  assert.ok(copy.split(/\s+/).length < 65);
});

test('All five onboarding panels share fixed dimensions and pinned actions', () => {
  const css = readFileSync(new URL('../src/mss-interface.css', import.meta.url), 'utf8');
  assert.match(css, /Keep all five Getting Started dialog panels exactly the same outer size/);
  assert.match(css, /height:min\(590px,calc\(100dvh - 28px\)\)/);
  assert.match(css, /\.mss-onboarding \.mss-guide-content\{[^}]*overflow-y:auto/s);
  assert.match(css, /\.mss-onboarding \.mss-guide-actions,[\s\S]*?flex:0 0 auto/s);
});
