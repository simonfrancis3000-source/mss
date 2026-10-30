import test from "node:test";
import assert from "node:assert/strict";
import {
  enforceFirstPersonTaskQuestions,
  isIncompleteAssistantReply,
  normaliseVoicePreference,
  phonicVoiceIdForPreference
} from "../src/voice-language.js";

test("robot task questions are rewritten from the companion's first-person perspective", () => {
  assert.equal(
    enforceFirstPersonTaskQuestions("What would you like your robot to do after breakfast?"),
    "What would you like me to do after breakfast?"
  );
  assert.equal(
    enforceFirstPersonTaskQuestions("What do you want your robot to handle?"),
    "What would you like me to handle?"
  );
  assert.equal(
    enforceFirstPersonTaskQuestions("What should the robot do?"),
    "What would you like me to do?"
  );
  assert.equal(
    enforceFirstPersonTaskQuestions("How would you like your future home robot to approach laundry?"),
    "How would you like me to approach laundry?"
  );
  assert.equal(
    enforceFirstPersonTaskQuestions("Would you like your household robot to help with tidying?"),
    "Would you like me to help with tidying?"
  );
});

test("ordinary factual references to a robot are not rewritten", () => {
  const statement = "Your robot may eventually be compatible with PEXI.";
  assert.equal(enforceFirstPersonTaskQuestions(statement), statement);
});

test("male and female preferences resolve to one fixed Phonic voice", () => {
  assert.equal(normaliseVoicePreference("male"), "male");
  assert.equal(normaliseVoicePreference("female"), "female");
  assert.equal(normaliseVoicePreference("invalid"), "female");
  assert.equal(phonicVoiceIdForPreference("male"), "grant");
  assert.equal(phonicVoiceIdForPreference("female"), "sabrina");
  assert.equal(phonicVoiceIdForPreference("invalid"), "sabrina");
});


test("obvious unfinished assistant openings are rejected before display", () => {
  assert.equal(isIncompleteAssistantReply("Here's"), true);
  assert.equal(isIncompleteAssistantReply("Here is"), true);
  assert.equal(isIncompleteAssistantReply("For example"), true);
  assert.equal(isIncompleteAssistantReply("Let me"), true);
  assert.equal(isIncompleteAssistantReply("Here's what I would suggest"), true);
});

test("complete short replies remain valid", () => {
  assert.equal(isIncompleteAssistantReply("Yes."), false);
  assert.equal(isIncompleteAssistantReply("No!"), false);
  assert.equal(isIncompleteAssistantReply("Absolutely."), false);
  assert.equal(isIncompleteAssistantReply("Here's the answer."), false);
});
