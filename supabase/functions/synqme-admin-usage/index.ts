import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
function readKey(envName: string): string {
  const raw = Deno.env.get(envName) ?? "";
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return String(parsed.default || Object.values(parsed)[0] || "");
    }
  } catch {}
  return raw;
}
const SECRET_KEY = readKey("SUPABASE_SECRET_KEYS") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ADMIN_USER_IDS = new Set(["c00dc862-a5dc-4537-893c-6d4c3d65320b"]);
const PHONIC_RATE = Number(Deno.env.get("PHONIC_COST_PER_MINUTE_USD") || 0);
const PHONIC_COST_PER_MINUTE_USD = Number.isFinite(PHONIC_RATE) && PHONIC_RATE > 0 ? PHONIC_RATE : null;
const admin = SUPABASE_URL && SECRET_KEY
  ? createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;

const ALLOWED_ORIGINS = new Set([
  "https://synqme.mysecondself.app",
  "https://synqme-demo.onrender.com",
  "https://mss-7uas.onrender.com"
]);

function response(status: number, body: unknown, origin: string | null = null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin"
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "authorization, apikey, content-type, x-client-info";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function zero() {
  return {
    chatRequests: 0, voiceSessions: 0, voiceMinutes: 0, userSpeechMinutes: 0, assistantSpeechMinutes: 0,
    inputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, outputTokens: 0,
    searchRequests: 0, fetchRequests: 0, deepseekCostUsd: 0, searchCostUsd: 0, fetchCostUsd: 0,
    deepseekUnpricedRequests: 0, phonicCostUsd: 0, phonicUnpricedSessions: 0, pendingVoiceSessions: 0,
    lastActivityAt: null
  };
}
function add(target: Record<string, any>, source: Record<string, any>) {
  for (const key of Object.keys(source)) {
    if (key === "lastActivityAt") continue;
    if (typeof target[key] === "number" && typeof source[key] === "number") target[key] += source[key];
  }
}
function phonicCost(event: Record<string, any>): number | null {
  if (event.phonic_cost_usd !== null && event.phonic_cost_usd !== undefined) return Number(event.phonic_cost_usd || 0);
  const rate = event.phonic_rate_per_minute_usd != null
    ? Number(event.phonic_rate_per_minute_usd)
    : PHONIC_COST_PER_MINUTE_USD;
  const duration = Number(event.voice_duration_ms);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(duration) || duration <= 0) return null;
  return duration / 60000 * rate;
}
function moneyCost(event: Record<string, any>): number | null {
  const voiceCost = event.event_type === "phonic_voice" ? phonicCost(event) : 0;
  if (event.event_type === "phonic_voice" && voiceCost === null) return null;
  if (event.event_type === "deepseek_chat" && event.cost_method === "deepseek_usage_missing") return null;
  return Number(event.deepseek_cost_usd || 0) + Number(event.search_cost_usd || 0) +
    Number(event.fetch_cost_usd || 0) + Number(voiceCost || 0);
}

async function listUsers() {
  if (!admin) throw new Error("Server-side Supabase access is not configured.");
  const users: any[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < 1000) break;
  }
  return users;
}

