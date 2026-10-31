import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOutOfHomePersonaSystemPrompt,
  findOutOfHomeScenarioContext,
  parseOutOfHomeScenarioContext
} from "../src/out-of-home-persona-prompt.js";
import { buildOutOfHomeScenarioPrompt, findOutOfHomeScenario } from "../src/out-of-home-training.js";
import { shouldExtractPersonaMemory } from "../src/persona-memory.js";

test("the selected scenario can be recovered from the app-generated launch prompt", () => {
  const match = findOutOfHomeScenario("strangers", "child-approaches");
  const launch = buildOutOfHomeScenarioPrompt(match.category, match.scenario);
  const parsed = parseOutOfHomeScenarioContext(launch);
  assert.equal(parsed.trainingArea, match.category.title);
  assert.equal(parsed.scenario, match.scenario.title);
  assert.match(parsed.situation, /child/i);
  assert.match(parsed.behaviouralFocus, /adult/i);
  assert.equal(findOutOfHomeScenarioContext([{ role: "user", content: launch }]).scenario, match.scenario.title);
  assert.equal(parseOutOfHomeScenarioContext("ordinary message"), null);
});

test("the generated training prompt itself is not treated as a user preference", () => {
  const match = findOutOfHomeScenario("strangers", "child-approaches");
  const launch = buildOutOfHomeScenarioPrompt(match.category, match.scenario);
  assert.equal(shouldExtractPersonaMemory(launch), false);
});

test("AMÏA switches to public companion behaviour and keeps hardware claims behind PEXI", () => {
  const scenario = {
    trainingArea: "Strangers and first contact",
    scenario: "A child approaches",
    situation: "A child asks the robot its name.",
    behaviouralFocus: "Use age-appropriate language and involve a responsible adult."
  };
  const prompt = buildOutOfHomePersonaSystemPrompt({
    profile: { companionName: "Freya", preferredLanguage: "en" },
    scenario,
    personaMemories: [{ topic: "public_interactions", kind: "boundary", statement: "I prefer you to stay beside me when a child approaches.", status: "user_confirmed" }]
  });
  assert.match(prompt, /future personal robot companion/i);
  assert.match(prompt, /A child approaches/);
  assert.match(prompt, /Do not store names, images, contact details or identifying information about children/i);
  assert.match(prompt, /AMÏA captures the owner's intended behaviour/i);
  assert.match(prompt, /PEXI must map each intention/i);
  assert.match(prompt, /stay beside me when a child approaches/i);
  assert.match(prompt, /explicit user topic change always takes priority/i);
  assert.match(prompt, /first person singular/i);
});
