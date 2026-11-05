// Parallel Web Tools adapter for MSS appliance manuals.
// Do not transmit owner conversations, persona memory, or credentials.
const API = "https://api.parallel.ai/v1";
const MAX_RESULTS = 8;
const cache = new Map();
const MAX_CACHE_ENTRIES = 160;

function cached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.until < Date.now()) { cache.delete(key); return null; }
  return { ...structuredClone(entry.value), cached: true };
}
function save(key, value, ttl) {
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { value: structuredClone(value), until: Date.now() + ttl });
}
function safePublicUrl(input) {
  let url;
  try { url = new URL(String(input || "")); } catch { return null; }
  // Manufacturer URL allow-listing takes place in appliance-manual.js.
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  return url.toString();
}
async function parallelRequest(path, key, body, fetchImpl, timeoutMs) {
  const result = await fetchImpl(API + "/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!result.ok) {
    // Never log a provider response body or API key.
    throw new Error("Parallel " + path + " unavailable (" + result.status + ")");
  }
  return result.json();
}

// Response-compatible with the existing DeepSeek search/fetch adapter.
export async function parallelManualProvider(path, body, key, fetchImpl = fetch, domains = []) {
  if (!key) throw new Error("Parallel is not configured.");
  if (path === "search") {
    const query = String(body?.query || "").trim().slice(0, 180);
    if (!query) throw new Error("A manual search query is required.");
    const domainList = [...new Set((Array.isArray(domains) ? domains : [])
      .map(domain => String(domain).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    if (!domainList.length) throw new Error("Manufacturer domains have not been verified.");
    const keyForCache = "search:" + query.toLowerCase() + ":" + domainList.join(",");
    const hit = cached(keyForCache);
    if (hit) return hit;
    const data = await parallelRequest("search", key, {
      mode: "fast",
      objective: "Find the official manufacturer operating manual for the exact appliance model: " + query,
      search_queries: [query],
      advanced_settings: {
        max_results: Math.min(MAX_RESULTS, Math.max(1, Number(body?.count) || MAX_RESULTS)),
        source_policy: { include_domains: domainList },
        excerpt_settings: { max_chars_per_result: 1200 }
      }
    }, fetchImpl, 11000);
    const results = (Array.isArray(data?.results) ? data.results : [])
      .filter(item => safePublicUrl(item?.url))
      .map(item => ({
        url: String(item.url), title: String(item.title || "").slice(0, 240),
        content: Array.isArray(item.excerpts) ? item.excerpts.join("\n\n").slice(0, 2400) : ""
      })).slice(0, MAX_RESULTS);
    const normalized = { results };
    save(keyForCache, normalized, 60 * 60 * 1000);
    return normalized;
  }
  if (path === "fetch") {
    const url = safePublicUrl(body?.url);
    if (!url) throw new Error("A verified public manufacturer URL is required.");
    const model = String(body?.model || "").trim().slice(0, 80);
    const keyForCache = "fetch:" + url + ":" + model;
    const hit = cached(keyForCache);
    if (hit) return hit;
    const data = await parallelRequest("extract", key, {
      urls: [url],
      objective: "Locate this appliance model's exact number " + model + " and the manufacturer's operating instructions, programmes, features and safety requirements.",
      advanced_settings: { full_content: { max_chars_per_result: 40000 } }
    }, fetchImpl, 15000);
    const page = (Array.isArray(data?.results) ? data.results : []).find(item => item?.url === url) ||
      (Array.isArray(data?.results) ? data.results : [])[0];
    const normalized = {
      title: String(page?.title || "").slice(0, 240),
      content: String(page?.full_content ||
        (Array.isArray(page?.excerpts) ? page.excerpts.join("\n\n") : "")).slice(0, 40000)
    };
    if (normalized.content) save(keyForCache, normalized, 12 * 60 * 60 * 1000);
    return normalized;
  }
  throw new Error("Unsupported Parallel manual operation.");
}
