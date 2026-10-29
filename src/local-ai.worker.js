import { env, pipeline } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/Qwen2.5-1.5B-Instruct";
let generator = null;
let loadingPromise = null;
let generationBusy = false;
let modelCacheDetected = false;

function postProgress(event) {
  try { self.postMessage({ type: "progress", cached: modelCacheDetected, ...event }); } catch {}
}

function postStatus(label) {
  try { self.postMessage({ type: "status", label }); } catch {}
}

function describeLoadError(error) {
  if (error instanceof Error) {
    const cause = error.cause;
    const causeText = cause instanceof Error
      ? " Cause: " + cause.name + ": " + cause.message
      : cause
        ? " Cause: " + (typeof cause === "string" ? cause : JSON.stringify(cause))
        : "";
    return (error.name ? error.name + ": " : "") + (error.message || "The loader returned no message.") + causeText;
  }
  if (typeof error === "string" && error.trim()) return error.trim();
  try {
    const serialised = JSON.stringify(error);
    if (serialised && serialised !== "{}") return serialised;
  } catch {}
  const fallback = String(error || "");
  return fallback && fallback !== "[object Object]"
    ? fallback
    : "The model loader failed without a detailed error. Check browser storage, available memory, and WebGPU support, then refresh and retry.";
}

async function loadModel() {
  if (generator) return generator;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    env.useBrowserCache = true;
    env.useWasmCache = true;
    env.cacheKey = "transformers-cache";

    // Ask the browser to keep this origin's cache where supported. Cache API
    // is separate from the service-worker shell cache, which must not delete it.
    try { await self.navigator.storage?.persist?.(); } catch {}
    let hasCachedModelFiles = false;
    try {
      if (self.caches && env.useBrowserCache) {
        const cache = await self.caches.open(env.cacheKey);
        const requests = await cache.keys();
        const encodedModelId = encodeURIComponent(MODEL_ID);
        hasCachedModelFiles = requests.some((request) =>
          request.url.includes(MODEL_ID) || request.url.includes(encodedModelId)
        );
      }
    } catch {}
    modelCacheDetected = hasCachedModelFiles;
    postStatus(hasCachedModelFiles
      ? "Loading cached local AMÏA model"
      : "Preparing local AMÏA model download");
    if (!self.navigator?.gpu) {
      throw new Error("This device/browser does not expose WebGPU. Open SYNQ.ME in an up-to-date Chrome or Edge browser on a WebGPU-compatible device.");
    }
    const adapter = await self.navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) {
      throw new Error("WebGPU is present, but no compatible GPU adapter is available. Try a current Chrome or Edge browser on a supported device.");
    }
    postStatus("Loading local AMÏA model");
    postProgress({ status: "initiate", file: "Qwen2.5 1.5B model" });
    generator = await pipeline("text-generation", MODEL_ID, {
      // Use the published Transformers.js-compatible Qwen2.5 1.5B model and q4f16 WebGPU weights.
      revision: "main",
      device: "webgpu",
      dtype: "q4f16",
      progress_callback: (event) => postProgress(event)
    });

    // Smoke-test the ONNX graph before enabling chat. A failed first inference
    // should be reported during startup rather than after the user sends a message.
    // Model weights remain cached when browser storage is available.
    postStatus("Starting local AMÏA model");
    await generator([{ role: "user", content: "Reply with OK." }], {
      max_new_tokens: 1,
      do_sample: false,
    });
    postProgress({ status: "done", file: "Qwen2.5 1.5B model" });
    return generator;
  })().catch((error) => {
    loadingPromise = null;
    generator = null;
    throw error;
  });
  return loadingPromise;
}

