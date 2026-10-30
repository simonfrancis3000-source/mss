import http from "node:http";
import { createAmiaReply, searchWeb, fetchWebPage } from "./amia/index.js";
import {
  requireAuthenticatedUser,
  requireAdminUser,
  usageTrackingConfigured,
  buildAdminUsageDashboard,
  createPhonicUsageSession,
  linkPhonicConversation,
  completePhonicUsageSession,
  recordDeepseekUsage,
  recordSearchFetchUsage,
  httpError
} from "./usage.js";

const PORT = Number.parseInt(process.env.PORT || "10000", 10);
const DEEPSEEK_PERSON_API_KEY = process.env.DEEPSEEK_PERSON_API_KEY || "";
const DEEPSEEK_SEARCH_API_KEY = process.env.DEEPSEEK_SEARCH_API_KEY || "";
const PHONIC_API_KEY = process.env.PHONIC_API_KEY || "";
const PROVIDER = "deepseek";
const API_KEY = DEEPSEEK_PERSON_API_KEY;
const MODEL = process.env.DEEPSEEK_FLASH_MODEL || "deepseek-flash";
// Render deployments need CORS to work even when FRONTEND_ORIGIN has not
// been populated. Keep the known SYNQ.ME origins as safe defaults and allow
// additional exact origins through FRONTEND_ORIGIN (comma-separated).
const DEFAULT_ALLOWED_ORIGINS = [
  "https://synqme-demo.onrender.com",
  "https://synqme-demo-pr-1.onrender.com",
  "https://mss-7uas.onrender.com",
  "https://synqme.mysecondself.app",
  "https://demo.mysecondself.app",
  "https://mysecondself.app",
  "https://www.mysecondself.app"
];
const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...(process.env.FRONTEND_ORIGIN || "").split(",")
].map((value) => value.trim().replace(/\/+$/, "")).filter(Boolean));

const requestHistory = new Map();
const MAX_REQUESTS_PER_MINUTE = 12;
const MAX_BODY_BYTES = 48 * 1024;
const SUPPORTED_CONVERSATION_LANGUAGES = new Set(["en", "es", "fr", "it", "pt", "hi", "ja", "zh"]);
function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(JSON.stringify(body));
}

function corsHeaders(origin) {
  if (!origin) return {};
  const normalized = origin.replace(/\/+$/, "");
  if (!ALLOWED_ORIGINS.has(normalized)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request must contain valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function limitReached(request) {
  const forwarded = request.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "unknown";
  const now = Date.now();
  const current = requestHistory.get(ip);
  if (!current || now - current.start > 60_000) {
    requestHistory.set(ip, { start: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS_PER_MINUTE;
}

function cleanMessages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) =>
      item &&
      (item.role === "user" || item.role === "assistant") &&
      typeof item.content === "string"
    )
    .slice(-20)
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 1200) }))
    .filter((item) => item.content);
}

function cleanPreferences(input) {
  if (!Array.isArray(input)) return [];
  const allowedFacetKeys = ["room", "rooms", "frequency", "timeOfDay", "taskOrder", "cleaningSupplies", "laundryDetail", "approvalBoundary", "negativeConstraint", "preserveOrAvoid"];
  return input.slice(0, 24).map((item) => {
    const explicitFields = {};
    if (item?.explicitFields && typeof item.explicitFields === "object" && !Array.isArray(item.explicitFields)) {
      for (const key of allowedFacetKeys) {
        if (Object.prototype.hasOwnProperty.call(item.explicitFields, key)) explicitFields[key] = item.explicitFields[key];
      }
    }
    const unresolvedFields = Array.isArray(item?.unresolvedFields)
      ? item.unresolvedFields.filter((value) => typeof value === "string").slice(0, 12)
      : [];
    return {
      category: typeof item?.category === "string" ? item.category.slice(0, 80) : "Personal preference",
      text: typeof item?.text === "string" ? item.text.trim().slice(0, 240) : "",
      epistemicStatus: ["user_stated", "user_confirmed", "inferred_pending_confirmation"].includes(item?.epistemicStatus) ? item.epistemicStatus : "user_stated",
      explicitFields,
      unresolvedFields
    };
  }).filter((item) => item.text);
}

function cleanProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return {
    ownerName: typeof input.ownerName === "string" ? input.ownerName.trim().slice(0, 60) : "",
    companionName: typeof input.companionName === "string" ? input.companionName.trim().slice(0, 60) : "Freya",
    robotName: typeof input.robotName === "string" ? input.robotName.trim().slice(0, 60) : "",
    robotType: typeof input.robotType === "string" ? input.robotType.slice(0, 80) : "Home assistant",
    askBeforeActions: Boolean(input.askBeforeActions),
    robotVoice: input.robotVoice === "male" ? "male" : "female",
    preferredLanguage: SUPPORTED_CONVERSATION_LANGUAGES.has(input.preferredLanguage) ? input.preferredLanguage : "en"
  };
}

function cleanFunctions(input) {
  if (!Array.isArray(input)) return [];
  const allowed = new Set([
    "Dishwashing", "Vacuuming & floors", "Laundry", "Folding & putting away",
    "Tidying", "Surface cleaning", "Meal preparation", "Cooking",
    "Groceries & supplies", "Pet care", "Plant care", "Waste & recycling"
  ]);
  return [...new Set(input.filter((item) => typeof item === "string" && allowed.has(item)))].slice(0, 12);
}

function responseRepeatsUser(reply, userMessage) {
  const normalise = (value) => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const userText = normalise(userMessage);
  const replyText = normalise(reply);
  if (!userText || userText.length < 24) return false;
  if (replyText.includes(userText)) return true;
  if (/^\s*(got it|gotcha|understood|right)[,.]?\s+so\b/i.test(reply) && replyText.includes(userText)) return true;

  const stopWords = new Set(["that","this","with","your","you","have","will","would","when","then","they","them","and","the","for","from","into","onto","some","particular","specific","about","because","before","after","once","what","where","which","just","like","need","want","you","i","me","my","to","a","an","of","it","is"]);
  const words = [...new Set(userText.split(" ").filter((word) => word.length >= 3 && !stopWords.has(word)))];
  if (words.length < 8) return false;
  const replyWords = new Set(replyText.split(" "));
  const overlap = words.filter((word) => replyWords.has(word)).length / words.length;
  return overlap >= 0.78;
}

function focusedPreferenceFollowup(message, profile = {}) {
  const lower = String(message || "").toLowerCase();
  const name = String(profile.ownerName || "").trim();
  const prefix = name && lower.length > 75 ? name + ", " : "";

  if (/(paper towels?|spray|cleaning product|surface cleaner|cleaner you|detergent)/i.test(message)) {
    return prefix + "Gotcha. Should I treat those as your standard supplies for all surface cleaning, or just the kitchen?";
  }
  if (/(kitchen|counter|worktop|surface)/i.test(message) && /(twice|two times|2 times|two a day|2 a day|daily|each day|every day|a day)/i.test(message)) {
    return prefix + "Got it. Would morning and evening suit you, or do you prefer two other times?";
  }
  if (/(ask me|ask before|check with me|permission|confirm before|before changing|before moving|without asking)/i.test(message)) {
    return prefix + "Understood. Should asking first apply to every household task, or especially when something would be moved or handled?";
  }
  if (/(clean|surface|floor|tidy|vacuum)/i.test(message)) {
    return prefix + "Gotcha. What matters most to get right here: timing, task order, or anything that must be left untouched?";
  }
  return prefix + "Got it. What is the next important detail I should understand?";
}

