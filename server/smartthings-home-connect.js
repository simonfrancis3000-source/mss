import { createHash, createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { authenticateSupabaseRequest } from "./supabase-auth.js";

const AUTH_URL = "https://api.smartthings.com/v1/oauth/authorize";
const TOKEN_URL = "https://api.smartthings.com/v1/oauth/token";
const DEVICE_URL = "https://api.smartthings.com/v1/devices";
const SCOPES = "r:devices:* r:locations:*";
const ROUTE = "/api/integrations/smartthings";
const MAX_DEVICES = 500;
const MAX_PAGES = 10;
const refreshInFlight = new Map();

export function encryptSmartThingsToken(value, clientSecret) {
  if (!value || !clientSecret) throw new Error("A token and encryption key are required");
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(clientSecret), Buffer.from("MSS SmartThings token storage"), Buffer.from("aes-256-gcm-v1"), 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSmartThingsToken(value, clientSecret) {
  const [version, iv, tag, data, extra] = String(value || "").split(".");
  if (version !== "v1" || !iv || !tag || !data || extra !== undefined) throw new Error("Invalid encrypted token");
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(clientSecret), Buffer.from("MSS SmartThings token storage"), Buffer.from("aes-256-gcm-v1"), 32));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

const sha256 = value => createHash("sha256").update(value).digest("hex");
const cleanText = (value, max = 150) => typeof value === "string" ? value.slice(0, max) : "";
const isReadOnlyScope = value => {
  const scopes = String(value || "").split(/\s+/).filter(Boolean);
  return scopes.includes("r:devices:*") && scopes.every(scope => scope === "r:devices:*" || scope === "r:locations:*");
};
function sanitizedDevice(item) {
  if (!item || typeof item.deviceId !== "string") return null;
  return {
    deviceId: item.deviceId.slice(0, 120),
    name: cleanText(item.name),
    label: cleanText(item.label) || cleanText(item.name) || "SmartThings device",
    manufacturer: cleanText(item.manufacturerName),
    model: cleanText(item.deviceModel),
    locationId: cleanText(item.locationId, 120),
    roomId: cleanText(item.roomId, 120),
    category: cleanText(item.components?.[0]?.categories?.[0]?.name),
    capabilities: [...new Set((item.components || []).flatMap(component => Array.isArray(component.capabilities) ? component.capabilities.map(cap => cleanText(cap.id, 100)) : []))].slice(0, 50)
  };
}

export function createSmartThingsHomeConnect({
  db,
  supabaseUrl,
  publishableKey,
  clientId = process.env.SMARTTHINGS_CLIENT_ID || "",
  clientSecret = process.env.SMARTTHINGS_CLIENT_SECRET || "",
  redirectUri = process.env.SMARTTHINGS_REDIRECT_URI || "",
  appBaseUrl = "https://synqme.mysecondself.app",
  fetchImpl = fetch
}) {
  function json(res, status, value, headers = {}) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
    res.end(JSON.stringify(value));
  }
  function redirect(res, result) {
    const location = new URL("/", appBaseUrl);
    location.searchParams.set("smartthings", result);
    res.writeHead(303, { Location: location.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    res.end();
  }
  const ready = () => Boolean(db && clientId && clientSecret && redirectUri);
  async function tokenRequest(body) {
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(clientId + ":" + clientSecret).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams({ ...body, client_id: clientId }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error("SmartThings token exchange failed: " + response.status);
    const token = await response.json();
    if (!token?.access_token || !token?.refresh_token || !isReadOnlyScope(token.scope)) {
      throw new Error("SmartThings did not issue the expected read-only permissions");
    }
    return token;
  }
  function recordTokens(userId, token, old = {}) {
    return {
      user_id: userId,
      installed_app_id: cleanText(token.installed_app_id || old.installed_app_id, 120),
      access_token_encrypted: encryptSmartThingsToken(token.access_token, clientSecret),
      refresh_token_encrypted: encryptSmartThingsToken(token.refresh_token, clientSecret),
      expires_at: new Date(Date.now() + Math.max(60, Number(token.expires_in) || 86000) * 1000).toISOString(),
      granted_scopes: String(token.scope).split(/\s+/).filter(Boolean),
      updated_at: new Date().toISOString()
    };
  }
  async function loadConnection(userId) {
    const { data, error } = await db.from("mss_smartthings_connections").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw new Error("Connection data unavailable");
    return data;
  }
  async function currentToken(userId, conn) {
    if (Date.parse(conn.expires_at) - Date.now() > 5 * 60 * 1000) return decryptSmartThingsToken(conn.access_token_encrypted, clientSecret);
    if (!refreshInFlight.has(userId)) {
      const refresh = (async () => {
        // Always re-read to avoid spending a single-use refresh token twice.
        const latest = await loadConnection(userId);
        if (!latest) throw new Error("SmartThings connection missing");
        if (Date.parse(latest.expires_at) - Date.now() > 5 * 60 * 1000) return decryptSmartThingsToken(latest.access_token_encrypted, clientSecret);
        const token = await tokenRequest({
          grant_type: "refresh_token",
          refresh_token: decryptSmartThingsToken(latest.refresh_token_encrypted, clientSecret)
        });
        const { error } = await db.from("mss_smartthings_connections")
          .update(recordTokens(userId, token, latest)).eq("user_id", userId);
        if (error) throw new Error("Token refresh could not be saved");
        return token.access_token;
      })().finally(() => refreshInFlight.delete(userId));
      refreshInFlight.set(userId, refresh);
    }
    return refreshInFlight.get(userId);
  }
  async function discover(userId, conn) {
    const token = await currentToken(userId, conn);
    let next = DEVICE_URL;
    const devices = [];
    const seen = new Set();
    for (let page = 0; next && page < MAX_PAGES && devices.length < MAX_DEVICES; page++) {
      const response = await fetchImpl(next, {
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error("SmartThings device discovery failed: " + response.status);
      const payload = await response.json();
      for (const item of Array.isArray(payload.items) ? payload.items : []) {
        const device = sanitizedDevice(item);
        if (device && !seen.has(device.deviceId)) { devices.push(device); seen.add(device.deviceId); }
        if (devices.length >= MAX_DEVICES) break;
      }
      const href = payload?._links?.next?.href;
      if (!href) break;
      const candidate = new URL(href, DEVICE_URL);
      // Never follow an arbitrary external URL returned by an API payload.
      if (candidate.origin !== "https://api.smartthings.com" || candidate.pathname !== "/v1/devices") break;
      next = candidate.toString();
    }
    const syncedAt = new Date().toISOString();
    const { error } = await db.from("mss_smartthings_connections")
      .update({ devices, synced_at: syncedAt, updated_at: syncedAt }).eq("user_id", userId);
    if (error) throw new Error("SmartThings inventory could not be saved");
    return { devices, syncedAt };
  }

  return async function handleSmartThings(req, res, url, headers = {}) {
    if (!url.pathname.startsWith(ROUTE + "/")) return false;
    const path = url.pathname.slice(ROUTE.length);
    if (!ready()) return json(res, 503, { error: "SmartThings Home Connect is not configured." }, headers), true;

    if (req.method === "GET" && path === "/callback") {
      // Samsung calls this endpoint directly; it never receives an MSS bearer token.
      const state = url.searchParams.get("state") || "";
      if (state.length < 32 || state.length > 128) return redirect(res, "invalid_state"), true;
      const { data, error } = await db.from("mss_smartthings_oauth_states")
        .delete().eq("state_hash", sha256(state)).select("user_id,expires_at").maybeSingle();
      if (error || !data || Date.parse(data.expires_at) <= Date.now()) return redirect(res, "invalid_state"), true;
      if (url.searchParams.has("error")) return redirect(res, "denied"), true;
      const code = url.searchParams.get("code") || "";
      if (!code || code.length > 2048) return redirect(res, "error"), true;
      try {
        const token = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
        const record = { ...recordTokens(data.user_id, token), devices: [], synced_at: null };
        const { error: upsertError } = await db.from("mss_smartthings_connections").upsert(record, { onConflict: "user_id" });
        if (upsertError) throw new Error("Could not store SmartThings connection");
        try { await discover(data.user_id, record); } catch { /* Keep the account linked if Samsung is rate-limited or billing is inactive. */ }
        return redirect(res, "connected"), true;
      } catch {
        return redirect(res, "error"), true;
      }
    }

    const auth = await authenticateSupabaseRequest(req, { supabaseUrl, publishableKey, fetchImpl });
    if (!auth.ok) return json(res, auth.status, { error: auth.error }, headers), true;
    const userId = auth.user.id;
    try {
      if (req.method === "GET" && path === "/status") {
        const conn = await loadConnection(userId);
        return json(res, 200, {
          connected: Boolean(conn), readOnly: true,
          devices: Array.isArray(conn?.devices) ? conn.devices : [],
          syncedAt: conn?.synced_at || null
        }, headers), true;
      }
      if (req.method === "POST" && path === "/start") {
        // The redirect URI must resolve to this API service, not the static web frontend.
        const callbackHost = new URL(redirectUri).host;
        const requestHost = cleanText(req.headers["x-forwarded-host"] || req.headers.host, 255);
        if (callbackHost !== requestHost) {
          return json(res, 503, { error: "SmartThings callback URL must point to the MSS API service. Update the Samsung OAuth redirect URI and Render configuration." }, headers), true;
        }
        const state = randomBytes(32).toString("base64url");
        const { error } = await db.from("mss_smartthings_oauth_states").insert({
          state_hash: sha256(state), user_id: userId,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        });
        if (error) throw new Error("Unable to start SmartThings authorisation");
        const authorization = new URL(AUTH_URL);
        authorization.searchParams.set("client_id", clientId);
        authorization.searchParams.set("redirect_uri", redirectUri);
        authorization.searchParams.set("scope", SCOPES);
        authorization.searchParams.set("response_type", "code");
        authorization.searchParams.set("state", state);
        return json(res, 200, { authorizationUrl: authorization.toString() }, headers), true;
      }
      if (req.method === "POST" && path === "/sync") {
        const conn = await loadConnection(userId);
        if (!conn) return json(res, 404, { error: "Connect SmartThings first." }, headers), true;
        const data = await discover(userId, conn);
        return json(res, 200, { connected: true, readOnly: true, ...data }, headers), true;
      }
      if (req.method === "POST" && path === "/disconnect") {
        const { error } = await db.from("mss_smartthings_connections").delete().eq("user_id", userId);
        if (error) throw new Error("Unable to disconnect SmartThings");
        await db.from("mss_smartthings_oauth_states").delete().eq("user_id", userId);
        return json(res, 200, { connected: false, devices: [], readOnly: true }, headers), true;
      }
      return json(res, 404, { error: "SmartThings endpoint not found." }, headers), true;
    } catch (error) {
      // Never expose access tokens, refresh tokens, or Samsung authorisation codes in errors or logs.
      const message = String(error?.message || "");
      const safeMessage = /^SmartThings device discovery failed: (402|429)$/.test(message)
        ? message + ". Check the SmartThings API subscription or retry later."
        : "The SmartThings request could not be completed.";
      return json(res, 503, { error: safeMessage }, headers), true;
    }
  };
}