async function readEvents(fromDate: string | null, toDate: string) {
  if (!admin) throw new Error("Server-side Supabase access is not configured.");
  const events: any[] = [];
  const size = 1000;
  for (let offset = 0; offset < 100000; offset += size) {
    let query = admin.from("synqme_usage_events").select("*").order("created_at", { ascending: false });
    if (fromDate) query = query.gte("created_at", fromDate);
    if (toDate) query = query.lte("created_at", toDate);
    const { data, error } = await query.range(offset, offset + size - 1);
    if (error) throw error;
    events.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return events;
}

async function getProfileNames() {
  if (!admin) return new Map<string, string>();
  const { data, error } = await admin.from("synqme_profiles").select("user_id,owner_name");
  if (error) return new Map<string, string>();
  return new Map((data || []).map((profile: any) => [profile.user_id, profile.owner_name || ""]));
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) return response(403, { error: "Origin not allowed." });
    return response(204, {}, origin);
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) return response(403, { error: "Origin not allowed." });

  if (request.method !== "GET") return response(405, { error: "Method not allowed." }, origin);
  if (!admin) return response(503, { error: "Server-side usage access is not configured." }, origin);

  const authorization = request.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return response(401, { error: "Sign in to continue." }, origin);

  try {
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user || user.is_anonymous) return response(401, { error: "Your session is not valid. Sign in again." }, origin);
    if (!ADMIN_USER_IDS.has(user.id)) return response(403, { error: "This account is not authorised to view SYNQ.ME administration." }, origin);

    const url = new URL(request.url);
    const requestedPeriod = url.searchParams.get("period") || "30d";
    const period = ["7d", "30d", "90d", "all"].includes(requestedPeriod) ? requestedPeriod : "30d";
    const now = new Date();
    const fromDate = period === "all" ? null : new Date(now.getTime() - ({ "7d": 7, "30d": 30, "90d": 90 }[period] * 86400000)).toISOString();
    const toDate = now.toISOString();

    const [authUsers, events, profileNames, oldest] = await Promise.all([
      listUsers(),
      readEvents(fromDate, toDate),
      getProfileNames(),
      admin.from("synqme_usage_events").select("created_at").order("created_at", { ascending: true }).limit(1).maybeSingle()
    ]);
    const byUser = new Map<string, any>();
    for (const authUser of authUsers) {
      byUser.set(authUser.id, {
        userId: authUser.id, email: authUser.email || "", createdAt: authUser.created_at || null,
        ownerName: profileNames.get(authUser.id) || "", ...zero()
      });
    }
    for (const event of events) {
      const aggregate = byUser.get(event.user_id) || {
        userId: event.user_id, email: "", createdAt: null, ownerName: "", ...zero()
      };
      if (!aggregate.lastActivityAt || (event.created_at && event.created_at > aggregate.lastActivityAt)) aggregate.lastActivityAt = event.created_at;
      switch (event.event_type) {
        case "deepseek_chat":
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
          if (event.cost_method === "deepseek_usage_missing") aggregate.deepseekUnpricedRequests += 1;
          break;
        case "deepseek_search":
          aggregate.searchRequests += Number(event.search_requests || 0);
          aggregate.searchCostUsd += Number(event.search_cost_usd || 0);
          break;
        case "deepseek_fetch":
          aggregate.fetchRequests += Number(event.fetch_requests || 0);
          aggregate.fetchCostUsd += Number(event.fetch_cost_usd || 0);
          break;
        case "phonic_voice":
          aggregate.voiceSessions += 1;
          aggregate.voiceMinutes += Number(event.voice_duration_ms || 0) / 60000;
          aggregate.userSpeechMinutes += Number(event.user_speech_ms || 0) / 60000;
          aggregate.assistantSpeechMinutes += Number(event.assistant_speech_ms || 0) / 60000;
          const voiceCost = phonicCost(event);
          if (voiceCost === null) aggregate.phonicUnpricedSessions += 1;
          else aggregate.phonicCostUsd += voiceCost;
          if (event.status === "pending") aggregate.pendingVoiceSessions += 1;
          break;
      }
      byUser.set(event.user_id, aggregate);
    }

    const totals = {
      registeredUsers: authUsers.length, activeUsers: 0, ...zero()
    };
    for (const account of byUser.values()) {
      if (account.chatRequests || account.voiceSessions || account.searchRequests || account.fetchRequests) totals.activeUsers += 1;
      add(totals, account);
    }
    totals.knownCostUsd = Number((totals.deepseekCostUsd + totals.searchCostUsd + totals.fetchCostUsd + totals.phonicCostUsd).toFixed(10));
    const users = [...byUser.values()].sort((a, b) =>
      (b.deepseekCostUsd + b.searchCostUsd + b.fetchCostUsd + b.phonicCostUsd) -
      (a.deepseekCostUsd + a.searchCostUsd + a.fetchCostUsd + a.phonicCostUsd)
    );
    return response(200, {
      period: { key: period, from: fromDate, to: toDate },
      trackingStartedAt: oldest?.data?.created_at || null,
      phonicRatePerMinuteUsd: PHONIC_COST_PER_MINUTE_USD,
      totals,
      users,
      recentEvents: events.slice(0, 30).map((event) => ({
        id: event.id, userId: event.user_id, type: event.event_type, provider: event.provider, model: event.model,
        status: event.status, createdAt: event.created_at, voiceDurationMs: event.voice_duration_ms,
        promptTokens: event.prompt_tokens, completionTokens: event.completion_tokens,
        totalCostUsd: moneyCost(event), costMethod: event.cost_method
      }))
    }, origin);
  } catch (error) {
    const message = String((error as Error)?.message || "Could not load usage records.").slice(0, 220);
    console.error("Admin usage request failed:", message);
    return response(502, { error: "Could not load the usage dashboard. " + message }, origin);
  }
});
