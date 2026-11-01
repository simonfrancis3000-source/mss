import test from "node:test";
import assert from "node:assert/strict";
import {
  OUT_OF_HOME_STAGES,
  OUT_OF_HOME_CATEGORIES,
  getOutOfHomeCategories,
  findOutOfHomeScenario,
  buildOutOfHomeScenarioPrompt
} from "../src/out-of-home-training.js";

test("out-of-home training is organised into three progressive stages", () => {
  assert.equal(OUT_OF_HOME_STAGES.length, 3);
  for (const stage of OUT_OF_HOME_STAGES) {
    assert.ok(stage.title);
    assert.ok(stage.description);
    assert.ok(getOutOfHomeCategories(stage.id).length > 0, stage.id + " has no training categories");
  }
});

test("the scenario library covers the public, social and advanced domains", () => {
  assert.equal(OUT_OF_HOME_CATEGORIES.length, 9);
  const scenarios = OUT_OF_HOME_CATEGORIES.flatMap((category) => category.scenarios);
  assert.ok(scenarios.length >= 80, "Expected a substantial out-of-home scenario library");
  const ids = scenarios.map((scenario) => scenario.id);
  assert.equal(new Set(ids).size, ids.length, "Scenario IDs must be unique");
  for (const category of OUT_OF_HOME_CATEGORIES) {
    assert.ok(category.title);
    assert.ok(category.description);
    assert.ok(category.scenarios.length > 0);
    for (const scenario of category.scenarios) {
      assert.ok(scenario.title);
      assert.ok(scenario.situation);
      assert.ok(scenario.focus);
    }
  }
});

test("key stranger, child, public, animal, safety and relationship scenarios are present", () => {
  const required = [
    ["strangers", "adult-approaches"],
    ["strangers", "child-approaches"],
    ["strangers", "child-touch"],
    ["strangers", "home-address"],
    ["public-mobility", "road-crossing"],
    ["public-mobility", "public-transport"],
    ["known-people", "owner-introduction"],
    ["known-people", "repeat-contact"],
    ["public-safety", "owner-falls"],
    ["public-safety", "aggressive-person"],
    ["animals", "dog-aggressive"],
    ["animals", "injured-animal"],
    ["shops-services", "venue-refusal"],
    ["shops-services", "medical-visit"],
    ["social-intelligence", "private-conversation"],
    ["social-intelligence", "manipulation"],
    ["work-community", "airport"],
    ["work-community", "place-of-worship"],
    ["advanced-context", "conflicting-instructions"],
    ["advanced-context", "lost-owner"]
  ];
  for (const [categoryId, scenarioId] of required) {
    assert.ok(findOutOfHomeScenario(categoryId, scenarioId), categoryId + "/" + scenarioId + " is missing");
  }
});

test("scenario prompts guide AMÏA to ask progressively and preserve the AMÏA/PEXI boundary", () => {
  const match = findOutOfHomeScenario("strangers", "child-approaches");
  const prompt = buildOutOfHomeScenarioPrompt(match.category, match.scenario);
  assert.match(prompt, /one focused question at a time/i);
  assert.match(prompt, /only preferences I explicitly state or confirm/i);
  assert.match(prompt, /PEXI/i);
  assert.match(prompt, /physical action/i);
  assert.match(prompt, /child approaches/i);
  assert.throws(() => buildOutOfHomeScenarioPrompt(null, null), TypeError);
});
