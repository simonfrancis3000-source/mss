import test from 'node:test';
import assert from 'node:assert/strict';
import {createSentencePausePlanner} from '../src/sentence-pause.js';
const speech = size => new Int16Array(size).fill(1200);
const quiet = size => new Int16Array(size);
const together = (...parts) => Int16Array.from(parts.flatMap(part => [...part]));

test('only sentence endings add gaps, with a longer pause before a question',()=>{
  const planner=createSentencePausePlanner(1000);
  assert.equal(planner.gapBefore(speech(100),'I will leave'),0);
  assert.equal(planner.gapBefore(together(speech(100),quiet(20)),' the candle alone.'),0);
  assert.ok(Math.abs(planner.gapBefore(together(speech(100),quiet(20)),'How about the lamps?')-.4)<1e-8);
  assert.ok(Math.abs(planner.gapBefore(speech(100),'Next, the rug.')-.26)<1e-8);
});
test('natural trailing and leading silence, silent chunks and network delay are preserved',()=>{
  const planner=createSentencePausePlanner(1000);
  planner.gapBefore(together(speech(100),quiet(100)),'Understood.');
  planner.gapBefore(quiet(100),'');
  assert.ok(Math.abs(planner.gapBefore(together(quiet(50),speech(100)),'Next')-.03)<1e-8);
  planner.gapBefore(together(speech(100),quiet(300)),'Fine.');
  assert.equal(planner.gapBefore(speech(100),'Next'),0);
  planner.gapBefore(speech(100),'Fine.');
  assert.equal(planner.gapBefore(speech(100),'Next',.5),0);
});
test('abbreviations and numbers do not create mid-phrase gaps',()=>{
  const planner=createSentencePausePlanner(1000);
  planner.gapBefore(speech(100),'Speak to Dr.');
  assert.equal(planner.gapBefore(speech(100),' Smith'),0);
  planner.gapBefore(speech(100),'The U.S.');
  assert.equal(planner.gapBefore(speech(100),' model'),0);
  planner.gapBefore(speech(100),'Set it to 3.');
  assert.equal(planner.gapBefore(speech(100),'5'),0);
});
test('multilingual punctuation and closing quotes are handled and reset drops old pauses',()=>{
  const planner=createSentencePausePlanner(1000);
  planner.gapBefore(together(speech(100),quiet(20)),'了解しました。');
  assert.ok(Math.abs(planner.gapBefore(speech(100),'次に')-.26)<1e-8);
  planner.gapBefore(together(speech(100),quiet(20)),'Understood.”');
  assert.ok(Math.abs(planner.gapBefore(speech(100),'What next?')-.4)<1e-8);
  planner.reset();assert.equal(planner.gapBefore(speech(100),'A new reply'),0);
});

test('punctuation arriving before its sound never inserts a pause inside continuous voiced audio',()=>{
  const planner=createSentencePausePlanner(1000);
  planner.gapBefore(speech(100),'Understood.');
  assert.equal(planner.gapBefore(speech(100),'How'),0);
  assert.equal(planner.gapBefore(together(speech(100),quiet(20)),' would'),0);
  assert.equal(planner.gapBefore(speech(100),' you like'),0);
});

test('a single zero crossing is not a quiet sentence boundary and voiced samples break accumulated silence',()=>{
  const planner=createSentencePausePlanner(1000);
  planner.gapBefore(together(speech(100),quiet(5)),'Okay.');
  assert.equal(planner.gapBefore(together(quiet(1),speech(100)),'How'),0);
  assert.equal(planner.gapBefore(together(quiet(7),speech(100)),' about'),0);
  assert.equal(planner.gapBefore(together(quiet(20),speech(100)),' tomorrow?'),0);
});
