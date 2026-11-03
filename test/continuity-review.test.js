import test from 'node:test';
import assert from 'node:assert/strict';
import { continuityReviewRequest, readContinuityVerdict } from '../server/continuity-review.js';
import { guardScenarioQuestion } from '../server/continuity-guard.js';

const result = (value, finish_reason = 'stop') => ({ choices: [{ finish_reason, message: { content: JSON.stringify(value) } }] });

test('compact review preserves every decision, answer, permission and condition without retrieval bookkeeping', () => {
  const exchanges = Array.from({ length: 120 }, (_, i) => ({ question: `Where should item ${i} go?`, answer: `On shelf ${i}.`, scenarioId: 'room:living_room' }));
  const questions = Array.from({ length: 250 }, (_, i) => ({ question: `What about situation ${i}?`, status: i % 2 ? 'deferred' : 'response_received' }));
  const rule = { id: 'internal-id', memory_key: 'lookup-key', source_refs: [{ id: 'source-id' }], updated_at: '2026-11-03', search_keys: ['shelf'],
    statement: 'Ask before moving fragile ornaments.', status: 'user_confirmed', conditions: ['Only while guests are present.'], permission_policy: 'ask_first', scope_key: 'living_room.ornaments', attributes: { exceptions: ['Never move the glass bird.'] } };
  const request = continuityReviewRequest('fixture-model', { exchanges, questions, rules: [rule, rule], reviewedAreas: ['TV', 'TV'], latestUser: 'Actually, change my preference.', candidate: 'Where should item 119 go?' });
  const evidence = JSON.parse(request.messages[1].content);
  assert.equal(request.max_tokens, 32);
  assert.equal(request.thinking.type, 'disabled');
  assert.equal(request.response_format.type, 'json_object');
  assert.deepEqual(evidence.exchanges, exchanges);
  assert.deepEqual(evidence.questions, questions);
  assert.equal(evidence.rules.length, 1);
  for (const key of ['statement', 'status', 'conditions', 'permission_policy', 'scope_key', 'attributes']) assert.deepEqual(evidence.rules[0][key], rule[key]);
  assert.equal(evidence.rules[0].source_refs, undefined);
  assert.deepEqual(evidence.reviewedAreas, ['TV']);
  assert.equal(evidence.latestUser, 'Actually, change my preference.');
  assert.match(request.messages[0].content, /different wording|deferred|reviewed area|new exception|explicitly requests to revisit/);
});

test('only an explicit complete boolean verdict is accepted', () => {
  assert.deepEqual(readContinuityVerdict(result({ repeated_question: false })), { repeated_question: false });
  assert.deepEqual(readContinuityVerdict(result({ repeated_question: true })), { repeated_question: true });
  for (const input of [result({ repeated_question: false }, 'length'), result({ repeated_question: 'false' }), result({}), { choices: [{ message: { content: 'invalid json' } }] }]) {
    assert.throws(() => readContinuityVerdict(input));
  }
});

test('compact verdicts still check a replacement and fail closed if its check is incomplete', async () => {
  let checks = 0, rewrites = 0;
  const guarded = await guardScenarioQuestion({
    draft: 'Understood. Where would you keep the handset?', latestUser: 'On the side table.',
    continuity: { exchanges: [{ question: 'Where should the remote go?', answer: 'On the side table.' }] },
    review: async () => readContinuityVerdict(++checks === 1 ? result({ repeated_question: true }) : result({ repeated_question: false }, 'length')),
    rewrite: async rejection => {
      rewrites++;
      assert.match(rejection.reason, /supplied evidence/);
      return 'I will keep that preference. Should I ask before moving a guest’s bag?';
    }
  });
  assert.equal(checks, 2);
  assert.equal(rewrites, 1);
  assert.equal(guarded.reviewUnavailable, true);
  assert.equal(guarded.reply, 'I will keep that preference.');
});
