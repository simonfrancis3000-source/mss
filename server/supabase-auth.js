export function readBearerToken(request) {
  const headers = request?.headers || {};
  const value = typeof headers.get === "function"
    ? headers.get("authorization")
    : headers.authorization || headers.Authorization;
  const match = typeof value === "string" ? value.match(/^Bearer\s+(.+)$/i) : null;
  return match?.[1]?.trim() || "";
}

export async function authenticateSupabaseRequest(request, {
  supabaseUrl = "",
  publishableKey = "",
  fetchImpl = fetch,
  timeoutMs = 10000
} = {}) {
  const accessToken = readBearerToken(request);
  if (!accessToken) return { ok: false, status: 401, error: "Sign in to continue." };
  if (!supabaseUrl || !publishableKey) {
    return { ok: false, status: 503, error: "Account authentication is not configured on the SYNQ.ME API." };
  }

  let upstream;
  try {
    upstream = await fetchImpl(String(supabaseUrl).replace(/\/+$/, "") + "/auth/v1/user", {
      method: "GET",
      headers: {
        apikey: publishableKey,
        Authorization: "Bearer " + accessToken,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return { ok: false, status: 503, error: "Account authentication is temporarily unavailable. Please retry." };
  }

  if (!upstream.ok) {
    return { ok: false, status: upstream.status === 401 || upstream.status === 403 ? 401 : 503,
      error: upstream.status === 401 || upstream.status === 403
        ? "Your account session is no longer valid. Sign in again."
        : "Account authentication is temporarily unavailable. Please retry." };
  }

  let user;
  try { user = await upstream.json(); } catch {
    return { ok: false, status: 503, error: "Account authentication returned an invalid response." };
  }
  if (!user || typeof user.id !== "string" || !user.id || user.is_anonymous === true) {
    return { ok: false, status: 401, error: "A registered SYNQ.ME account is required." };
  }

  return {
    ok: true,
    accessToken,
    user: { id: user.id, email: typeof user.email === "string" ? user.email : "" }
  };
}

export function rateLimitIdentity(userId, fallbackIp = "unknown") {
  return userId ? "user:" + String(userId) : "ip:" + String(fallbackIp || "unknown");
}
