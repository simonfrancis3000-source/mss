import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("all provider-backed API routes require verified Supabase users", async () => {
  const source = await readFile(new URL("../server/index.js", import.meta.url), "utf8");
  for (const route of ["/api/chat", "/api/memory/extract", "/api/knowledge/extract", "/api/phonic/session", "/api/phonic/usage"]) {
    assert.match(source, new RegExp('"' + route.replaceAll("/", "\\/") + '"'));
  }
  assert.match(source, /authenticateSupabaseRequest\(request/);
  assert.match(source, /authResult\.ok/);
  assert.match(source, /rateLimitIdentity\(userId, ip\)/);
  assert.match(source, /MAX_REQUESTS_PER_MINUTE, authContext\.user\.id/);
  assert.doesNotMatch(source, /Access-Control-Allow-Headers": "Content-Type"/);
});

test("DeepSeek usage is captured for reply and structured extraction calls", async () => {
  const source = await readFile(new URL("../server/index.js", import.meta.url), "utf8");
  assert.match(source, /recordDeepSeekUsage\(authContext, result, "chat"\)/);
  assert.match(source, /recordDeepSeekUsage\(authContext, result, "memory_extract"\)/);
  assert.match(source, /recordDeepSeekUsage\(authContext, result, "knowledge_extract"\)/);
  assert.match(source, /rest\/v1\/synqme_usage_events/);
});

test("Phonic usage reports require a signed, account-bound receipt", async () => {
  const server = await readFile(new URL("../server/index.js", import.meta.url), "utf8");
  const usage = await readFile(new URL("../server/usage.js", import.meta.url), "utf8");
  assert.match(server, /verifyPhonicUsageSession\(usageSession, \{ userId: authContext\.user\.id/);
  assert.match(server, /event_type: "phonic_voice"/);
  assert.match(server, /request_id: usageSession\.id/);
  assert.match(usage, /timingSafeEqual/);
});

test("frontend sends the signed-in access token with all five protected provider requests", async () => {
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  assert.match(source, /async function authenticatedApiHeaders/);
  assert.match(source, /Authorization: "Bearer " \+ token/);
  const calls = source.match(/headers: await authenticatedApiHeaders\(\)/g) || [];
  assert.equal(calls.length, 5);
});

test("PEXI export contains the generic capability plan and never claims physical execution", async () => {
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  const plan = await readFile(new URL("../src/pexi-readiness.js", import.meta.url), "utf8");
  assert.match(source, /pexi_capability_plan: pexiCapabilityPlan/);
  assert.match(plan, /compatibility_claimed: false/);
  assert.match(plan, /physical_actions_enabled: false/);
  assert.match(source, /AWAITING ROBOT SPEC/);
  assert.match(source, /pexiCapabilityPlan\.tasks/);
});
