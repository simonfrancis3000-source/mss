// Parallel Web Tools adapter for AMÏA. Server-side only: never expose the API key to the browser.
const API_BASE = "https://api.parallel.ai/v1";
const CACHE_LIMIT = 250;
const cache = new Map();

function cached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (item.expires <= Date.now()) { cache.delete(key); return null; }
  return structuredClone(item.value);
}

function remember(key, value, ttlMs) {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, { value: structuredClone(value), expires: Date.now() + ttlMs });
}

function publicUrl(input) {
  let url;
  try { url = new URL(String(input || "").trim()); }
  catch { throw new Error("A valid public webpage URL is required."); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
    host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") ||
    /^(127|10|0|169\.254|192\.168)\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "::1" || host.startsWith("fe80:")) {
    throw new Error("Only public HTTP or HTTPS URLs can be extracted.");
  }
  return url.toString();
}

async function requestParallel(apiKey, pathname, body, timeoutMs) {
  if (!apiKey) throw new Error("PARALLEL_API_KEY is not configured.");
  const response = await fetch(API_BASE + pathname, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    let message = "";
    try {
      const error = await response.json();
      message = String(error?.error?.message || error?.message || error?.detail || "").slice(0, 180);
    } catch {}
    const failure = new Error(message || "Parallel request failed (" + response.status + ").");
    failure.statusCode = response.status === 429 ? 429 : 502;
    throw failure;
  }
  return response.json();
}

function resultToSource(result) {
  if (!result || typeof result.url !== "string") return null;
  try { publicUrl(result.url); } catch { return null; }
  return {
    url: result.url,
    title: String(result.title || "Source").slice(0, 240),
    date: result.publish_date || "",
    content: Array.isArray(result.excerpts)
      ? result.excerpts.join("\n\n").slice(0, 4000)
      : String(result.full_content || "").slice(0, 4000),
    provider: "parallel"
  };
}

export async function searchParallel(apiKey, query, { count = 5 } = {}) {
  const safeQuery = String(query || "").trim().slice(0, 280);
  if (!safeQuery) throw new Error("Search query is empty.");
  const maxResults = Math.max(1, Math.min(10, Number(count) || 5));
  const key = "search:" + safeQuery.toLowerCase() + ":" + maxResults;
  const hit = cached(key);
  if (hit) return hit;
  const payload = await requestParallel(apiKey, "/search", {
    mode: "fast",
    objective: "Find authoritative, current information relevant to: " + safeQuery +
      ". Prefer official manufacturer documentation, product manuals, technical specifications and verified sources.",
    search_queries: [safeQuery],
    advanced_settings: {
      max_results: maxResults,
      excerpt_settings: { max_chars_per_result: 1800 }
    }
  }, 12000);
  const results = (Array.isArray(payload?.results) ? payload.results : [])
    .map(resultToSource).filter(Boolean).slice(0, maxResults);
  remember(key, results, 60 * 60 * 1000);
  return results;
}

export async function fetchParallel(apiKey, url, { objective = "" } = {}) {
  const safeUrl = publicUrl(url);
  const safeObjective = String(objective || "Find relevant manufacturer instructions, technical specifications and safety requirements.").slice(0, 300);
  const key = "extract:" + safeUrl + ":" + safeObjective;
  const hit = cached(key);
  if (hit) return hit;
  const payload = await requestParallel(apiKey, "/extract", {
    urls: [safeUrl],
    objective: safeObjective
  }, 20000);
  const result = (Array.isArray(payload?.results) ? payload.results : [])
    .map(resultToSource).find(Boolean);
  if (!result) throw new Error("Parallel could not extract relevant content from this page.");
  remember(key, result, 24 * 60 * 60 * 1000);
  return result;
}
