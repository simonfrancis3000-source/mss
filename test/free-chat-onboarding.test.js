import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onboardingPages, FAQ_CATEGORIES } from '../src/getting-started-content.js';

test('new accounts are guided to start with free Chat without a voice subscription',()=>{
  const pages=onboardingPages('Vikki');
  assert.equal(pages.length,5);
  assert.equal(pages[0].title,'Meet Vikki');
  assert.match(pages[0].paragraphs.join(' '),/start for free in Chat/i);
  assert.match(pages[2].lead,/Start free in Chat/i);
  const content=pages[2].paragraphs.join(' ');
  assert.match(content,/starts free for a limited time/);
  assert.match(content,/\$9\.99\/month/);
  assert.match(content,/two-way voice conversation/);
  assert.match(content,/Profile - Edit Profile/);
  assert.match(content,/custom name/);
  assert.match(content,/conversation language/);
  assert.doesNotMatch(content,/\$0\.10|\$0\.50|voice minutes|usage/);
  assert.ok(content.split(/\s+/).length < 60);
});

test('every onboarding page remains compact and rewards remain fourth',()=>{
  const pages=onboardingPages();
  assert.equal(pages[3].title,'Robot Rewards');
  assert.equal(pages[4].title,'What happens next?');
  for(const p of pages){
    assert.ok([p.lead,...p.paragraphs].join(' ').split(/\s+/).length < 130,p.title);
  }
});

test('automatic final onboarding step leads into Chat, not paid Talk',()=>{
  const src=readFileSync(new URL('../src/help-interface.js',import.meta.url),'utf8');
  assert.match(src,/automatic \? 'Start free in Chat'/);
  assert.match(src,/finishGuide\('completed', automatic \? 'chat' : null\)/);
  assert.match(src,/Explore my Home/);
});

test('Help FAQ describes both tiers and the hard-stop action',()=>{
  const faq=FAQ_CATEGORIES.flatMap(item=>item.questions);
  const get=id=>faq.find(q=>q.id===id)?.answer||'';
  assert.match(get('free-chat'),/one-time free allowance/);
  assert.match(get('premium-chat'),/\$0\.50/);
  assert.match(get('premium-chat'),/both Chat and Talk pause/);
  assert.match(get('out-of-minutes'),/switch to Chat/);
});
