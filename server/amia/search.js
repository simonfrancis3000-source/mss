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

export function shouldUseWebSearch(message = "") {
  return /\b(search|look up|find online|check online|latest|current|today|right now|this week|recent|news|release|new version|price|pricing|cost|compare|availability|opening hours|weather|who is|what happened)\b/i.test(String(message || ""));
}

export async function searchWeb(apiKey, query, { count = 5, originalQuestion = "" } = {}) {
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

export async function fetchWebPage(apiKey, url) {
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
