import http from "node:http";

const PORT = Number.parseInt(process.env.PORT || "10000", 10);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const REQUESTED_PROVIDER = String(process.env.AI_PROVIDER || "").trim().toLowerCase();
const PROVIDER = REQUESTED_PROVIDER === "gemini" || (!REQUESTED_PROVIDER && GEMINI_API_KEY) ? "gemini" : "groq";
const API_KEY = PROVIDER === "gemini" ? GEMINI_API_KEY : GROQ_API_KEY;
const MODEL = PROVIDER === "gemini"
  ? (process.env.GEMINI_MODEL || "gemini-3.8-flash")
  : (process.env.GROQ_MODEL || "openai/gpt-oss-20b");
// Render deployments need CORS to work even when FRONTEND_ORIGIN has not
// been populated. Keep the known SYNQ.ME origins as safe defaults and allow
// additional exact origins through FRONTEND_ORIGIN (comma-separated).
const DEFAULT_ALLOWED_ORIGINS = [
  "https://synqme-demo.onrender.com",
  "https://synqme-demo-pr-1.onrender.com",
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
const MAX_AUDIO_BODY_BYTES = 8 * 1024 * 1024;

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
    "Access-Control-Allow-Headers": "Content-Type"
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
    robotName: typeof input.robotName === "string" ? input.robotName.trim().slice(0, 60) : "",
    robotType: typeof input.robotType === "string" ? input.robotType.slice(0, 80) : "Home assistant",
    askBeforeActions: Boolean(input.askBeforeActions),
    robotVoice: input.robotVoice === "male" ? "male" : "female"
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

function isClarificationRequest(message) {
  const value = String(message || "").toLowerCase().replace(/[.!?]+$/g, "").trim();
  return /^(such as what|like what|what do you mean|what do you mean by that|examples?|give me an example|can you give me an example|can you give me some examples|could you give me an example|could you give me some examples|what kind of things|what sort of things|can you explain that|could you explain that)$/.test(value);
}

function clarificationHelpReply(previousQuestion, latestPreference = "") {
  const question = String(previousQuestion || "").toLowerCase();
  const preference = String(latestPreference || "").trim();
  if (/(avoid|prevent|left untouched|never happen|shouldn't|should not)/i.test(question)) {
    return "For example, you might want your SecondSelf to ask before moving personal belongings, avoid touching fragile or private items, leave certain rooms alone, or check with you before throwing anything away. Those are only examples—do any apply to you, or is there something else?";
  }
  if (/(ask|permission|confirm|check with me)/i.test(question)) {
    return "For example, asking before moving your belongings, using a new cleaning product, throwing something away, or entering a private room. Which, if any, would you want your SecondSelf to check with you first?";
  }
  if (/(time|timing|schedule|morning|evening|when)/i.test(question)) {
    return "For example, you might prefer a task before breakfast, after you leave a room, at a set time each day, or only when needed. Is any of those closer to what you have in mind?";
  }
  if (/(order|sequence|first|before|after)/i.test(question)) {
    return "For example, cleaning surfaces before floors, putting items away before wiping a counter, or finishing one room before moving to the next. Is there a particular order you prefer?";
  }
  if (/(clean|surface|floor|vacuum|tidy|kitchen)/i.test(question) || /(clean|surface|floor|vacuum|tidy|kitchen)/i.test(preference)) {
    return "For example, protecting delicate surfaces, using only products you approve, leaving personal items where they are, or cleaning high-use areas first. Which detail matters in your home?";
  }
  return "For example, you can tell me about timing, task order, items that need special care, or things you want me to ask before changing. Is there one of those you want to explore first?";
}

function betterFallbackFollowup(message, profile = {}, history = []) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  const robotName = String(profile.robotName || "").trim() || "robot";
  const priorAssistant = [...history.slice(0, -1)].reverse().find((item) => item.role === "assistant")?.content || "";
  const recentAssistant = history.filter((item) => item.role === "assistant").slice(-6).map((item) => item.content);
  const normalise = (value) => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const repeated = (question) => recentAssistant.some((reply) => {
    const a = normalise(reply), b = normalise(question);
    return a === b || a.includes(b) || b.includes(a);
  });
  const choose = (options) => {
    const fresh = options.find((option) => !repeated(option));
    if (fresh) return fresh;
    const newAngles = [
      "Can you walk me through how that usually happens at home?",
      "What tends to happen just before you need that done?",
      "What small detail would make the biggest difference to you in that situation?",
      "When this doesn’t go the way you like, what usually goes wrong?"
    ];
    return newAngles.find((option) => !repeated(option)) || "What does a typical day look like for you in that situation?";
  };

  if (/^(morning|in the morning|evening|in the evening|afternoon|at night)$/i.test(text) && /(morning and evening|what time|which times|when would|time of day)/i.test(priorAssistant)) {
    if (/morning/i.test(text)) return "Morning sounds like a good fit. Is that because you’re usually up and about then, or would you prefer it done before you start using the kitchen?";
    if (/evening|night/i.test(text)) return "Evening, then. Would you picture that happening after you’ve cooked or eaten, or at a set time regardless?";
    return "That gives me a better picture. Is that time tied to something in your day, or does it simply suit you best?";
  }
  if (/^(washing|wash|washing and drying|wash and dry|laundering)$/i.test(text) && /(which part|sorting, washing|putting clothes away)/i.test(priorAssistant)) {
    return choose([
      "When you wash clothes, do you usually separate them by colour first, or pay more attention to fabric and care labels?",
      "Are there any garments you treat differently from the rest—delicates, wool, work clothes, or anything you prefer to air-dry?",
      "Do you tend to have a regular laundry day, or wash smaller loads as things need doing?"
    ]);
  }
  if (/(paper towels?|spray|cleaning product|surface cleaner|detergent)/i.test(text)) {
    return choose([
      "Are those your go-to supplies around the whole home, or do you switch products depending on the surface?",
      "Is there a surface you’re particularly careful with, where the wrong product could cause damage?",
      "When you clean, do you prefer to keep your usual products close at hand, or have them brought out only when needed?"
    ]);
  }
  if (/(twice|two times|2 times|daily|every day|each day)/i.test(text) && /(kitchen|counter|worktop|surface|clean|wipe)/i.test(text)) {
    return choose([
      "When you say twice a day, is one of those cleans usually after cooking or meals, or do you prefer set times?",
      "Would you want the same quick clean each time, or a more thorough one at a particular point in the day?",
      "Is the aim mainly to keep the surfaces hygienic, clear away crumbs and spills, or both?"
    ]);
  }
  if (/(ask me|ask before|check with me|permission|confirm before|without asking|avoid|boundary)/i.test(text) ||
      (/avoid|permission|boundary/i.test(priorAssistant) && text.length < 100)) {
    return choose([
      "That’s an important boundary. Are you most concerned about belongings being moved or damaged, private spaces, or decisions being made without checking with you?",
      "What kinds of things should it never decide for itself—moving belongings, throwing something away, or using a product you haven’t approved?",
      "Would you want it to check with you about every uncertain action, or only where there’s a real risk of damage, privacy, or an unwanted change?"
    ]).replace(/\bthe robot\b/gi, robotName).replace(/\byour robot\b/gi, "your " + robotName);
  }
  if (/(laundry|washing|clothes|fold|drying|wardrobe)/i.test(lower)) {
    return choose([
      "What tends to matter most with laundry in your home: keeping colours separate, protecting delicate items, or having everything ready when you need it?",
      "How do you like clean clothes left—folded, hung up, or put back in specific places?",
      "Are there any laundry habits you already have that you’d definitely want your robot to follow?"
    ]).replace(/\byour robot\b/gi, "your " + robotName);
  }
  if (/(vacuum|floor|carpet|tidy|cleaning|clean|surface|counter|worktop|kitchen)/i.test(lower)) {
    return choose([
      "When a room feels properly looked after to you, what do you notice first: clean surfaces, clear floors, or everything being back where it belongs?",
      "Are there parts of the room you like to deal with first, or do you tend to work around whatever needs attention?",
      "Is there anything in that space that should stay exactly where it is, even during a tidy-up?"
    ]).replace(/\byour robot\b/gi, "your " + robotName);
  }
  if (/(cook|meal|food|recipe|ingredient|grocery|shopping)/i.test(lower)) {
    return choose([
      "When it comes to meals, do you prefer familiar favourites or a bit of variety during the week?",
      "Are there ingredients you avoid for taste, preference, or practical reasons?",
      "What usually makes meal planning easier for you: knowing what’s in the fridge, having a plan, or keeping things flexible?"
    ]);
  }
  if (/(pet|dog|cat|plant|water|garden)/i.test(lower)) {
    return choose([
      "What little signs tell you your pet or plants need attention?",
      "Are there any routines around that you’d want kept exactly as they are?",
      "Is there anything you’d want the robot to check with you about rather than decide on its own?"
    ]).replace(/\byour robot\b/gi, "your " + robotName);
  }
  if (/^(yes|yeah|yep|no|nope|probably|maybe|not sure|i don't know)$/i.test(text)) {
    return "Fair enough. Would it help to think through a real example at home, or should we start with what usually happens today?";
  }
  if (text.endsWith("?") || /^(what|why|how|when|where|who|can you|could you|do you|would you|is it|are there)\b/i.test(text)) {
    if (/(such as what|like what|what do you mean|examples?)/i.test(text)) return clarificationHelpReply(priorAssistant, "");
    return "Good question. Let me make sure I answer what you’re actually asking: are you thinking about how SYNQ.ME learns the preference, or how a compatible robot might use it in future?";
  }
  if (priorAssistant) {
    return choose([
      "I’m getting a clearer picture now. What’s the part of that routine you’d be most particular about?",
      "That helps. Is there a real example from your own home that would make this clearer?",
      "I see. What would be the most frustrating thing for the robot to get wrong in that situation?"
    ]);
  }
  return choose([
    "Tell me a little more about how that works at home for you. What do you tend to do first?",
    "I'm curious—what makes that feel right for you: convenience, consistency, or something else?",
    "What would you notice first if your future robot really understood your way of doing that?"
  ]);
}

function guardRobotExecutionClaims(reply, preferences) {
  const claimPattern = /\b(?:the\s+)?robot\s+(?:will|would)\s+(?:automatically\s+)?(?:follow|place|put|handle|sort|load|unload|start|turn on|execute|perform|carry out)\b|\b(?:will happen automatically|automatically carry out)\b/i;
  if (!claimPattern.test(reply)) return reply;

  const saved = preferences.length
    ? preferences.map((item) => item.text).join("; ")
    : "the preferences discussed in this conversation";
  return "I’ve captured these preferences in the local browser demo: " + saved + ". SYNQ.ME can use them to shape a proposed household routine. No physical robot is connected, so this demo does not carry out tasks automatically. Actual execution would require a compatible robot, a verified integration, and your authorization. Is there another preference you’d like to add?";
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
      diagnosticsVersion: "gemini-upstream-errors-v1"
    }, headers || {});
  }

  if (request.method === "POST" && url.pathname === "/api/transcribe") {
    if (origin && headers === null) return json(response, 403, { error: "Origin not allowed." });
    if (!GEMINI_API_KEY) {
      return json(response, 503, { error: "Voice transcription is not configured. Add GEMINI_API_KEY to the Render backend environment." }, headers || {});
    }
    if (limitReached(request)) {
      return json(response, 429, { error: "Too many requests. Wait a minute, then try again." }, headers || {});
    }
    try {
      const body = await readJson(request, MAX_AUDIO_BODY_BYTES);
      const audioBase64 = typeof body?.audioBase64 === "string" ? body.audioBase64.replace(/^data:[^,]+,/, "") : "";
      const suppliedMime = typeof body?.mimeType === "string" ? body.mimeType.split(";")[0].trim().toLowerCase() : "";
      const mimeType = suppliedMime === "audio/x-wav" ? "audio/wav" : suppliedMime;
      const allowedMimeTypes = new Set(["audio/webm", "audio/mp4", "audio/m4a", "audio/wav", "audio/mpeg", "audio/mp3", "audio/aac", "audio/ogg", "audio/flac", "audio/opus"]);
      if (!audioBase64 || !allowedMimeTypes.has(mimeType) || audioBase64.length > 7_500_000) {
        return json(response, 400, { error: "Unsupported or oversized audio recording. Please try a shorter recording." }, headers || {});
      }
      const upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(process.env.GEMINI_MODEL || "gemini-3.8-flash") + ":generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: "Transcribe the spoken words in this audio exactly as the speaker said them. Return only the transcription, with no commentary, no quotation marks, and no guesses if speech is not intelligible." },
              { inlineData: { mimeType, data: audioBase64 } }
            ]
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 300 }
        }),
        signal: AbortSignal.timeout(45_000)
      });
      if (!upstream.ok) {
        const status = upstream.status === 429 ? 429 : 502;
        console.error("Gemini transcription failed", { status: upstream.status });
        return json(response, status, { error: upstream.status === 429 ? "Gemini's current free quota is busy. Wait a moment and try again." : "The voice transcription service could not process that recording." }, headers || {});
      }
      const result = await upstream.json();
      const transcript = (result?.candidates?.[0]?.content?.parts || []).map((part) => typeof part.text === "string" ? part.text : "").join("").trim();
      if (!transcript) return json(response, 422, { error: "I couldn't make out the recording. Please try again or type your message." }, headers || {});
      return json(response, 200, { text: transcript, model: process.env.GEMINI_MODEL || "gemini-3.8-flash" }, headers || {});
    } catch (error) {
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      if (status === 400 || status === 413) return json(response, status, { error: error.message }, headers || {});
      console.error("SYNQ.ME transcription handler error", error?.name || "Error");
      return json(response, 500, { error: "Voice transcription failed. You can try again or type your message." }, headers || {});
    }
  }

  if (request.method !== "POST" || url.pathname !== "/api/chat") {
    return json(response, 404, { error: "Route not found." }, headers || {});
  }

  if (origin && headers === null) {
    return json(response, 403, { error: "Origin not allowed." });
  }
  if (!API_KEY) {
    const requiredKey = PROVIDER === "gemini" ? "GEMINI_API_KEY" : "GROQ_API_KEY";
    return json(response, 503, { error: "AI is not configured. Add " + requiredKey + " to the Render backend environment." }, headers || {});
  }
  if (limitReached(request)) {
    return json(response, 429, { error: "Too many requests. Wait a minute, then try again." }, headers || {});
  }

  try {
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
    const previousAssistantMessage = messages.length > 1 && messages[messages.length - 2].role === "assistant"
      ? messages[messages.length - 2].content
      : "";
    if (isClarificationRequest(latestUserMessage) && previousAssistantMessage) {
      return json(response, 200, {
        reply: clarificationHelpReply(previousAssistantMessage, messages[messages.length - 3]?.content || ""),
        provider: PROVIDER,
        model: MODEL
      }, headers || {});
    }

    const systemPrompt = [
      "You are SYNQ.ME, the user's conversational future-robot companion and guide for building their MySecondSelf digital persona. Follow the interaction style of the reference dishwasher conversation: grounded, attentive, useful, specific and naturally inquisitive. It should feel like a thoughtful companion getting to know a home, not a bot running a questionnaire.",
      "VOICE AND IDENTITY: You are Freya, the conversational companion shown in the interface as 'Freya · SYNQ.ME'. Speak directly to the user in the first person as 'I', 'me' and 'my'. Never refer to yourself as 'Freya' in the third person (for example, never ask 'Would you like Freya to help?' or say 'Freya can...'). Say 'Would you like me to...' instead. Keep your identity as the conversational guide distinct from the name of the user's future physical robot, which may be different. You are helping the user define preferences for a future compatible robot; do not imply a physical robot is connected or can currently carry out an action.",

      "Your goal is to understand how the person wants everyday tasks handled, what they care about, how they make decisions, which exceptions matter, and when you should ask rather than guess. Learn by following the meaning of the conversation, not by marching through a predefined list of dimensions.",
      "CORE TURN PATTERN: listen carefully; identify the practical rule, reason or exception in the user's answer; briefly reflect what that changes; then ask the single next question that most naturally follows. The reflection may be a conclusion ('So ordinary scraps go in the caddy, but coffee grounds have their own container') or a useful implication ('That means the normal evening schedule should give way if you need dishes before guests arrive'). Do not force every turn into this structure—some turns should simply acknowledge, explain, or clarify.",
      "MULTI-PART RULES AND CONDITIONALS: When the user gives two or more instructions, acknowledge each distinct rule and preserve its condition. Never merge an if/then instruction into an unconditional one or omit the alternative branch. For example, if the bedroom window should open only when weather is warm and dry but close when rain is forecast, state both conditions; separately preserve any always-on rule such as keeping the bedroom door closed. Before answering, check that your reply accounts for every distinct instruction in the latest user message. Finish the response naturally and do not leave an unfinished thought.",
      "CURIOUS, CASUAL, FRIENDLY: Sound like a thoughtful, easy-going person chatting with someone at home—not a form, interviewer or customer-service script. Use contractions, everyday words and a little warmth. Do not begin every reply with 'Got it', 'That makes sense' or a summary. Vary the rhythm; sometimes respond with a quick natural observation, sometimes a light reaction, and sometimes a question. Avoid gushy praise, forced jokes and over-familiarity.",
      "PROACTIVE FOLLOW-UP: After reading the whole recent conversation, actively think one step ahead: what relevant practical detail has the user not mentioned that could change how their rule should work? Ask about a likely exception, dependency or boundary only when it follows naturally from what they just said. Examples: after a weather-dependent window rule, ask whether it should close overnight or when they leave; after a bed-first tidying rule, ask what to do if the bed has not been made; after a quiet-hours rule, consider a delivery or urgent need. Pick the single most useful missing detail—not a list of possibilities. Do not ask a question just to keep the conversation going if the rule is already complete.",
      "MAKE THE CONNECTION: Explain briefly why the next question follows from what the user said, without repeating their whole message. Preserve every separate instruction and every if/then condition before asking about a related gap. For example: 'So the door stays shut, and the window opens a little only when the forecast is warm and dry; if rain is coming, it closes. Should it also stay closed overnight?' If weather monitoring, sensors, or physical control are not actually connected, frame these as preferences for a future compatible robot—not actions already being performed.",
      "PERSONALISATION, NOT A CHECKLIST: The purpose is to discover how a future domestic robot should fit around the user's actual life. Be relaxed and conversational, while staying curious about household routines. Don't drift into unrelated trivia. When the user mentions a routine that connects to a previous preference, make that connection and ask about the practical consequence. Don't make assumptions about unsupported robot capabilities.",
      "When two preferences may conflict, gently test the trade-off with a realistic scenario: for example, efficiency versus cleaning quality, a quiet evening schedule versus needing something sooner, or autonomy versus asking permission. Make the scenario relevant to something the user has actually said. Do not invent worries or bring in unrelated hypotheticals.",
      "Follow the reference script's progression: gather the real context; establish the normal rule; test plausible exceptions; ask about decision thresholds and consent; connect related preferences; then, when enough has been learned, give a concise integrated summary of the person's actual preferences and the underlying principle. Invite correction with a direct question such as 'Have I understood you correctly?' Do not produce a long summary every few turns—wait until there is enough substance.",
      "When a person tells you a preference, treat it as a meaningful contribution. Do not immediately respond with generic filler. For example, if they say they prefer an efficient wash to save water, recognise both the practical rule and the value it serves, then ask about the next relevant edge case. If they give a specific exception, preserve it distinctly from the general rule and ask where it applies if that is still unclear.",
      "READ THE FULL RECENT CONVERSATION. A short answer such as 'morning', 'washing', 'just the kitchen', 'yes', or 'no' usually answers the question immediately before it. Accept that answer explicitly, connect it to the existing preference, and continue from there. Never restart the topic, ask the same question again, or treat an answer as unrelated.",
      "DEFERRED INSTRUCTIONS AND ITEM BOUNDARIES: If the user says they will show you something when they arrive, get home, or are available later, treat that as a clear decision to defer identifying the items. Acknowledge it and do not ask them to list those items again right now. For example: 'That works. When you’re there, you can show me which things may be put away. Until those items are identified, the safe rule is to leave anything uncertain where it is and ask before moving it.' Preserve every named protected item exactly as given; do not quietly add, remove or substitute items between turns. Do not invent implausible examples (such as putting a vacuum in a cupboard), infer that a general cleaning instruction authorises moving personal belongings, or expand 'put away items' to every object not explicitly protected. Ask about the one unresolved decision that matters, such as what to do if the user is unavailable and an item is in the way. Keep the capability boundary clear: this is planning a future routine, not a claim that the digital Freya can arrive, see the kitchen or physically wait and act.",

      "Keep the exchange natural and varied. Never use the same acknowledgement-plus-question formula on every turn. Some replies can simply acknowledge a clear preference; others should gently explore one relevant exception or missing detail. Never ask for information the user has already provided.",
      "Never use generic filler such as 'What matters most to you when getting that right?', 'What is the next important detail I should understand?', 'Could you give me a simple example?', or 'Is there anything else?' when a specific question is available. Avoid stock prompts, repetitive interview patterns, and re-asking things that the user has already answered. Review the prior several assistant turns before choosing the next question.",
      "Do not repeat or paraphrase the user's whole sentence. Reflect only the important implication or rule in natural language. Keep the spoken style concise but not clipped: a short, meaningful observation followed by one relevant question is better than empty praise or a bare follow-up.",
      "Ask one main question at a time. Offer two or three concrete options only when they help someone decide; don't turn every question into a menu. If an answer is already clear, don't keep drilling down just to fill a checklist. Move forward to the next relevant part of the person's routine.",
      "Answer direct questions directly. If the user asks 'such as what?', 'like what?', 'examples?', or what you mean, explain with relevant examples from the immediately preceding topic. Do not treat a request for explanation as a new preference.",
      "Be specific to the subject. Ask about the actual item, room, timing, frequency, workflow, quality threshold, supplies, safety boundary, exception or desired result that follows from the user's answer. If a model number, product identity, manual, or capability is essential, ask for it instead of assuming. Do not claim to have checked a manual, looked up a product, verified a capability, or accessed a connected device unless the application has actually done so.",
      "Use careful decision reasoning internally: distinguish confirmed preferences from assumptions, detect where a new detail changes an earlier rule, preserve exceptions and their scope, and only ask about uncertainty that can materially change the outcome. If something is inferred rather than directly stated, phrase it as a possibility and check before treating it as fact.",
      "The user's name is " + (profile.ownerName || "not specified") + ". Use it sparingly. Their chosen future robot name is " + (profile.robotName || "not chosen") + ". Use that exact name naturally when discussing the future robot's behaviour, actions or boundaries. 'SecondSelf' means the digital persona being developed; do not call the robot 'your SecondSelf' in a question about what it should do. Do not call it ELO if another name has been chosen.",
      "Their selected interests are: " + (domesticFunctions.length ? domesticFunctions.join(", ") : "none selected yet") + ". Existing preference records: " + JSON.stringify(preferences) + ". Use these as context, not as a script to recite. Never ask for information already provided.",
      "Be transparent about the demo boundary. No physical robot is connected or controlled. You may speak naturally in first person about how you would approach a future task ('I'd treat that as the normal rule'), but do not claim the physical task has happened, that you checked a device, or that a robot will definitely perform it. Actual execution would require a compatible robot, verified capabilities and user authorisation. Do not claim that preferences synced or saved unless the app confirms that state.",
      "Use AMÏA-style decision intelligence internally, but do not explain platform concepts in the conversation. Do not mention Veyra or make unsupported claims about simulation, deployment or production capability.",
      "REPLY LENGTH AND COMPLETENESS: Usually use two to four short conversational sentences, around 35–75 words. Acknowledge the key rule(s), preserve all conditions, then ask at most one useful follow-up when it adds value. End with a complete sentence. Never stop mid-thought or trail off. Plain text only: no Markdown, headings, lists or corporate language.",
      repairMode ? "RETRY: your previous draft was rejected as generic or repetitive. Do not use any canned fallback. Read the latest user message as part of the full conversation and respond to the detail they actually introduced. If they mention getting up at 7 and going to the kitchen for coffee after a question about tidying, recognise they have introduced their morning routine; do not ask them to walk through it generically or repeat the tidying question. Make one natural connection to their stated routine and ask only a useful next question." : ""
    ].join(" ");

    const upstream = PROVIDER === "gemini"
      ? await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(MODEL) + ":generateContent", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: messages.map((item) => ({
              role: item.role === "assistant" ? "model" : "user",
              parts: [{ text: item.content }]
            })),
            generationConfig: { temperature: 0.78, topP: 0.92, maxOutputTokens: 400 }
          }),
          signal: AbortSignal.timeout(30_000)
        })
      : await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: MODEL,
            messages: [{ role: "system", content: systemPrompt }, ...messages],
            temperature: 0.72,
            reasoning_effort: "low",
            include_reasoning: false,
            max_completion_tokens: 1000,
            stream: false
          }),
          signal: AbortSignal.timeout(30_000)
        });

    if (!upstream.ok) {
      const errorCode = PROVIDER + "-" + Date.now().toString(36);
      let upstreamDetail = "";
      try {
        const upstreamError = await upstream.json();
        upstreamDetail = String(upstreamError?.error?.message || upstreamError?.message || "").slice(0, 500);
      } catch {}
      // Log the provider's error message for diagnosis, never the API key or request body.
      console.error(PROVIDER + " API request failed", {
        errorCode,
        status: upstream.status,
        detail: upstreamDetail || "No provider error detail returned"
      });

      let friendly;
      if (upstream.status === 429) {
        friendly = "Gemini has reached a usage limit or rate limit. Check your Gemini quota and billing, then try again.";
      } else if (PROVIDER === "gemini" && [401, 403].includes(upstream.status)) {
        friendly = "Gemini rejected the API key or project access. Check that the key is valid, unrestricted for this server, and has Gemini API access enabled.";
      } else if (PROVIDER === "gemini" && upstream.status === 404) {
        friendly = "Gemini could not find the configured model. Check GEMINI_MODEL and the model access available to this API key.";
      } else if (PROVIDER === "gemini" && upstream.status === 400) {
        friendly = "Gemini rejected the request. The Render API logs contain the provider error code and diagnostic detail.";
      } else if (PROVIDER === "gemini" && upstream.status >= 500) {
        friendly = "Gemini is temporarily returning a server error. Check Render logs and retry shortly.";
      } else if (PROVIDER === "gemini") {
        friendly = "Gemini could not complete the reply. Check the API key, model access, quota and the provider error in Render logs.";
      } else {
        friendly = "The AI service could not complete the reply. Check the provider error in Render logs and try again.";
      }
      return json(response, upstream.status === 429 ? 429 : 502, {
        error: friendly,
        errorCode,
        provider: PROVIDER,
        upstreamStatus: upstream.status
      }, headers || {});
    }

    const result = await upstream.json();
    const finishReason = PROVIDER === "gemini"
      ? result?.candidates?.[0]?.finishReason
      : result?.choices?.[0]?.finish_reason;
    if (PROVIDER === "groq" && finishReason === "length") {
      console.warn("Groq reply reached the completion token limit", { model: MODEL, finishReason });
      return json(response, 502, {
        error: "The AI reply reached its length limit before finishing. Please try again.",
        provider: PROVIDER,
        model: MODEL,
        finishReason
      }, headers || {});
    }
    const reply = PROVIDER === "gemini"
      ? (result?.candidates?.[0]?.content?.parts || []).map((part) => typeof part.text === "string" ? part.text : "").join("\n").trim()
      : result?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) {
      return json(response, 502, { error: "The AI service returned an empty reply." }, headers || {});
    }
    const robotName = String(profile.robotName || "").trim();
    const namedReply = robotName
      ? reply.trim().replace(/\byour SecondSelf(?=\s+(?:to avoid|should avoid|avoid))/gi, "your " + robotName)
      : reply.trim();
    const safeReply = guardRobotExecutionClaims(namedReply, preferences);
    const lowValueReply = /I've captured this preference for your browser-based SecondSelf|I've added it to your local digital persona|That's useful context for your SecondSelf|Let's make that preference more precise|What detail would matter most to get right|Can you walk me through how that usually happens at home|What is the next important detail I should understand/i.test(safeReply);
    const requiresRepair = lowValueReply || responseRepeatsUser(safeReply, latestUserMessage);
    if (requiresRepair && repairMode) {
      return json(response, 200, {
        reply: safeReply,
        model: MODEL,
        provider: PROVIDER,
        responseNeedsReview: true
      }, headers || {});
    }
    const finalReply = requiresRepair
      ? betterFallbackFollowup(latestUserMessage, profile, messages)
      : safeReply;
    return json(response, 200, {
      reply: finalReply,
      model: MODEL,
      provider: PROVIDER,
      usedFallback: requiresRepair
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
      error: PROVIDER === "gemini"
        ? "The SYNQ.ME backend could not complete the request to Gemini. Check the backend logs for the diagnostic error."
        : "The SYNQ.ME backend could not complete the request to the AI provider. Check the backend logs for the diagnostic error.",
      provider: PROVIDER
    }, headers || {});
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("SYNQ.ME API listening on port " + PORT);
  console.log("AI provider: " + PROVIDER);
  console.log("Model: " + MODEL);
  console.log("AI API key configured: " + Boolean(API_KEY));
  console.log("Gemini transcription configured: " + Boolean(GEMINI_API_KEY));
});
