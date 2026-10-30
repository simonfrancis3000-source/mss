import test from "node:test";
import assert from "node:assert/strict";
import {
  assistantReplyRepeatsRecentAssistant,
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
  const statement = "Some robots may eventually be compatible with PEXI.";
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


test("companion speaks in first person in statements, instructions and descriptions", () => {
  assert.equal(enforceFirstPersonTaskQuestions("The robot can clean the kitchen."), "I can clean the kitchen.");
  assert.equal(enforceFirstPersonTaskQuestions("Your future robot will learn your routine."), "I will learn your routine.");
  assert.equal(enforceFirstPersonTaskQuestions("The robot is not connected yet."), "I am not connected yet.");
  assert.equal(enforceFirstPersonTaskQuestions("Your robot's preferences are stored in your account."), "My preferences are stored in your account.");
  assert.equal(enforceFirstPersonTaskQuestions("You can talk to the robot whenever you need help."), "You can talk to me whenever you need help.");
  assert.equal(enforceFirstPersonTaskQuestions("You want the robot to remember that."), "You want me to remember that.");
  assert.equal(enforceFirstPersonTaskQuestions("Freya can help you with laundry.", "Freya"), "I can help you with laundry.");
});

test("generic facts about robots remain third-person when not referring to the companion", () => {
  const statement = "Some robots use lidar and depth cameras to navigate.";
  assert.equal(enforceFirstPersonTaskQuestions(statement), statement);
});

test("detects repeated assistant answers and materially similar questions", () => {
  const history = [
    { role: "assistant", content: "What should I do if a delivery arrives while you are out?" },
    { role: "user", content: "Leave it by the door." }
  ];
  assert.equal(assistantReplyRepeatsRecentAssistant("What should I do when a delivery arrives while you are away?", history), true);
  assert.equal(assistantReplyRepeatsRecentAssistant("How should I handle wet floors after cleaning?", history), false);
  assert.equal(assistantReplyRepeatsRecentAssistant("I can leave the parcel by the door and tell you when it arrives.", [
    { role: "assistant", content: "I can leave the parcel by the door and tell you when it arrives." }
  ]), true);
});


test("first-person rewriting covers capability, behaviour and reference statements", () => {
  assert.equal(enforceFirstPersonTaskQuestions("The robot cleans the worktop every morning."), "I clean the worktop every morning.");
  assert.equal(enforceFirstPersonTaskQuestions("Your robot handles the laundry."), "I handle the laundry.");
  assert.equal(enforceFirstPersonTaskQuestions("The robot remembers your preferences."), "I remember your preferences.");
  assert.equal(enforceFirstPersonTaskQuestions("The robot's schedule is stored here."), "My schedule is stored here.");
  assert.equal(enforceFirstPersonTaskQuestions("You can ask the robot for help."), "You can ask me for help.");
  assert.equal(enforceFirstPersonTaskQuestions("Freya is not connected to your home yet.", "Freya"), "I am not connected to your home yet.");
});

test("repeat detection checks semantically similar questions without flagging new topics", () => {
  const history = [
    { role: "assistant", content: "What should I do if a delivery arrives while you are out?" },
    { role: "user", content: "Leave it by the door." }
  ];
  assert.equal(assistantReplyRepeatsRecentAssistant("What should I do when a delivery arrives while you are away?", history), true);
  assert.equal(assistantReplyRepeatsRecentAssistant("How should I handle wet floors after cleaning?", history), false);
});
