import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPersonaMemorySearchKeys,
  cleanPersonaMemoryCandidate,
  deriveMemoryKind,
  deriveMemoryScopeKey,
  deriveMemoryTopic,
  makePersonaMemoryKey,
  memoryIsActive,
  preferenceToPersonaMemory,
  rankPersonaMemories,
  shouldExtractPersonaMemory
} from "../src/persona-memory.js";
import { selectHouseholdSkills } from "../src/household-skills.js";

test("creates stable, source-linked memory keys and derives useful household metadata", () => {
  assert.equal(makePersonaMemoryKey("I prefer wiping the kitchen after breakfast."), makePersonaMemoryKey(" I prefer wiping the kitchen after breakfast. "));
  assert.equal(deriveMemoryKind("Never move the things on my desk."), "boundary");
  assert.equal(deriveMemoryKind("I usually clean the kitchen after breakfast."), "routine");
  assert.equal(deriveMemoryTopic("I wipe the kitchen worktop after breakfast."), "kitchen");
  assert.match(deriveMemoryScopeKey("I wipe the kitchen worktop after breakfast.", "kitchen", "routine"), /^kitchen\.routine\./);
  assert.ok(buildPersonaMemorySearchKeys("wipe the worktop", ["counter", "surface cleaning"], "kitchen").includes("topic:kitchen"));
});

test("validates model extraction output and rejects sensitive credentials", () => {
  const candidate = cleanPersonaMemoryCandidate({
    statement: "Please leave items on the kitchen counter where they are unless I ask you to move them.",
    topic: "kitchen",
    kind: "boundary",
    scope_key: "kitchen.counter.item_placement",
    relation: "new",
    confidence: 0.94,
    conditions: ["Only move items after explicit permission"],
    attributes: { room: "kitchen", ask_first: true },
    search_terms: ["countertop", "personal items", "put away"]
  });
  assert.ok(candidate);
  assert.equal(candidate.status, "user_stated");
  assert.equal(candidate.topic, "kitchen");
  assert.equal(candidate.kind, "boundary");
  assert.equal(candidate.confidence, 0.94);
  assert.equal(cleanPersonaMemoryCandidate({ statement: "My door code is 12345678", topic: "safety_and_access" }), null);
  assert.equal(cleanPersonaMemoryCandidate(null), null);
});

test("retrieval ranks topical confirmed memory and excludes archived or superseded records", () => {
  const memories = [
    {
      id: "kitchen",
      memory_key: "kitchen-1",
      topic: "kitchen",
      kind: "routine",
      statement: "I prefer the kitchen worktop wiped after breakfast.",
      search_keys: buildPersonaMemorySearchKeys("I prefer the kitchen worktop wiped after breakfast.", [], "kitchen"),
      status: "user_confirmed",
      confidence: 0.98,
      updated_at: "2026-10-24T12:00:00Z"
    },
    {
      id: "laundry",
      memory_key: "laundry-1",
      topic: "laundry",
      statement: "Keep dark clothes separate.",
      search_keys: buildPersonaMemorySearchKeys("Keep dark clothes separate.", [], "laundry"),
      status: "user_confirmed",
      confidence: 0.98
    },
    {
      id: "old",
      memory_key: "old-1",
      topic: "kitchen",
      statement: "Clean the kitchen in the evening.",
      search_keys: buildPersonaMemorySearchKeys("Clean the kitchen in the evening.", [], "kitchen"),
      status: "superseded",
      confidence: 0.9
    },
    {
      id: "conflict",
      memory_key: "conflict-1",
      topic: "kitchen",
      statement: "On weekends, leave the worktop until later.",
      search_keys: buildPersonaMemorySearchKeys("On weekends, leave the worktop until later.", [], "kitchen"),
      status: "conflicting",
      confidence: 0.9
    }
  ];
  const ranked = rankPersonaMemories("How should I handle the kitchen counter after breakfast?", memories, { limit: 5 });
  assert.ok(ranked.some((memory) => memory.id === "kitchen"));
  assert.ok(ranked.some((memory) => memory.id === "conflict"));
  assert.ok(!ranked.some((memory) => memory.id === "old"));
  assert.ok(!ranked.some((memory) => memory.id === "laundry"));
  assert.equal(memoryIsActive(memories[2]), false);
});

test("backfills legacy preferences as structured, user-owned records", () => {
  const row = preferenceToPersonaMemory({
    id: "pref-1",
    text: "I prefer the kitchen worktop wiped after breakfast.",
    category: "Surface cleaning",
    status: "user_confirmed",
    unresolvedFields: ["approved spray"],
    explicitFacets: { room: "kitchen" },
    sourceMessage: "I prefer the kitchen worktop wiped after breakfast.",
    recordedAt: "2026-10-23T09:00:00Z"
  }, "user-123");
  assert.ok(row);
  assert.equal(row.user_id, "user-123");
  assert.equal(row.source_preference_id, "pref-1");
  assert.equal(row.status, "user_confirmed");
  assert.equal(row.source_message, row.statement);
  assert.deepEqual(row.conditions, ["approved spray"]);
});

test("only preference-like turns trigger extraction, rather than ordinary questions", () => {
  assert.equal(shouldExtractPersonaMemory("What is the best home robot?"), false);
  assert.equal(shouldExtractPersonaMemory("I prefer cleaning the kitchen after breakfast."), true);
  assert.equal(shouldExtractPersonaMemory("Could you remember that I never want my desk items moved?"), true);
  assert.equal(shouldExtractPersonaMemory("What's my door code?"), false);
  assert.equal(shouldExtractPersonaMemory("A saved preference was just added.", true), true);
});

test("task playbooks are selected separately from personal memories", () => {
  const kitchenSkills = selectHouseholdSkills("I want the kitchen worktop wiped after breakfast.");
  assert.ok(kitchenSkills.some((skill) => skill.id === "kitchen-reset"));
  assert.ok(kitchenSkills.some((skill) => skill.id === "surface-care"));
  const laundrySkills = selectHouseholdSkills("How should I separate delicate laundry?");
  assert.ok(laundrySkills.some((skill) => skill.id === "laundry-care"));
  assert.ok(!laundrySkills.some((skill) => skill.id === "kitchen-reset"));
  assert.ok(kitchenSkills.every((skill) => !("userMemory" in skill)));
});