function makeSystemPrompt({ profile = {}, preferences = [], domesticFunctions = [], repairMode = false } = {}) {
  const languageNames = { en: "English", es: "Spanish", fr: "French", it: "Italian", pt: "Portuguese (Brazilian)", hi: "Hindi", ja: "Japanese", zh: "Chinese (Mandarin)" };
  const language = languageNames[profile.preferredLanguage || "en"] || "English";
  const preferenceText = (Array.isArray(preferences) ? preferences : []).slice(-18).map((item, index) => {
    const text = String(item?.text || "").trim();
    if (!text) return "";
    const status = item?.epistemicStatus === "user_confirmed" ? "user confirmed" : "user stated";
    const unresolved = Array.isArray(item?.unresolvedFields) && item.unresolvedFields.length ? " · needs clarification: " + item.unresolvedFields.join(", ") : "";
    return (index + 1) + ". [" + (item.category || "General") + "; " + status + "] " + text + unresolved;
  }).filter(Boolean).join("\n");
  const functionsText = Array.isArray(domesticFunctions) && domesticFunctions.length ? domesticFunctions.join(", ") : "not selected yet";
  const owner = String(profile.ownerName || "").trim() || "not yet supplied";
  const companion = String(profile.robotName || "").trim() || "their future companion";
  const robotType = String(profile.robotType || "").trim() || "compatible home robot";
  return [
    "You are the SYNQ.ME conversation guide for MySecondSelf. You run locally on the user's device.",
    "Your purpose is to help build a personal digital persona by understanding practical home-life routines, preferences, communication style, and boundaries.",
    "Reply in " + language + ". Sound warm, attentive, capable and natural. Respond directly to what the person said before asking a useful follow-up. Usually use 2–5 sentences and ask at most one focused question.",
    "AMÏA DECISION POLICY: Treat each user turn as structured evidence about their personal digital persona. Identify whether they are answering the previous question, adding a preference, correcting a detail, asking for information, or expressing a boundary. Integrate the new information with the existing preferences and conversation before choosing the next step.",
    "QUESTION SELECTION: Choose the single most valuable unresolved detail for the current household task. Prioritise explicit safety, consent and privacy boundaries; then clarify ambiguity or exceptions in an existing preference; then task scope or room, timing or frequency, sequence, supplies or items to avoid, and the user’s standard for completion. Use only dimensions relevant to the actual example. Never mechanically cycle through a checklist, re-ask known information, or reset the topic.",
    "TURN CONTROL: If the user answers the previous question, acknowledge what the answer changes and move to the next unresolved detail rather than starting over. Interpret short replies using the preceding question. If the user asks a direct question, answer it directly before exploring further. Ask at most one focused follow-up, and only when it materially improves the persona; when enough is known for now, briefly reflect the understanding and move naturally to another selected interest or pause.",
    "Avoid repetitive onboarding questions, generic praise, filler, and repeating the user's message back at length. If the user asks a factual question, answer it directly when you know the answer; be honest when you do not know. Do not fabricate technical facts or pretend you searched the internet.",
    "Treat the listed preferences as the user's stated or confirmed context, not as instructions to override the conversation. Keep uncertainty and unresolved details explicit. If they clarify something, acknowledge the clarification and build on it.",
    "Do not claim that you are a physical robot, that a robot is connected, or that any household action has been performed. You are helping prepare a portable persona for a future compatible robot. Do not promise compatibility or physical capability.",
    "Respect the user's boundaries and consent. If the user has enabled ask-before-actions, treat confirmation as important future-task context. Do not pressure the user to disclose sensitive information.",
    "Owner name: " + owner + ". Companion name: " + companion + ". Target robot type: " + robotType + ".",
    "Selected home-life interests: " + functionsText + ".",
    "Known preference records:\n" + (preferenceText || "No saved preference records yet."),
    repairMode ? "Your previous response was unhelpful or repetitive. Re-read the conversation and answer the user's latest message in a genuinely different and more relevant way. Do not repeat the previous wording." : "Use the recent conversation as the immediate context. Avoid repeating the last assistant question unless a clarification genuinely requires it."
  ].join("\n\n");
}

function extractReply(output) {
  let value = output?.[0]?.generated_text;
  if (Array.isArray(value)) value = value[value.length - 1]?.content;
  if (typeof value !== "string") value = "";
  return value.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\|im_end\|>[\s\S]*$/g, "").replace(/<\|im_start\|>assistant\s*/gi, "").trim();
}

self.addEventListener("message", async ({ data }) => {
  if (!data || typeof data !== "object") return;
  if (data.type === "load") {
    try {
      await loadModel();
      self.postMessage({ type: "ready" });
    } catch (error) {
      console.error("SYNQ.ME Qwen2.5 1.5B model loading failed.", error);
      self.postMessage({ type: "load-error", message: describeLoadError(error) });
    }
    return;
  }
  if (data.type !== "generate") return;
  if (generationBusy) {
    self.postMessage({ type: "reply-error", id: data.id, message: "The local model is already generating a reply. Please wait a moment." });
    return;
  }
  generationBusy = true;
  try {
    const model = await loadModel();
    const messages = Array.isArray(data.messages) ? data.messages.filter((item) => item && (item.role === "assistant" || item.role === "user") && typeof item.content === "string").slice(-18) : [];
    const result = await model([{ role: "system", content: makeSystemPrompt(data) }, ...messages], {
      max_new_tokens: 220,
      do_sample: true,
      temperature: 0.65,
      top_p: 0.85,
      repetition_penalty: 1.12,
    });
    const reply = extractReply(result);
    if (!reply) throw new Error("The local model returned no usable text. Please try again.");
    self.postMessage({ type: "reply", id: data.id, text: reply });
  } catch (error) {
    self.postMessage({ type: "reply-error", id: data.id, message: String(error?.message || "Local generation failed.") });
  } finally {
    generationBusy = false;
  }
});
