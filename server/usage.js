import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const DEEPSEEK_FLASH_RATES = Object.freeze({
  off_peak: { cache_hit: 0.003, cache_miss: 0.15, output: 0.6 },
  peak: { cache_hit: 0.006, cache_miss: 0.3, output: 1.2 }
});

function count(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

export function deepSeekRatePeriod(date = new Date()) {
  const day = date.getUTCDay();
  const hour = date.getUTCHours();
  const weekday = day >= 1 && day <= 5;
  const peakHour = (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
  return weekday && peakHour ? "peak" : "off_peak";
}

export function buildDeepSeekUsageEvent({
  userId,
  result,
  operation = "chat",
  requestId = randomUUID(),
  now = new Date()
} = {}) {
  const usage = result?.usage;
  if (!usage || !userId) return null;

  const promptTokens = count(usage.prompt_tokens);
  const completionTokens = count(usage.completion_tokens);
  if (!promptTokens && !completionTokens) return null;

  const promptDetails = usage.prompt_tokens_details || usage.promptTokensDetails || {};
  const cacheHitTokens = Math.min(promptTokens, count(
    usage.prompt_cache_hit_tokens ?? usage.cache_hit_tokens ?? promptDetails.cached_tokens ?? promptDetails.cache_hit_tokens
  ));
  const reportedCacheMiss = usage.prompt_cache_miss_tokens ?? usage.cache_miss_tokens ??
    promptDetails.cache_miss_tokens;
  const cacheMissTokens = reportedCacheMiss === undefined || reportedCacheMiss === null
    ? Math.max(0, promptTokens - cacheHitTokens)
    : Math.min(promptTokens, count(reportedCacheMiss));
  const period = deepSeekRatePeriod(now);
  const rates = DEEPSEEK_FLASH_RATES[period];
  const cost = (
    cacheHitTokens * rates.cache_hit +
    cacheMissTokens * rates.cache_miss +
    completionTokens * rates.output
  ) / 1_000_000;

  return {
    user_id: userId,
    event_type: "deepseek_chat",
    provider: "deepseek",
    model: String(result.model || "deepseek-flash").slice(0, 100),
    request_id: requestId,
    status: "estimated",
    prompt_tokens: promptTokens,
    cache_hit_tokens: cacheHitTokens,
    cache_miss_tokens: cacheMissTokens,
    completion_tokens: completionTokens,
    total_tokens: count(usage.total_tokens) || promptTokens + completionTokens,
    deepseek_cost_usd: Number(cost.toFixed(12)),
    currency: "USD",
    cost_method: "deepseek_usage_rate_card_estimate",
    pricing_snapshot: {
      rate_card: "DeepSeek Flash",
      period,
      rates_usd_per_million_tokens: rates,
      source: "https://api-docs.deepseek.com/quick_start/pricing/",
      holiday_calendar_applied: false,
      captured_at: now.toISOString()
    },
    metadata: {
      operation: String(operation).slice(0, 60),
      usage_source: "provider_response",
      cache_miss_derived: reportedCacheMiss === undefined || reportedCacheMiss === null
    },
    started_at: now.toISOString(),
    ended_at: now.toISOString()
  };
}

export function createPhonicUsageSession({ userId, secret, now = new Date(), id = randomUUID() } = {}) {
  if (!userId || !secret) throw new Error("Usage signing is not configured.");
  const startedAt = now.toISOString();
  const signature = createHmac("sha256", secret)
    .update([id, userId, startedAt].join("."))
    .digest("hex");
  return { id, startedAt, signature };
}

export function verifyPhonicUsageSession(session, { userId, secret, now = new Date(), maxAgeMs = 4 * 60 * 60 * 1000 } = {}) {
  if (!session || typeof session.id !== "string" || typeof session.startedAt !== "string" ||
      typeof session.signature !== "string" || !userId || !secret) return false;
  if (!/^[0-9a-f-]{36}$/i.test(session.id) || !/^[0-9a-f]{64}$/i.test(session.signature)) return false;
  const startedAtMs = Date.parse(session.startedAt);
  const age = now.getTime() - startedAtMs;
  if (!Number.isFinite(startedAtMs) || age < -60_000 || age > maxAgeMs) return false;
  const expected = createHmac("sha256", secret)
    .update([session.id, userId, session.startedAt].join("."))
    .digest();
  const supplied = Buffer.from(session.signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function clampVoiceDuration(value, maxMs) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(Math.floor(numeric), maxMs);
}
