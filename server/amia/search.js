import { searchParallel, fetchParallel } from "./parallel.js";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

function authHeaders(apiKey) {
  return {
    "Authorization": "Bearer " + apiKey,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };
}

async function providerError(response, fallback) {
  let detail = "";
  try {
    const payload = await response.json();
    detail = String(payload?.error?.message || payload?.message || "").slice(0, 400);
  } catch {}
  const error = new Error(detail || fallback);
  error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
  return error;
}

const PRODUCT_BRAND = /\b(siemens|bosch|miele|samsung|lg|whirlpool|electrolux|aeg|beko|dyson|roborock|ecovacs|booster|ubtech|unitree|figure|1x|tesla)\b/i;
const EQUIPMENT = /\b(dishwasher|washing machine|washer|dryer|oven|fridge|refrigerator|vacuum|thermostat|robot|appliance)\b/i;

export function shouldUseWebSearch(message = "") {
  const text = String(message || "");
  return /\b(search|look up|find online|check online|latest|current|today|right now|this week|recent|news|release|new version|price|pricing|cost|compare|availability|opening hours|weather|who is|what happened|manual|instructions|specifications|compatible)\b/i.test(text)
    || (PRODUCT_BRAND.test(text) && EQUIPMENT.test(text));
}

// For product introductions, search for the public product identity, never
// forward personal conversation context to a third-party web service.
export function knowledgeSearchQuery(message = "") {
  const text = String(message || "").trim();
  if (PRODUCT_BRAND.test(text) && EQUIPMENT.test(text)) {
    const brand = text.match(PRODUCT_BRAND)?.[0] || "";
    const equipment = text.match(EQUIPMENT)?.[0] || "";
    const model = text.match(/\b(?:iQ\s?\d{3}|series\s?\d+|walker\s?\w+|g1|h1|go2|t1|neo|s8|x40)\b/i)?.[0] || "";
    return [brand, model, equipment, "official manual specifications"].filter(Boolean).join(" ");
  }
  return text.slice(0, 200);
}

export async function searchWeb(apiKey, query, { count = 5, originalQuestion = "", provider = "deepseek" } = {}) {
  if (provider === "parallel") return searchParallel(apiKey, query, { count });
  if (!apiKey) throw new Error("DeepSeek Search API is not configured.");
  const safeQuery = String(query || "").trim().slice(0, 128);
  if (!safeQuery) throw new Error("Search query is empty.");
  const response = await fetch(DEEPSEEK_BASE_URL + "/v1/tools/search", {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      query: safeQuery,
      count: Math.max(1, Math.min(10, Number(count) || 5)),
      ori_question: String(originalQuestion || safeQuery).trim().slice(0, 128),
      need_content: true
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw await providerError(response, "DeepSeek Search could not complete the request.");
  const payload = await response.json();
  return Array.isArray(payload?.results) ? payload.results.slice(0, 10) : [];
}

export async function fetchWebPage(apiKey, url, { provider = "deepseek", objective = "" } = {}) {
  if (provider === "parallel") return fetchParallel(apiKey, url, { objective });
  if (!apiKey) throw new Error("DeepSeek Search API is not configured.");
  const safeUrl = String(url || "").trim();
  let parsed;
  try { parsed = new URL(safeUrl); } catch { throw new Error("A valid webpage URL is required."); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Only public HTTP or HTTPS webpage URLs can be fetched.");
  }
  const response = await fetch(DEEPSEEK_BASE_URL + "/v1/tools/fetch", {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({ url: parsed.toString() }),
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw await providerError(response, "DeepSeek Fetch could not retrieve the webpage.");
  return response.json();
}

export function formatSearchResults(results = []) {
  return results.map((item, index) => {
    const content = String(item.content || item.summary || item.snippet || "").slice(0, 3500);
    return [
      "[" + (index + 1) + "] " + String(item.title || "Untitled source"),
      "URL: " + String(item.url || ""),
      item.date ? "Date: " + item.date : "",
      "Authority tier: " + String(item.authority ?? "unknown"),
      content
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}
