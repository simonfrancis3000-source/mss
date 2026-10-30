import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://ltqbjqtzsdzglswuqkip.supabase.co").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";
const SUPABASE_ADMIN_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const authClient = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;

export const adminDb = SUPABASE_URL && SUPABASE_ADMIN_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;

export const usageTrackingConfigured = Boolean(adminDb);
export const PHONIC_COST_PER_MINUTE_USD = Number.isFinite(Number(process.env.PHONIC_COST_PER_MINUTE_USD)) && Number(process.env.PHONIC_COST_PER_MINUTE_USD) > 0
  ? Number(process.env.PHONIC_COST_PER_MINUTE_USD)
  : null;

const ADMIN_EMAILS = new Set((process.env.ADMIN_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
const ADMIN_USER_IDS = new Set((process.env.ADMIN_USER_IDS || "").split(",").map((value) => value.trim()).filter(Boolean));
const SEARCH_FETCH_COST_PER_SUCCESS_USD = 0.75 / 1000;

export function httpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function requireAuthenticatedUser(request) {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw httpError("Sign in to continue.", 401);
  if (!authClient) throw httpError("Supabase server authentication is not configured. Set SUPABASE_ANON_KEY on the API service.", 503);
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user || data.user.is_anonymous) throw httpError("Your session is not valid. Sign in again.", 401);
  return data.user;
}

export function requireAdminUser(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  if (!ADMIN_EMAILS.size && !ADMIN_USER_IDS.size) {
    throw httpError("Admin access has not been configured. Set ADMIN_EMAILS or ADMIN_USER_IDS on the API service.", 503);
  }
  if (!ADMIN_USER_IDS.has(user.id) && (!email || !ADMIN_EMAILS.has(email))) {
    throw httpError("This account is not authorised to view SYNQ.ME administration.", 403);
  }
}

function isDeepseekPeak(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return false;
  const weekday = date.getUTCDay();
  const hour = date.getUTCHours();
  const utcDate = date.toISOString().slice(0, 10);
  const holidays = new Set((process.env.DEEPSEEK_CHINA_PUBLIC_HOLIDAYS || "").split(",").map((value) => value.trim()).filter(Boolean));
  return weekday >= 1 && weekday <= 5 && !holidays.has(utcDate) &&
    ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
}

function priceDeepseek(model, usage, timestamp) {
  const requestedModel = String(model || "deepseek-flash");
  // DeepSeek's September 2026 notice says V4-Pro requests are routed and billed at V4.1-Flash rates.
  const rateModel = requestedModel === "deepseek-v4-pro" && new Date(timestamp).getTime() < Date.parse("2026-09-14T04:00:00Z")
    ? "deepseek-v4-pro"
    : "deepseek-flash";
  const base = rateModel === "deepseek-v4-pro"
    ? { miss: 0.66, hit: 0.022, output: 1.98 }
    : { miss: 0.15, hit: 0.003, output: 0.60 };
  const peak = isDeepseekPeak(timestamp);
  const multiplier = peak ? 2 : 1;
  const promptTokens = Math.max(0, Number(usage?.promptTokens || 0));
  const cacheHitTokens = Math.max(0, Math.min(promptTokens, Number(usage?.cacheHitTokens || 0)));
  const cacheMissTokens = Math.max(0, Number(usage?.cacheMissTokens ?? (promptTokens - cacheHitTokens)));
  const completionTokens = Math.max(0, Number(usage?.completionTokens || 0));
  const deepseekCostUsd = multiplier * (
    cacheHitTokens * base.hit + cacheMissTokens * base.miss + completionTokens * base.output
  ) / 1_000_000;
  const searchRequests = Math.max(0, Number(usage?.searchRequests || 0));
  const fetchRequests = Math.max(0, Number(usage?.fetchRequests || 0));
  return {
    deepseekCostUsd,
    searchCostUsd: searchRequests * SEARCH_FETCH_COST_PER_SUCCESS_USD,
    fetchCostUsd: fetchRequests * SEARCH_FETCH_COST_PER_SUCCESS_USD,
    searchRequests,
    fetchRequests,
    snapshot: {
      requestedModel,
      billedRateModel: rateModel,
      tier: peak ? "peak" : "off_peak",
      multiplier,
      peakPricingUtc: "Mon-Fri 01:00-04:00 and 06:00-10:00 UTC; Chinese public holidays excluded when configured",
      inputCacheMissUsdPerMillion: base.miss * multiplier,
      inputCacheHitUsdPerMillion: base.hit * multiplier,
      outputUsdPerMillion: base.output * multiplier,
      searchUsdPerSuccessfulRequest: SEARCH_FETCH_COST_PER_SUCCESS_USD,
      fetchUsdPerSuccessfulRequest: SEARCH_FETCH_COST_PER_SUCCESS_USD
    }
  };
}

export async function recordDeepseekUsage({ userId, model, usage = {}, timestamp = new Date().toISOString(), webSearchStatus = "not_requested", relevantPreferenceCount = 0 }) {
  if (!adminDb) return false;
  const pricing = priceDeepseek(model, usage, timestamp);
  const { error } = await adminDb.from("synqme_usage_events").insert({
    user_id: userId,
    event_type: "deepseek_chat",
    provider: "deepseek",
    model: String(usage.providerModel || model || "deepseek-flash"),
    request_id: randomUUID(),
    status: Number(usage.totalTokens || 0) > 0 ? "complete" : "estimated",
    prompt_tokens: Math.max(0, Number(usage.promptTokens || 0)),
    cache_hit_tokens: Math.max(0, Number(usage.cacheHitTokens || 0)),
    cache_miss_tokens: Math.max(0, Number(usage.cacheMissTokens || 0)),
    completion_tokens: Math.max(0, Number(usage.completionTokens || 0)),
    total_tokens: Math.max(0, Number(usage.totalTokens || 0)),
    search_requests: pricing.searchRequests,
    fetch_requests: pricing.fetchRequests,
    deepseek_cost_usd: pricing.deepseekCostUsd,
    search_cost_usd: pricing.searchCostUsd,
    fetch_cost_usd: pricing.fetchCostUsd,
    cost_method: Number(usage.totalTokens || 0) > 0 ? "deepseek_usage_and_timestamp_rate_card" : "deepseek_usage_missing",
    pricing_snapshot: pricing.snapshot,
    metadata: { webSearchStatus, relevantPreferenceCount },
    created_at: timestamp
  });
  if (error) {
    console.error("Could not write DeepSeek usage event:", String(error.message || error).slice(0, 250));
    return false;
  }
  return true;
}

export async function recordSearchFetchUsage({ userId, type }) {
  if (!adminDb) return false;
  const isSearch = type === "search";
  const event = {
    user_id: userId,
    event_type: isSearch ? "deepseek_search" : "deepseek_fetch",
    provider: isSearch ? "deepseek-search" : "deepseek-fetch",
    model: isSearch ? "search" : "fetch",
    request_id: randomUUID(),
    search_requests: isSearch ? 1 : 0,
    fetch_requests: isSearch ? 0 : 1,
    search_cost_usd: isSearch ? SEARCH_FETCH_COST_PER_SUCCESS_USD : 0,
    fetch_cost_usd: isSearch ? 0 : SEARCH_FETCH_COST_PER_SUCCESS_USD,
    cost_method: isSearch ? "successful_search_request_rate" : "successful_fetch_request_rate",
    pricing_snapshot: isSearch
      ? { searchUsdPerSuccessfulRequest: SEARCH_FETCH_COST_PER_SUCCESS_USD }
      : { fetchUsdPerSuccessfulRequest: SEARCH_FETCH_COST_PER_SUCCESS_USD }
  };
  const { error } = await adminDb.from("synqme_usage_events").insert(event);
  if (error) console.error("Could not write Search/Fetch usage event:", String(error.message || error).slice(0, 250));
  return !error;
}

export async function createPhonicUsageSession(userId) {
  if (!adminDb) throw httpError("Voice usage tracking is not configured. Set SUPABASE_SECRET_KEY on the API service.", 503);
  const usageId = randomUUID();
  const startedAt = new Date().toISOString();
  const { error } = await adminDb.from("synqme_usage_events").insert({
    id: usageId,
    user_id: userId,
    event_type: "phonic_voice",
    provider: "phonic",
    status: "pending",
    started_at: startedAt,
    cost_method: "awaiting_phonic_saved_conversation",
    phonic_rate_per_minute_usd: PHONIC_COST_PER_MINUTE_USD
  });
  if (error) throw httpError("Could not create the voice usage record: " + String(error.message || error).slice(0, 180), 503);
  return { usageId, startedAt };
}

export async function linkPhonicConversation(userId, usageId, conversationId) {
  if (!adminDb) throw httpError("Voice usage tracking is not configured.", 503);
  const { data, error } = await adminDb.from("synqme_usage_events")
    .update({ provider_conversation_id: conversationId })
    .eq("id", usageId).eq("user_id", userId).eq("event_type", "phonic_voice")
    .select("id").maybeSingle();
  if (error) throw httpError("Could not link the Phonic conversation.", 502);
  if (!data) throw httpError("Voice usage session not found for this account.", 404);
}

async function fetchPhonicConversation(apiKey, conversationId) {
  if (!apiKey || !conversationId) return null;
  const response = await fetch("https://api.phonic.ai/v1/conversations/" + encodeURIComponent(conversationId), {
    headers: { Authorization: "Bearer " + apiKey },
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload?.conversation || payload?.data?.conversation || payload?.data || payload;
}

async function reconcilePhonicEvent(event, apiKey, fallbackDurationMs = null, maxAttempts = 4) {
  if (!adminDb || !event?.id) return null;
  let conversation = null;
  if (event.provider_conversation_id) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      conversation = await fetchPhonicConversation(apiKey, event.provider_conversation_id).catch(() => null);
      if (conversation && Number(conversation.duration_ms) >= 0 && conversation.ended_at) break;
      conversation = null;
      if (attempt + 1 < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 650));
    }
  }

  if (conversation && Number(conversation.duration_ms) >= 0 && conversation.ended_at) {
    const items = Array.isArray(conversation.items) ? conversation.items : [];
    const userSpeechMs = items.filter((item) => item?.role === "user").reduce((sum, item) => sum + Math.max(0, Number(item.duration_ms || 0)), 0);
    const assistantSpeechMs = items.filter((item) => item?.role === "assistant").reduce((sum, item) => sum + Math.max(0, Number(item.duration_ms || 0)), 0);
    const durationMs = Math.max(0, Number(conversation.duration_ms || 0));
    const phonicCost = PHONIC_COST_PER_MINUTE_USD === null ? null : PHONIC_COST_PER_MINUTE_USD * durationMs / 60000;
    const { error } = await adminDb.from("synqme_usage_events").update({
      provider_conversation_id: String(conversation.id || event.provider_conversation_id),
      status: "complete",
      voice_duration_ms: durationMs,
      user_speech_ms: userSpeechMs,
      assistant_speech_ms: assistantSpeechMs,
      phonic_cost_usd: phonicCost,
      phonic_rate_per_minute_usd: PHONIC_COST_PER_MINUTE_USD,
      cost_method: "phonic_saved_conversation_duration",
      started_at: conversation.started_at || event.started_at,
      ended_at: conversation.ended_at,
      pricing_snapshot: { phonicRatePerMinuteUsd: PHONIC_COST_PER_MINUTE_USD, durationSource: "Phonic saved conversation API", roundingAssumption: "Unrounded duration_ms / 60000" },
      metadata: { providerModel: conversation.model || null, voiceId: items.find((item) => item?.role === "assistant" && item?.voice_id)?.voice_id || null }
    }).eq("id", event.id);
    if (error) console.error("Could not reconcile Phonic usage event:", String(error.message || error).slice(0, 250));
    return { durationMs, source: "phonic" };
  }

  if (Number(fallbackDurationMs) > 0) {
    const durationMs = Math.max(0, Math.round(Number(fallbackDurationMs)));
    const estimatedCost = PHONIC_COST_PER_MINUTE_USD === null ? null : PHONIC_COST_PER_MINUTE_USD * durationMs / 60000;
    const { error } = await adminDb.from("synqme_usage_events").update({
      status: "estimated",
      voice_duration_ms: durationMs,
      phonic_cost_usd: estimatedCost,
      phonic_rate_per_minute_usd: PHONIC_COST_PER_MINUTE_USD,
      cost_method: "browser_elapsed_duration_estimate",
      pricing_snapshot: { phonicRatePerMinuteUsd: PHONIC_COST_PER_MINUTE_USD, durationSource: "Browser connected-time fallback" }
    }).eq("id", event.id);
    if (error) console.error("Could not save estimated Phonic usage:", String(error.message || error).slice(0, 250));
    return { durationMs, source: "browser_estimate" };
  }
  return null;
}

