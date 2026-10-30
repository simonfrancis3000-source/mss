import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHomeMemoryIndexRows,
  extractHomeMemoryKeys,
  extractHomeMemoryTopics,
  rankHomeMemoryCandidates
} from "../src/home-memory-index.js";

test("recognises rooms and household-task synonyms as searchable topics", () => {
  assert.ok(extractHomeMemoryTopics("Please leave the kitchen counter clear.").includes("kitchen"));
  assert.ok(extractHomeMemoryTopics("I usually hoover the rugs in the evening.").includes("vacuuming"));
  assert.ok(extractHomeMemoryTopics("Don't enter the bathroom when the door is shut.").includes("bathroom"));
  assert.ok(extractHomeMemoryKeys("Use the hoover").includes("topic:vacuuming"));
});

test("short answers inherit topic keys from the adjacent assistant question", () => {
  const history = [
    { role: "user", content: "I like the kitchen cleaned regularly.", timestamp: "2026-10-01T08:00:00.000Z" },
    { role: "assistant", content: "Would morning and evening be best for the kitchen counters?", timestamp: "2026-10-01T08:00:05.000Z" },
    { role: "user", content: "Twice a day, yes.", timestamp: "2026-10-01T08:00:10.000Z" }
  ];
  const rows = buildHomeMemoryIndexRows(history, "user-123");
  assert.ok(rows[2].topics.includes("kitchen"));
  assert.ok(rows[2].search_keys.includes("topic:kitchen"));
  const matches = rankHomeMemoryCandidates("How should we handle the kitchen?", history.slice(0, 2));
  assert.ok(matches.some((item) => item.content.includes("kitchen")));
});

test("retrieval ranks direct user statements above generic assistant questions", () => {
  const history = [
    { role: "assistant", content: "Would you like to discuss the kitchen?", timestamp: "2026-10-01T08:00:00.000Z" },
    { role: "user", content: "Please leave the kitchen worktop clear and ask before moving anything on it.", timestamp: "2026-10-01T08:01:00.000Z" },
    { role: "user", content: "The vacuum should avoid cables near the sofa.", timestamp: "2026-10-01T08:02:00.000Z" }
  ];
  const matches = rankHomeMemoryCandidates("What did I say about the kitchen counter?", history);
  assert.ok(matches.length > 0);
  assert.match(matches[0].content, /worktop clear/i);
});

test("archive row keys are stable and the archive covers both sides of a conversation", () => {
  const messages = [
    { role: "user", content: "Use the bathroom first.", timestamp: "2026-10-01T08:00:00.000Z" },
    { role: "assistant", content: "Should I leave the bathroom door shut?", timestamp: "2026-10-01T08:00:03.000Z" }
  ];
  const first = buildHomeMemoryIndexRows(messages, "user-123");
  const second = buildHomeMemoryIndexRows(messages, "user-123");
  assert.equal(first.length, 2);
  assert.deepEqual(first.map((row) => row.source_key), second.map((row) => row.source_key));
  assert.ok(first.every((row) => row.search_keys.includes("topic:bathroom")));
  assert.ok(first.every((row) => row.user_id === "user-123"));
});

test("empty or malformed inputs fail safely", () => {
  assert.deepEqual(extractHomeMemoryKeys("the and with"), []);
  assert.deepEqual(buildHomeMemoryIndexRows(null, "user-123"), []);
  assert.deepEqual(rankHomeMemoryCandidates("kitchen", null), []);
});


test("concept retrieval connects different wording for laundry preferences", () => {
  const archivedTurn = {
    role: "user",
    content: "I prefer dark garments stored separately from light items.",
    timestamp: "2026-10-12T08:00:00.000Z"
  };
  const query = "Where should my dark shirts go after washing?";
  assert.ok(extractHomeMemoryKeys(archivedTurn.content).includes("concept:laundry"));
  assert.ok(extractHomeMemoryKeys(query).includes("concept:laundry"));
  const matches = rankHomeMemoryCandidates(query, [archivedTurn]);
  assert.equal(matches[0]?.content, archivedTurn.content);
});

test("concept retrieval links everyday names for kitchenware", () => {
  const memory = {
    role: "user",
    content: "Please leave the cups and glasses on the draining rack.",
    timestamp: "2026-10-12T08:00:00.000Z"
  };
  const matches = rankHomeMemoryCandidates("What should happen to the mugs by the sink?", [memory]);
  assert.equal(matches[0]?.content, memory.content);
});
