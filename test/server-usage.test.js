import test from "node:test";
import assert from "node:assert/strict";
import { buildDeepSeekUsageEvent, createPhonicUsageSession, verifyPhonicUsageSession, clampVoiceDuration } from "../server/usage.js";

test("records DeepSeek Flash tokens with a timestamped rate snapshot", () => {
  const now = new Date("2026-10-31T12:00:00.000Z");
  const event = buildDeepSeekUsageEvent({
    userId: "user-123",
    requestId: "request-1",
    operation: "chat",
    now,
    result: {
      model: "deepseek-flash",
      usage: { prompt_tokens: 1000, completion_tokens: 400, total_tokens: 1400, prompt_tokens_details: { cached_tokens: 250 } }
    }
  });
  assert.equal(event.event_type, "deepseek_chat");
  assert.equal(event.status, "estimated");
  assert.equal(event.cache_hit_tokens, 250);
  assert.equal(event.cache_miss_tokens, 750);
  assert.equal(event.total_tokens, 1400);
  assert.equal(event.cost_method, "deepseek_usage_rate_card_estimate");
  assert.equal(event.pricing_snapshot.period, "off_peak");
  assert.ok(event.deepseek_cost_usd > 0);
});

test("rate card uses UTC weekdays and configured peak windows", () => {
  const event = buildDeepSeekUsageEvent({
    userId: "user-123",
    now: new Date("2026-10-30T07:00:00.000Z"),
    result: { usage: { prompt_tokens: 100, completion_tokens: 100 } }
  });
  assert.equal(event.pricing_snapshot.period, "peak");
});

test("voice usage sessions are signed for one user and expire", () => {
  const now = new Date("2026-10-31T10:00:00.000Z");
  const session = createPhonicUsageSession({ userId: "user-123", secret: "signing-secret", now, id: "12345678-1234-1234-1234-123456789abc" });
  assert.equal(verifyPhonicUsageSession(session, { userId: "user-123", secret: "signing-secret", now }), true);
  assert.equal(verifyPhonicUsageSession(session, { userId: "other-user", secret: "signing-secret", now }), false);
  assert.equal(verifyPhonicUsageSession(session, { userId: "user-123", secret: "wrong-secret", now }), false);
  assert.equal(verifyPhonicUsageSession(session, { userId: "user-123", secret: "signing-secret", now: new Date(now.getTime() + 5 * 60 * 60 * 1000) }), false);
});

test("voice durations are bounded", () => {
  assert.equal(clampVoiceDuration(90000, 100000), 90000);
  assert.equal(clampVoiceDuration(999999, 100000), 100000);
  assert.equal(clampVoiceDuration(-1, 100000), 0);
});


test("records a DeepSeek request as unpriced when token usage is absent", () => {
  const event = buildDeepSeekUsageEvent({
    userId: "user-123",
    requestId: "request-missing-usage",
    result: { model: "deepseek-flash" },
    now: new Date("2026-10-31T12:00:00.000Z")
  });
  assert.ok(event);
  assert.equal(event.event_type, "deepseek_chat");
  assert.equal(event.cost_method, "deepseek_usage_missing");
  assert.equal(event.metadata.token_usage_available, false);
  assert.equal(event.total_tokens, 0);
  assert.equal(event.deepseek_cost_usd, 0);
});
