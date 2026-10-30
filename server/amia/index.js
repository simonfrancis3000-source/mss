import { buildSystemInstructions } from "./instructions.js";
import { selectRelevantPreferences } from "./memory.js";
import { selectModel } from "./router.js";
import { fetchWebPage, formatSearchResults, searchWeb, shouldUseWebSearch } from "./search.js";

export { searchWeb, fetchWebPage } from "./search.js";

const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";

export async function createAmiaReply({
  apiKey,
  searchApiKey,
  messages = [],
  preferences = [],
  profile = {},
  domesticFunctions = [],
  repairMode = false,
  outputMode = "text",
  taskMode = ""
} = {}) {
  if (!apiKey) throw new Error("DeepSeek person API key is not configured.");
  const conversation = Array.isArray(messages) ? messages.slice(-18) : [];
  const latestUserMessage = [...conversation].reverse().find((item) => item?.role === "user")?.content || "";
  const relevantPreferences = selectRelevantPreferences(preferences, conversation);
  let webContext = "";
  let webSearchStatus = "not_requested";
  let searchRequests = 0;
  let fetchRequests = 0;

  if (shouldUseWebSearch(latestUserMessage)) {
    if (!searchApiKey) {
      webSearchStatus = "not_configured";
      webContext = "A live web search was requested, but Search is not configured. Do not invent current facts or imply that live information was checked.";
    } else {
      try {
        const results = await searchWeb(searchApiKey, latestUserMessage, {
          count: 5,
          originalQuestion: latestUserMessage
        });
        searchRequests += 1;
        if (results.length) {
          const needsFetch = results.find((item) => !String(item.content || "").trim());
          if (needsFetch?.url) {
            try {
              const page = await fetchWebPage(searchApiKey, needsFetch.url);
              fetchRequests += 1;
              needsFetch.content = page.content || "";
              if (!needsFetch.title && page.title) needsFetch.title = page.title;
            } catch {}
          }
        }
        webContext = formatSearchResults(results);
        webSearchStatus = results.length ? "completed" : "no_results";
        if (!results.length) webContext = "The live search returned no results. Do not invent current facts or imply that the information was verified.";
      } catch {
        webSearchStatus = "failed";
        webContext = "A live web search was requested but could not be completed. Do not invent current facts or pretend the search succeeded. State that current information could not be verified.";
      }
    }
  }

  const model = selectModel({ messages: conversation, taskMode, outputMode });
  const systemPrompt = buildSystemInstructions({
    profile,
    preferences: relevantPreferences,
    domesticFunctions,
    repairMode,
    webContext
  });
  const payload = {
    model,
    messages: [{ role: "system", content: systemPrompt }, ...conversation],
    temperature: model === "deepseek-v4-pro" ? 0.5 : 0.72,
    max_tokens: 1000,
    stream: false,
    thinking: { type: model === "deepseek-v4-pro" ? "enabled" : "disabled" }
  };
  const upstream = await fetch(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(35000)
  });
  if (!upstream.ok) {
    let detail = "";
    try {
      const errorPayload = await upstream.json();
      detail = String(errorPayload?.error?.message || errorPayload?.message || "").slice(0, 400);
    } catch {}
    const error = new Error(detail || "DeepSeek could not complete the conversation.");
    error.statusCode = upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502;
    throw error;
  }
  const result = await upstream.json();
  const reply = result?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) {
    throw new Error("DeepSeek returned an empty reply.");
  }
  return {
    reply: reply.trim(),
    provider: "deepseek",
    model,
    webSearchStatus,
    relevantPreferenceCount: relevantPreferences.length,
    usage: {
      promptTokens: Number(result?.usage?.prompt_tokens || 0),
      cacheHitTokens: Number(result?.usage?.prompt_cache_hit_tokens ?? result?.usage?.prompt_tokens_details?.cached_tokens ?? 0),
      cacheMissTokens: Number(result?.usage?.prompt_cache_miss_tokens ?? Math.max(0, Number(result?.usage?.prompt_tokens || 0) - Number(result?.usage?.prompt_cache_hit_tokens ?? result?.usage?.prompt_tokens_details?.cached_tokens ?? 0))),
      completionTokens: Number(result?.usage?.completion_tokens || 0),
      totalTokens: Number(result?.usage?.total_tokens || 0),
      providerModel: String(result?.model || model)
    },
    searchRequests,
    fetchRequests
  };
}