function guardRobotExecutionClaims(reply, preferences, language = "en") {
  const claimPattern = /\b(?:the\s+)?robot\s+(?:will|would)\s+(?:automatically\s+)?(?:follow|place|put|handle|sort|load|unload|start|turn on|execute|perform|carry out)\b|\b(?:will happen automatically|automatically carry out)\b/i;
  if (!claimPattern.test(reply)) return reply;

  const boundary = {
    en: "I can help shape a proposed household routine from these preferences. No physical robot is connected, so no task is being carried out automatically. Actual execution would require a compatible robot, a verified integration and your authorisation. Is there another detail you'd like to add?",
    es: "Puedo ayudarte a definir una rutina doméstica a partir de estas preferencias. No hay ningún robot físico conectado, así que no se está realizando ninguna tarea automáticamente. Para ejecutarla harían falta un robot compatible, una integración verificada y tu autorización. ¿Hay algún otro detalle que quieras añadir?",
    fr: "Je peux t’aider à définir une routine domestique à partir de ces préférences. Aucun robot physique n’est connecté, donc aucune tâche n’est exécutée automatiquement. Il faudrait un robot compatible, une intégration vérifiée et ton autorisation pour passer à l’action. Y a-t-il un autre détail à préciser ?",
    it: "Posso aiutarti a definire una routine domestica a partire da queste preferenze. Non è collegato alcun robot fisico, quindi nessuna attività viene eseguita automaticamente. Per farlo servirebbero un robot compatibile, un’integrazione verificata e la tua autorizzazione. C’è un altro dettaglio che vuoi aggiungere?",
    pt: "Posso ajudar a definir uma rotina doméstica com base nestas preferências. Não há nenhum robô físico ligado, por isso nenhuma tarefa está a ser executada automaticamente. Para isso, seriam necessários um robô compatível, uma integração verificada e a tua autorização. Há mais algum detalhe que queiras acrescentar?",
    hi: "मैं इन प्राथमिकताओं के आधार पर घर की दिनचर्या तय करने में मदद कर सकता हूँ। अभी कोई भौतिक रोबोट जुड़ा नहीं है, इसलिए कोई काम अपने-आप नहीं किया जा रहा है। इसे वास्तव में करने के लिए अनुकूल रोबोट, सत्यापित इंटीग्रेशन और आपकी अनुमति चाहिए होगी। क्या आप कोई और बात जोड़ना चाहेंगे?",
    ja: "これらの希望をもとに、家事の手順を一緒に考えられます。現在、物理的なロボットは接続されていないため、作業が自動で実行されることはありません。実行には対応するロボット、確認済みの連携機能、そしてあなたの許可が必要です。他に追加したいことはありますか？",
    zh: "我可以根据这些偏好帮助你规划家务流程。目前没有连接实体机器人，因此不会自动执行任何任务。实际执行需要兼容的机器人、经过验证的集成以及你的授权。你还想补充什么细节吗？"
  };
  return boundary[language] || boundary.en;
}

