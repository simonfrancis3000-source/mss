import test from "node:test";
import assert from "node:assert/strict";
import {
  companionThinkingMessage,
  companionWelcomeMessage,
  isCompanionWelcomeMessage
} from "../src/companion-copy.js";

test("introduces the selected companion as the user's future robot", () => {
  assert.equal(
    companionWelcomeMessage("en", "Freya"),
    "I am your future robot, Freya. I am here to help you build your SecondSelf, learn your routines and understand how you like things done."
  );
  assert.match(companionWelcomeMessage("en", "ELO"), /future robot, ELO/);
});

test("welcome copy follows the selected conversation language", () => {
  assert.match(companionWelcomeMessage("es", "Freya"), /^Soy tu futuro robot, Freya\./);
  assert.match(companionWelcomeMessage("ja", "Freya"), /未来のロボット/);
});

test("recognises previous and personalised welcome messages for localisation", () => {
  assert.equal(isCompanionWelcomeMessage("Hi, I’m here to help you build your SecondSelf. Speak naturally, and we’ll work out what matters to you."), true);
  assert.equal(isCompanionWelcomeMessage(companionWelcomeMessage("en", "Freya")), true);
  assert.equal(isCompanionWelcomeMessage("Tell me about your kitchen."), false);
});

test("thinking status uses the selected robot name", () => {
  assert.equal(companionThinkingMessage("Freya"), "Freya is thinking…");
  assert.equal(companionThinkingMessage("ELO"), "ELO is thinking…");
});