export async function completePhonicUsageSession(userId, apiKey, { usageId, conversationId = "", clientDurationMs = 0 } = {}) {
  if (!adminDb) throw httpError("Voice usage tracking is not configured.", 503);
  if (!usageId) throw httpError("A voice usage ID is required.", 400);
  const { data: event, error } = await adminDb.from("synqme_usage_events")
    .select("id,user_id,event_type,provider_conversation_id,started_at,status")
    .eq("id", usageId).eq("user_id", userId).eq("event_type", "phonic_voice").maybeSingle();
  if (error) throw httpError("Could not find the voice usage session.", 502);
  if (!event) throw httpError("Voice usage session not found for this account.", 404);
  if (conversationId && conversationId !== event.provider_conversation_id) {
    const { error: linkError } = await adminDb.from("synqme_usage_events")
      .update({ provider_conversation_id: conversationId }).eq("id", usageId).eq("user_id", userId);
    if (linkError) throw httpError("Could not link the final Phonic conversation.", 502);
    event.provider_conversation_id = conversationId;
  }
  return await reconcilePhonicEvent(event, apiKey, clientDurationMs) || { source: "pending", durationMs: null };
}

async function readUsageRows(fromDate, toDate) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 100000; offset += pageSize) {
    let query = adminDb.from("synqme_usage_events").select("*").order("created_at", { ascending: false });
    if (fromDate) query = query.gte("created_at", fromDate);
    if (toDate) query = query.lte("created_at", toDate);
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw httpError("Could not read the usage ledger: " + String(error.message || error).slice(0, 200), 502);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function listAllAuthUsers() {
  const users = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await adminDb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw httpError("Could not read registered users: " + String(error.message || error).slice(0, 200), 502);
    const current = data?.users || [];
    users.push(...current);
    if (current.length < 1000) break;
  }
  return users;
}

