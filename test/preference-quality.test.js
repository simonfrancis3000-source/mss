import test from 'node:test';
import assert from 'node:assert/strict';
import { isUsefulStandalonePreference, cleanPersonaMemoryCandidate, preferenceToPersonaMemory, rankPersonaMemories } from '../src/persona-memory.js';

test('conversation fragments and acknowledgements are not standalone preferences', () => {
  for (const value of ['We already covered that', 'We', 'Just do it', "Quietly put it back once it’s gone", 'Quietly', "That’s correct", 'Separate', 'Yes', 'Put it back', 'I would leave it where it is', 'For the practice situation a guest is here, I would prefer:']) {
    assert.equal(isUsefulStandalonePreference(value), false, value);
    assert.equal(preferenceToPersonaMemory({ id: value, text: value }, 'account'), null, value);
  }
});

test('specific preferences and multilingual statements remain usable', () => {
  for (const value of ['Leave my papers on the coffee table', 'No perfume', 'Ask before moving my books', 'Me gusta que los cojines estén en el sofá', '本は棚に置いてください']) {
    assert.equal(isUsefulStandalonePreference(value), true, value);
  }
  assert.ok(cleanPersonaMemoryCandidate({ statement: 'I prefer my cushions on the sofa.', status: 'user_stated' }));
  assert.equal(cleanPersonaMemoryCandidate({ statement: 'We already covered that', status: 'user_stated' }), null);
});

test('old fragments do not become retrieved instructions', () => {
  const items = [{ statement: 'We already covered that', status: 'user_stated', topic: 'living_room' }, { statement: 'Leave my books on the living room table.', status: 'user_stated', topic: 'living_room' }];
  const result = rankPersonaMemories('living room books', items);
  assert.equal(result.some(item => item.statement === 'We already covered that'), false);
  assert.equal(result.some(item => item.statement.includes('books')), true);
});
