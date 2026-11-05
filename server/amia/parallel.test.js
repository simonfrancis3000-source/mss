import test from "node:test";
import assert from "node:assert/strict";
import { searchParallel, fetchParallel } from "./parallel.js";
import { shouldUseWebSearch, knowledgeSearchQuery } from "./search.js";

test("appliance introduction triggers product research without personal details", () => {
  const message = "I live alone and my address is secret. I have a Siemens iQ700 dishwasher.";
  assert.equal(shouldUseWebSearch(message), true);
  assert.equal(knowledgeSearchQuery(message), "Siemens iQ700 dishwasher official manual specifications");
  assert.equal(shouldUseWebSearch("I wash my plates every evening."), false);
});

test("Parallel Search uses the current v1 endpoint and formats references", async () => {
  const prior = globalThis.fetch;
  let requested = null;
  globalThis.fetch = async (url, options) => {
    requested = { url, options };
    return {
      ok: true,
      json: async () => ({
        results: [{ url: "https://www.siemens-home.bsh-group.com/manual", title: "Siemens manual", publish_date: "2026-01-02", excerpts: ["Programme guidance"] }]
      })
    };
  };
  try {
    const results = await searchParallel("test-only-key", "Siemens iQ700 dishwasher operating manual", { count: 3 });
    assert.equal(requested.url, "https://api.parallel.ai/v1/search");
    assert.equal(requested.options.headers["x-api-key"], "test-only-key");
    assert.equal(JSON.parse(requested.options.body).mode, "fast");
    assert.equal(results[0].provider, "parallel");
    assert.match(results[0].content, /Programme guidance/);
    assert.equal(results[0].date, "2026-01-02");
  } finally {
    globalThis.fetch = prior;
  }
});

test("Parallel Extract retrieves focused public-page content", async () => {
  const prior = globalThis.fetch;
  let requested = null;
  globalThis.fetch = async (url, options) => {
    requested = { url, options };
    return { ok: true, json: async () => ({ results: [{ url: "https://www.example.com/manual.pdf", title: "Manual", excerpts: ["Use Eco mode"] }] }) };
  };
  try {
    const result = await fetchParallel("test-only-key", "https://www.example.com/manual.pdf");
    assert.equal(requested.url, "https://api.parallel.ai/v1/extract");
    assert.deepEqual(JSON.parse(requested.options.body).urls, ["https://www.example.com/manual.pdf"]);
    assert.match(result.content, /Eco mode/);
  } finally {
    globalThis.fetch = prior;
  }
});

test("Extract rejects private network and credential-bearing URLs", async () => {
  await assert.rejects(() => fetchParallel("key", "http://127.0.0.1/admin"), /Only public/);
  await assert.rejects(() => fetchParallel("key", "https://example.com:pass@www.example.com/"), /Only public/);
});