export async function buildAdminUsageDashboard(period = "30d", phonicApiKey = "") {
  if (!adminDb) throw httpError("The usage database is not configured. Set SUPABASE_SECRET_KEY on the API service.", 503);
  const now = new Date();
  const fromDate = period === "all" ? null : new Date(now.getTime() - ({ "7d": 7, "30d": 30, "90d": 90 }[period] || 30) * 86400000).toISOString();
  const toDate = now.toISOString();

  const pendingQuery = await adminDb.from("synqme_usage_events")
    .select("id,user_id,event_type,provider_conversation_id,started_at,status")
    .eq("event_type", "phonic_voice").in("status", ["pending", "estimated"])
    .not("provider_conversation_id", "is", null).order("created_at", { ascending: false }).limit(10);
  if (!pendingQuery.error) {
    await Promise.all((pendingQuery.data || []).map((event) => reconcilePhonicEvent(event, phonicApiKey, null, 1)));
  }

  const [authUsers, events, profileResult, oldestEvent] = await Promise.all([
    listAllAuthUsers(),
    readUsageRows(fromDate, toDate),
    adminDb.from("synqme_profiles").select("user_id,owner_name"),
    adminDb.from("synqme_usage_events").select("created_at").order("created_at", { ascending: true }).limit(1).maybeSingle()
  ]);
  const profileNames = new Map((profileResult.data || []).map((profile) => [profile.user_id, profile.owner_name || ""]));
  const byUser = new Map();
  const zero = () => ({
    chatRequests: 0, voiceSessions: 0, voiceMinutes: 0, userSpeechMinutes: 0, assistantSpeechMinutes: 0,
    inputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, outputTokens: 0, searchRequests: 0, fetchRequests: 0,
    deepseekCostUsd: 0, searchCostUsd: 0, fetchCostUsd: 0, deepseekUnpricedRequests: 0, phonicCostUsd: 0, phonicUnpricedSessions: 0,
    pendingVoiceSessions: 0, lastActivityAt: null
  });
  for (const user of authUsers) byUser.set(user.id, {
    userId: user.id, email: user.email || "", createdAt: user.created_at || null,
    ownerName: profileNames.get(user.id) || "", ...zero()
  });

  for (const event of events) {
    const aggregate = byUser.get(event.user_id) || { userId: event.user_id, email: "", createdAt: null, ownerName: "", ...zero() };
    if (!aggregate.lastActivityAt || (event.created_at && event.created_at > aggregate.lastActivityAt)) aggregate.lastActivityAt = event.created_at;
    if (event.event_type === "deepseek_chat") {
      aggregate.chatRequests += 1;
      aggregate.inputTokens += Number(event.prompt_tokens || 0);
      aggregate.cacheHitTokens += Number(event.cache_hit_tokens || 0);
      aggregate.cacheMissTokens += Number(event.cache_miss_tokens || 0);
      aggregate.outputTokens += Number(event.completion_tokens || 0);
      aggregate.searchRequests += Number(event.search_requests || 0);
      aggregate.fetchRequests += Number(event.fetch_requests || 0);
      aggregate.deepseekCostUsd += Number(event.deepseek_cost_usd || 0);
      aggregate.searchCostUsd += Number(event.search_cost_usd || 0);
      aggregate.fetchCostUsd += Number(event.fetch_cost_usd || 0);
      if (event.status === "estimated" || event.cost_method === "deepseek_usage_missing") aggregate.deepseekUnpricedRequests += 1;
    } else if (event.event_type === "deepseek_search") {
      aggregate.searchRequests += Number(event.search_requests || 0);
      aggregate.searchCostUsd += Number(event.search_cost_usd || 0);
    } else if (event.event_type === "deepseek_fetch") {
      aggregate.fetchRequests += Number(event.fetch_requests || 0);
      aggregate.fetchCostUsd += Number(event.fetch_cost_usd || 0);
    } else if (event.event_type === "phonic_voice") {
      aggregate.voiceSessions += 1;
      aggregate.voiceMinutes += Number(event.voice_duration_ms || 0) / 60000;
      aggregate.userSpeechMinutes += Number(event.user_speech_ms || 0) / 60000;
      aggregate.assistantSpeechMinutes += Number(event.assistant_speech_ms || 0) / 60000;
      if (event.phonic_cost_usd === null || event.phonic_cost_usd === undefined) aggregate.phonicUnpricedSessions += 1;
      else aggregate.phonicCostUsd += Number(event.phonic_cost_usd || 0);
      if (event.status === "pending") aggregate.pendingVoiceSessions += 1;
    }
    byUser.set(event.user_id, aggregate);
  }

  const totals = {
    registeredUsers: authUsers.length,
    activeUsers: 0, chatRequests: 0, voiceSessions: 0, voiceMinutes: 0, userSpeechMinutes: 0, assistantSpeechMinutes: 0,
    inputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, outputTokens: 0, searchRequests: 0, fetchRequests: 0,
    deepseekCostUsd: 0, searchCostUsd: 0, fetchCostUsd: 0, deepseekUnpricedRequests: 0, phonicCostUsd: 0, phonicUnpricedSessions: 0, pendingVoiceSessions: 0
  };
  for (const user of byUser.values()) {
    if (user.chatRequests || user.voiceSessions || user.searchRequests || user.fetchRequests) totals.activeUsers += 1;
    for (const key of Object.keys(totals)) {
      if (key === "registeredUsers" || key === "activeUsers") continue;
      if (Object.prototype.hasOwnProperty.call(user, key)) totals[key] += user[key];
    }
  }
  totals.knownCostUsd = Number((totals.deepseekCostUsd + totals.searchCostUsd + totals.fetchCostUsd + totals.phonicCostUsd).toFixed(10));
  const users = [...byUser.values()].sort((a, b) =>
    (b.deepseekCostUsd + b.searchCostUsd + b.fetchCostUsd + b.phonicCostUsd) -
    (a.deepseekCostUsd + a.searchCostUsd + a.fetchCostUsd + a.phonicCostUsd)
  );
  return {
    period: { key: period, from: fromDate, to: toDate },
    trackingStartedAt: oldestEvent?.data?.created_at || null,
    phonicRatePerMinuteUsd: PHONIC_COST_PER_MINUTE_USD,
    totals,
    users,
    recentEvents: events.slice(0, 30).map((event) => ({
      id: event.id, userId: event.user_id, type: event.event_type, provider: event.provider, model: event.model,
      status: event.status, createdAt: event.created_at, voiceDurationMs: event.voice_duration_ms,
      promptTokens: event.prompt_tokens, completionTokens: event.completion_tokens,
      totalCostUsd: Number(event.deepseek_cost_usd || 0) + Number(event.search_cost_usd || 0) + Number(event.fetch_cost_usd || 0) + Number(event.phonic_cost_usd || 0),
      costMethod: event.cost_method
    }))
  };
}