const app = http.createServer(async (request, response) => {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin : "";
  const headers = corsHeaders(origin);

  if (request.method === "OPTIONS") {
    if (origin && headers === null) return json(response, 403, { error: "Origin not allowed." });
    response.writeHead(204, headers || {});
    return response.end();
  }

  const url = new URL(request.url || "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, {
      ok: true,
      service: "synqme-ai-api",
      provider: PROVIDER,
      configured: Boolean(API_KEY),
      model: MODEL,
      diagnosticsVersion: "amia-deepseek-v1",
      searchConfigured: Boolean(DEEPSEEK_SEARCH_API_KEY),
      phonicConfigured: Boolean(PHONIC_API_KEY),
      usageTrackingConfigured,
      adminAllowlistConfigured: Boolean(process.env.ADMIN_EMAILS || process.env.ADMIN_USER_IDS),
      phonicRateConfigured: Boolean(process.env.PHONIC_COST_PER_MINUTE_USD)
    }, headers || {});
  }


  if (request.method === "GET" && url.pathname === "/api/admin/usage") {
    if (origin && headers === null) return json(response, 403, { error: "Origin not allowed." }, headers || {});
    try {
      const user = await requireAuthenticatedUser(request);
      requireAdminUser(user);
      if (!usageTrackingConfigured) throw httpError("The usage database is not configured. Add SUPABASE_SECRET_KEY to the Render API service.", 503);
      const requestedPeriod = url.searchParams.get("period") || "30d";
      const period = ["7d", "30d", "90d", "all"].includes(requestedPeriod) ? requestedPeriod : "30d";
      const dashboard = await buildAdminUsageDashboard(period, PHONIC_API_KEY);
      return json(response, 200, dashboard, headers || {});
    } catch (error) {
      return json(response, Number.isInteger(error?.statusCode) ? error.statusCode : 500, { error: error.message || "Could not load administration data." }, headers || {});
    }
  }

  if (request.method === "POST" && url.pathname === "/api/phonic/session") {
    if (origin && headers === null) return json(response, 403, { error: "Origin not allowed." });
    if (!PHONIC_API_KEY) {
      return json(response, 503, {
        error: "Phonic real-time voice is not configured. Add PHONIC_API_KEY to the backend environment."
      }, headers || {});
    }
    if (limitReached(request)) {
      return json(response, 429, { error: "Too many voice requests. Wait a minute, then try again." }, headers || {});
    }

    try {
      const user = await requireAuthenticatedUser(request);
      // The Phonic API key never leaves this server.
      await readJson(request, 1024);
      const upstream = await fetch("https://api.phonic.ai/v1/auth/session_token", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + PHONIC_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ ttl_seconds: 300 }),
        signal: AbortSignal.timeout(15000)
      });

      if (!upstream.ok) {
        const errorCode = "phonic-session-" + Date.now().toString(36);
        let providerDetail = "";
        try {
          const payload = await upstream.json();
          providerDetail = String(payload?.error?.message || payload?.message || "").slice(0, 250);
        } catch {}
        console.error("Phonic session-token request failed", {
          errorCode,
          status: upstream.status,
          detail: providerDetail || "No provider error detail returned"
        });
        const friendly = upstream.status === 401 || upstream.status === 403
          ? "Phonic rejected the configured API key. Check PHONIC_API_KEY in the backend environment."
          : "Phonic could not start a voice session. Check the backend logs and try again.";
        return json(response, 502, { error: friendly, errorCode }, headers || {});
      }

      const payload = await upstream.json();
      if (typeof payload?.session_token !== "string" || !payload.session_token) {
        return json(response, 502, { error: "Phonic did not return a session token." }, headers || {});
      }

      const usageSession = await createPhonicUsageSession(user.id);
      return json(response, 200, {
        sessionToken: payload.session_token,
        websocketUrl: "wss://api.phonic.ai/v1/sts/ws",
        usageId: usageSession.usageId,
        startedAt: usageSession.startedAt
      }, headers || {});
    } catch (error) {
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      if (status === 400 || status === 413) {
        return json(response, status, { error: error.message }, headers || {});
      }
      const errorCode = "phonic-session-" + Date.now().toString(36);
      console.error("SYNQ.ME Phonic session handler failed", {
        errorCode,
        name: error?.name || "Error",
        message: String(error?.message || "Unknown error").slice(0, 250)
      });
      return json(response, 502, {
        error: "The Phonic voice session could not be created. Check backend logs and try again.",
        errorCode
      }, headers || {});
    }
  }



  if (request.method === "POST" && url.pathname === "/api/phonic/link") {
    if (origin && headers === null) return json(response, 403, { error: "Origin not allowed." }, headers || {});
    try {
      const user = await requireAuthenticatedUser(request);
      const body = await readJson(request, 4 * 1024);
      const usageId = String(body?.usageId || "");
      const conversationId = String(body?.conversationId || "").trim();
      if (!usageId || !conversationId || conversationId.length > 160) throw httpError("A valid usage ID and Phonic conversation ID are required.", 400);
      await linkPhonicConversation(user.id, usageId, conversationId);
      return json(response, 200, { ok: true }, headers || {});
    } catch (error) {
      return json(response, Number.isInteger(error?.statusCode) ? error.statusCode : 500, { error: error.message || "Could not link voice session." }, headers || {});
    }
  }

  if (request.method === "POST" && url.pathname === "/api/phonic/complete") {
    if (origin && headers === null) return json(response, 403, { error: "Origin not allowed." }, headers || {});
    try {
      const user = await requireAuthenticatedUser(request);
      const body = await readJson(request, 4 * 1024);
      const result = await completePhonicUsageSession(user.id, PHONIC_API_KEY, {
        usageId: String(body?.usageId || ""),
        conversationId: String(body?.conversationId || "").trim(),
        clientDurationMs: Math.max(0, Math.min(6 * 60 * 60 * 1000, Number(body?.clientDurationMs || 0)))
      });
      return json(response, 200, { ok: true, durationSource: result.source, durationMs: result.durationMs }, headers || {});
    } catch (error) {
      return json(response, Number.isInteger(error?.statusCode) ? error.statusCode : 500, { error: error.message || "Could not finalise voice usage." }, headers || {});
    }
  }

  if (request.method === "POST" && url.pathname === "/api/amia/search") {
    if (origin && headers === null) return json(response, 403, { error: "Origin not allowed." });
    if (!DEEPSEEK_SEARCH_API_KEY) return json(response, 503, { error: "DeepSeek Search is not configured. Add DEEPSEEK_SEARCH_API_KEY to the backend environment." }, headers || {});
    if (limitReached(request)) return json(response, 429, { error: "Too many requests. Wait a minute, then try again." }, headers || {});
    try {
      const user = await requireAuthenticatedUser(request);
      const body = await readJson(request, 8 * 1024);
      const results = await searchWeb(DEEPSEEK_SEARCH_API_KEY, body?.query, {
        count: body?.count,
        originalQuestion: body?.originalQuestion
      });
      await recordSearchFetchUsage({ userId: user.id, type: "search" });
      return json(response, 200, { results, provider: "deepseek-search" }, headers || {});
    } catch (error) {
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 502;
      return json(response, status, { error: String(error?.message || "DeepSeek Search failed.") }, headers || {});
    }
  }

  if (request.method === "POST" && url.pathname === "/api/amia/fetch") {
    if (origin && headers === null) return json(response, 403, { error: "Origin not allowed." });
    if (!DEEPSEEK_SEARCH_API_KEY) return json(response, 503, { error: "DeepSeek Fetch is not configured. Add DEEPSEEK_SEARCH_API_KEY to the backend environment." }, headers || {});
    if (limitReached(request)) return json(response, 429, { error: "Too many requests. Wait a minute, then try again." }, headers || {});
    try {
      const user = await requireAuthenticatedUser(request);
      const body = await readJson(request, 8 * 1024);
      const page = await fetchWebPage(DEEPSEEK_SEARCH_API_KEY, body?.url);
      await recordSearchFetchUsage({ userId: user.id, type: "fetch" });
      return json(response, 200, { ...page, provider: "deepseek-fetch" }, headers || {});
    } catch (error) {
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 502;
      return json(response, status, { error: String(error?.message || "DeepSeek Fetch failed.") }, headers || {});
    }
  }

  if (request.method !== "POST" || url.pathname !== "/api/chat") {
    return json(response, 404, { error: "Route not found." }, headers || {});
  }

  if (origin && headers === null) {
    return json(response, 403, { error: "Origin not allowed." });
  }
  if (!API_KEY) {
    const requiredKey = "DEEPSEEK_PERSON_API_KEY";
    return json(response, 503, { error: "AMÏA is not configured. Add " + requiredKey + " to the Render backend environment." }, headers || {});
  }
  if (limitReached(request)) {
    return json(response, 429, { error: "Too many requests. Wait a minute, then try again." }, headers || {});
  }

  try {
    const user = await requireAuthenticatedUser(request);
    const body = await readJson(request);
    const repairMode = body?.repairMode === true;
    const messages = cleanMessages(body?.messages);
    const preferences = cleanPreferences(body?.preferences);
    const profile = cleanProfile(body?.profile);
    const domesticFunctions = cleanFunctions(body?.domesticFunctions);

    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return json(response, 400, { error: "At least one user message is required." }, headers || {});
    }

    const latestUserMessage = messages[messages.length - 1].content;
    const requestTimestamp = new Date().toISOString();
    const amiaResult = await createAmiaReply({
      apiKey: DEEPSEEK_PERSON_API_KEY,
      searchApiKey: DEEPSEEK_SEARCH_API_KEY,
      messages,
      preferences,
      profile,
      domesticFunctions,
      repairMode,
      outputMode: body?.outputMode || "text",
      taskMode: body?.taskMode || ""
    });
    const reply = amiaResult.reply;
    const selectedModel = amiaResult.model;
    const usageRecorded = await recordDeepseekUsage({
      userId: user.id,
      model: amiaResult.model,
      usage: { ...(amiaResult.usage || {}), searchRequests: amiaResult.searchRequests || 0, fetchRequests: amiaResult.fetchRequests || 0 },
      timestamp: requestTimestamp,
      webSearchStatus: amiaResult.webSearchStatus || "not_requested",
      relevantPreferenceCount: amiaResult.relevantPreferenceCount || 0
    });
    const robotName = String(profile.robotName || "").trim();
    const namedReply = robotName
      ? reply.trim().replace(/\byour SecondSelf(?=\s+(?:to avoid|should avoid|avoid))/gi, "your " + robotName)
      : reply.trim();
    const safeReply = guardRobotExecutionClaims(namedReply, preferences, profile.preferredLanguage);
    const lowValueReply = /I've captured this preference for your browser-based SecondSelf|I've added it to your local digital persona|That's useful context for your SecondSelf|Let's make that preference more precise|What detail would matter most to get right|Can you walk me through how that usually happens at home|What is the next important detail I should understand/i.test(safeReply);
    const requiresRepair = lowValueReply || responseRepeatsUser(safeReply, latestUserMessage);
    return json(response, 200, {
      reply: safeReply,
      model: selectedModel,
      provider: PROVIDER,
      responseNeedsReview: requiresRepair,
      usageRecorded
    }, headers || {});
  } catch (error) {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    if (status === 400 || status === 413) {
      return json(response, status, { error: error.message }, headers || {});
    }
    console.error("SYNQ.ME API handler error", {
      name: error?.name || "Error",
      message: String(error?.message || "Unknown server error").slice(0, 300)
    });
    return json(response, 502, {
      error: "The SYNQ.ME backend could not complete the request to DeepSeek. Check the backend logs for the diagnostic error.",
      provider: PROVIDER
    }, headers || {});
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("SYNQ.ME API listening on port " + PORT);
  console.log("AI provider: " + PROVIDER);
  console.log("Model: " + MODEL);
  console.log("AI API key configured: " + Boolean(API_KEY));

});
