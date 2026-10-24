import test from "node:test";
import assert from "node:assert/strict";

import { cleanKnowledgeCandidate } from "../src/shared-knowledge-validation.js";

function safeCandidate(overrides = {}) {
  return {
    eligible: true,
    category: "kitchen",
    prompt_pattern: "How should unfamiliar items on a kitchen counter be handled?",
    answer_pattern: "Leave an item in place and ask before moving it when its storage location is unknown.",
    general_principle: "Avoid relocating personal belongings when their intended place is unclear.",
    context_tags: ["kitchen", "privacy_and_boundaries", "not_a_valid_topic"],
    key_terms: ["kitchen", "counter", "unknown item", "storage", "permission"],
    applicability: {
      conditions: ["the storage location is unknown"],
      exceptions: ["a specific storage routine has already been approved"],
      caution: ["do not assume permission to discard an item"]
    },
    limitations: ["This is a general planning rule, not a claim about robot capability."],
    ...overrides
  };
}

test("accepts and normalises a generalisable household principle", () => {
  const result = cleanKnowledgeCandidate(safeCandidate());
  assert.ok(result);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.context_tags, ["kitchen", "privacy_and_boundaries"]);
  assert.ok(result.key_terms.includes("unknown item"));
  assert.equal("fingerprint" in result, false);
});

test("rejects a candidate containing direct contact details or a physical address", () => {
  assert.equal(cleanKnowledgeCandidate(safeCandidate({
    answer_pattern: "Send the instructions to alice@example.com before moving anything."
  })), null);
  assert.equal(cleanKnowledgeCandidate(safeCandidate({
    answer_pattern: "Leave the item near 12 Example Street and ask before moving it."
  })), null);
});

test("rejects sensitive/private domains and first-person personal phrasing", () => {
  assert.equal(cleanKnowledgeCandidate(safeCandidate({
    general_principle: "The rule should account for an individual's medical history."
  })), null);
  assert.equal(cleanKnowledgeCandidate(safeCandidate({
    answer_pattern: "In my home, leave the item on my counter until I return."
  })), null);
});

test("rejects low-quality, non-eligible or unscoped candidates", () => {
  assert.equal(cleanKnowledgeCandidate({ ...safeCandidate(), eligible: false }), null);
  assert.equal(cleanKnowledgeCandidate(safeCandidate({ category: "finance" })), null);
  assert.equal(cleanKnowledgeCandidate(safeCandidate({ context_tags: [] })), null);
  assert.equal(cleanKnowledgeCandidate(safeCandidate({ key_terms: [] })), null);
});

test("caps the content fields and allowed tags", () => {
  const result = cleanKnowledgeCandidate(safeCandidate({
    prompt_pattern: "How should unfamiliar household items be handled when storage is not known? ".repeat(5),
    context_tags: ["kitchen", "fake_tag", "bathroom", "bathroom"],
    key_terms: ["Counter", "counter", "Permissions"]
  }));
  assert.ok(result);
  assert.ok(result.prompt_pattern.length <= 240);
  assert.deepEqual(result.context_tags, ["kitchen", "bathroom"]);
  assert.deepEqual(result.key_terms, ["counter", "permissions"]);
});
