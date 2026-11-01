import test from 'node:test';
import assert from 'node:assert/strict';
import {createSentencePausePlanner} from '../src/sentence-pause.js';
const speech = size => new Int16Array(size).fill(1200);
const quiet = size => new Int16Array(size);
const together = (...parts) => Int16Array.from(parts.flatMap(part => [...part]));

test('only sentence endings add gaps, with a longer pause before a question',()=>{
  const planner=createSentencePausePlanner(1000);
  assert.equal(planner.gapBefore(speech(100),'I will leave'),0);
  assert.equal(planner.gapBefore(speech(100),' the candle alone.'),0);
  assert.equal(planner.gapBefore(speech(100),'How about the lamps?'),.42);
  assert.equal(planner.gapBefore(speech(100),'Next, the rug.'),.28);
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
  planner.gapBefore(speech(100),'了解しました。');
  assert.equal(planner.gapBefore(speech(100),'次に'),.28);
  planner.gapBefore(speech(100),'Understood.”');
  assert.equal(planner.gapBefore(speech(100),'What next?'),.42);
  planner.reset();assert.equal(planner.gapBefore(speech(100),'A new reply'),0);
});
