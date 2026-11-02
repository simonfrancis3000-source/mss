import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryJobRunner, memoryRetryDelaySeconds, memoryJobKey } from '../src/memory-job-runner.js';

function fixture(process) {
  const queue = [], completed = [], retries = [];
  const store = {
    claim: async () => queue.find(job => job.status === 'pending') ? Object.assign(queue.find(job => job.status === 'pending'), { status: 'processing' }) : null,
    process,
    complete: async job => { job.status = 'done'; job.messages = []; completed.push(job.id); },
    retry: async job => { job.status = 'waiting'; retries.push(job.id); }
  };
  return { queue, completed, retries, store, runner: createMemoryJobRunner(store) };
}

test('overlapping turns are processed in order without dropping a queued answer', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const seen = [];
  const f = fixture(async job => { seen.push(job.id); if (job.id === 1) await gate; });
  f.queue.push({ id: 1, status: 'pending', messages: ['first'] });
  const running = f.runner.drain();
  await Promise.resolve(); await Promise.resolve();
  f.queue.push({ id: 2, status: 'pending', messages: ['second'] });
  await f.runner.drain(); // A second drain never takes a parallel lease.
  release(); await running;
  assert.deepEqual(seen, [1, 2]);
  assert.deepEqual(f.completed, [1, 2]);
  assert.deepEqual(f.queue.map(job => job.messages), [[], []]);
});

test('failed processing stays retryable across a runner restart', async () => {
  let calls = 0;
  const f = fixture(async () => { if (++calls === 1) throw Error('temporary failure'); });
  f.queue.push({ id: 1, status: 'pending', messages: ['a preference'] });
  await f.runner.drain();
  assert.deepEqual(f.retries, [1]); assert.equal(f.queue[0].status, 'waiting');
  assert.deepEqual(f.queue[0].messages, ['a preference']);
  f.queue[0].status = 'pending';
  await createMemoryJobRunner(f.store).drain();
  assert.equal(calls, 2); assert.deepEqual(f.completed, [1]);
  assert.deepEqual(f.queue[0].messages, []);
});

test('retry backoff is bounded and increases after repeated failures', () => {
  assert.deepEqual([1, 2, 3, 10].map(memoryRetryDelaySeconds), [5, 10, 20, 300]);
});


test('turn IDs are deterministic and distinguish different answers at the same timestamp', () => {
 const t = '2026-11-02T11:00:00.000Z';
 assert.equal(memoryJobKey(t, 'First answer'), memoryJobKey(t, 'First answer'));
 assert.notEqual(memoryJobKey(t, 'First answer'), memoryJobKey(t, 'Second answer'));
 assert.doesNotMatch(memoryJobKey(t, 'First answer'), /First answer/);
});
