import test from "node:test";
import assert from "node:assert/strict";
import { buildCompanionNameGuidance } from "../src/companion-personality.js";
import { enforceFirstPersonTaskQuestions } from "../src/voice-language.js";

test("named asides use the selected name and become eligible when it has not appeared recently", () => {
  const guidance = buildCompanionNameGuidance("Nova", [{role:"user",content:"Nova, let's talk about laundry."}]);
  assert.match(guidance, /selected name is "Nova"/);
  assert.match(guidance, /may include your name once/);
  assert.doesNotMatch(guidance, /selected name is "Freya"/);
});

test("recent assistant naming suppresses another aside, while older naming does not", () => {
  const old = {role:"assistant",content:"Call that the NOVA approach."};
  assert.match(buildCompanionNameGuidance("Nova", [old, {role:"user",content:"Yes"}]), /Do not add another self-named aside/);
  const later = Array.from({length:4}, () => ({role:"assistant",content:"How should I handle that?"}));
  assert.match(buildCompanionNameGuidance("Nova", [old, ...later]), /may include your name once/);
});

test("light named asides survive the first-person guard while task descriptions remain first person", () => {
  assert.equal(enforceFirstPersonTaskQuestions("Call that the Nova approach. How would you like me to handle fragile dishes?", "Nova"), "Call that the Nova approach. How would you like me to handle fragile dishes?");
  assert.equal(enforceFirstPersonTaskQuestions("Nova can clean the worktop.", "Nova"), "I can clean the worktop.");
});
