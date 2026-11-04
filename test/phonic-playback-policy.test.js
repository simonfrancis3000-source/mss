import test from 'node:test';
import assert from 'node:assert/strict';
import {PHONIC_PLAYBACK_GAIN, PHONIC_PLAYBACK_BUFFER_SECONDS, phonicAudioChunkStart} from '../src/phonic-playback-policy.js';

test('Phonic playback has headroom instead of amplifying and hard-compressing PCM',()=>{
  assert.ok(PHONIC_PLAYBACK_GAIN>0 && PHONIC_PLAYBACK_GAIN<1);
  assert.ok(32767/32768*PHONIC_PLAYBACK_GAIN<1);
});
test('queued chunks schedule continuously without adding a new gap to each packet',()=>{
  assert.equal(phonicAudioChunkStart(10.00,10.28),10.28);
  assert.equal(phonicAudioChunkStart(10.15,10.28),10.28);
});
test('playback recovers from jitter underruns with a modest new startup buffer',()=>{
  assert.ok(PHONIC_PLAYBACK_BUFFER_SECONDS>=0.15&&PHONIC_PLAYBACK_BUFFER_SECONDS<=0.25);
  assert.ok(Math.abs(phonicAudioChunkStart(10.3,10.2)-(10.3+PHONIC_PLAYBACK_BUFFER_SECONDS))<1e-8);
  assert.equal(phonicAudioChunkStart(0,0),PHONIC_PLAYBACK_BUFFER_SECONDS);
});
