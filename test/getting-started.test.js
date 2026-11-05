import test from 'node:test';
import assert from 'node:assert/strict';
import { FAQ_CATEGORIES, ONBOARDING_VERSION, onboardingPages, searchFaq, shouldShowOnboarding, firstConversationGuidance } from '../src/getting-started-content.js';
import { createOnboardingState } from '../src/onboarding-state.js';

function fixture() {
  const rows = new Map(), cache = new Map(); let fail = false;
  const copy = value => value ? structuredClone(value) : null;
  const repository = {
    async read(id) { return copy(rows.get(id)); },
    async create(value) { if (!rows.has(value.user_id)) rows.set(value.user_id, copy(value)); return copy(rows.get(value.user_id)); },
    async dismiss(id, patch) { if (fail) throw Error('offline'); rows.set(id, { ...rows.get(id), ...patch }); return copy(rows.get(id)); },
    async claimIntroduction(id, time) { const row = rows.get(id); if (!row || row.intro_presented_at) return null; row.intro_presented_at = time; return copy(row); }
  };
  const storage = { getItem: key => cache.get(key) || null, setItem: (key, value) => cache.set(key, value) };
  return { rows, repository, storage, offline: value => { fail = value; }, make: () => createOnboardingState({ repository, storage, now: () => '2026-11-04T10:00:00Z' }) };
}

test('guide contains five named screens and FAQ contains 23 distinct answers in five categories', () => {
  assert.equal(onboardingPages('Andy').length, 5);
  assert.equal(onboardingPages('Andy')[3].title, 'Robot Rewards');
  assert.equal(onboardingPages('Andy')[4].title, 'What happens next?'); assert.match(onboardingPages('Andy')[0].title, /Andy/);
  assert.equal(FAQ_CATEGORIES.length, 5);
  const questions = FAQ_CATEGORIES.flatMap(category => category.questions);
  assert.equal(questions.length, 23); assert.equal(new Set(questions.map(item => item.id)).size, 23);
  assert.match(questions.find(item => item.id === 'compatible-robots').answer, /future development/);
  assert.match(questions.find(item => item.id === 'simulation').answer, /not hardware simulations or physical robot tests/);
});
test('FAQ search matches meaningful words across categories and supports empty and missing results', () => {
  assert.equal(searchFaq('').length, 5);
  assert.ok(searchFaq('garden').some(group => group.questions.some(item => item.id === 'no-garden')));
  assert.ok(searchFaq('voice minutes').flatMap(group => group.questions).every(item => /voice/i.test(item.question + item.answer) && /minutes/i.test(item.question + item.answer)));
  assert.deepEqual(searchFaq('unfindable12345'), []);
});
test('automatic guide requires completed profile and a new, undismissed account', () => {
  const record = { version: 0, outcome: 'pending' };
  assert.equal(shouldShowOnboarding(record, { profileReady: true }), true);
  assert.equal(shouldShowOnboarding(record, { profileReady: false }), false);
  assert.equal(shouldShowOnboarding(record, { profileReady: true, returning: true }), false);
  for (const outcome of ['completed', 'skipped', 'existing_user']) assert.equal(shouldShowOnboarding({ version: ONBOARDING_VERSION, outcome }, { profileReady: true }), false);
});
test('skipping is remembered by a fresh controller on another device', async () => {
  const f = fixture(), first = f.make(); await first.load('a'); assert.equal(first.shouldShow(true), true);
  assert.deepEqual(await first.dismiss('skipped'), { saved: true });
  const other = f.make(); await other.load('a'); assert.equal(other.shouldShow(true), false);
  assert.equal(other.snapshot().record.outcome, 'skipped'); assert.equal(other.snapshot().record.version, ONBOARDING_VERSION);
});
test('replaying and closing a completed guide does not downgrade completion', async () => {
  const f = fixture(), store = f.make(); await store.load('a'); await store.dismiss('completed'); await store.dismiss('skipped');
  assert.equal(f.rows.get('a').outcome, 'completed');
});
test('existing training accounts are not interrupted or given another first-conversation introduction', async () => {
  const f = fixture(), store = f.make(); await store.load('a', { returning: true });
  assert.equal(store.shouldShow(true), false); assert.equal(await store.claimIntroduction('turn-1'), false);
  assert.equal(f.rows.get('a').outcome, 'existing_user');
});
test('first introduction is claimed once across devices and stays enabled for a repair of the same turn', async () => {
  const f = fixture(), a = f.make(), b = f.make(); await a.load('a'); await b.load('a');
  assert.equal(await a.claimIntroduction('turn-1'), true);
  assert.equal(await b.claimIntroduction('turn-1'), false);
  assert.equal(await a.claimIntroduction('turn-1'), true);
  assert.equal(await a.claimIntroduction('turn-2'), false);
  assert.match(firstConversationGuidance(true), /no physical robot is connected today/);
  assert.equal(firstConversationGuidance(false), ''); assert.equal(firstConversationGuidance('true'), '');
});
test('an offline dismissal remains remembered locally and syncs when connection returns', async () => {
  const f = fixture(), first = f.make(); await first.load('a'); f.offline(true);
  assert.deepEqual(await first.dismiss('skipped'), { saved: false }); assert.equal(first.shouldShow(true), false); assert.equal(first.snapshot().syncPending, true);
  f.offline(false); const other = f.make(); await other.load('a');
  assert.equal(other.shouldShow(true), false); assert.equal(f.rows.get('a').version, ONBOARDING_VERSION);
});
test('late account loads cannot replace a newer account or reuse its introduction state', async () => {
  const f = fixture(); let release;
  const original = f.repository.read;
  f.repository.read = id => id === 'a' ? new Promise(resolve => { release = resolve; }) : original(id);
  const store = f.make(); const pending = store.load('a'); await store.load('b'); release(null); await pending;
  assert.equal(store.snapshot().userId, 'b'); assert.equal(store.snapshot().record.user_id, 'b');
  assert.equal(await store.claimIntroduction('b-turn'), true); assert.equal(f.rows.has('a'), false);
});
