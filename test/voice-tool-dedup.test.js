import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceToolDeduplicator } from '../src/voice-tool-dedup.js';

test('duplicate in-flight and completed voice tool calls share one execution', async () => {
  const once = createVoiceToolDeduplicator(); const socket = {}; let count = 0, release;
  const wait = new Promise(resolve => { release = resolve; });
  const run = async () => { count++; await wait; return { status: 'ok', assistant_text: 'Saved.' }; };
  const first = once(socket, 'call-one', run), duplicate = once(socket, 'call-one', run);
  release(); assert.deepEqual(await first, await duplicate);
  await once(socket, 'call-one', run); assert.equal(count, 1);
  await once({}, 'call-one', run); assert.equal(count, 2);
});

test('failed voice actions remain retryable and successful entries are bounded', async () => {
  const once = createVoiceToolDeduplicator(2); const socket = {}; let count = 0;
  const run = async () => ({ status: ++count === 1 ? 'error' : 'ok' });
  await once(socket, 'one', run); await once(socket, 'one', run); assert.equal(count, 2);
  await once(socket, 'two', run); await once(socket, 'three', run); await once(socket, 'one', run); assert.equal(count, 5);
});
