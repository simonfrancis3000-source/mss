import { env, pipeline, ModelRegistry } from "@huggingface/transformers";

const DESKTOP_MODEL_ID = "onnx-community/Qwen2.5-1.5B-Instruct";
const COMPACT_MODEL_ID = "onnx-community/SmolLM2-360M-Instruct-ONNX";
const IS_MOBILE_DEVICE = (() => {
  const nav = self.navigator || {};
  const ua = String(nav.userAgent || "");
  const iPadDesktopUA = /Macintosh/i.test(ua) && Number(nav.maxTouchPoints || 0) > 1;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || iPadDesktopUA;
})();
let forceCpuBackend = true;
let activeBackend = "";
let activeModelId = "";
let generator = null;
let loadingPromise = null;
let generationBusy = false;
let modelCacheDetected = false;

function postProgress(event) {
  const info = event && typeof event === "object" ? event : {};
  const aggregate = info.status === "progress_total";
  const perFile = info.status === "progress";
  try {
    self.postMessage({
      type: "progress",
      cached: modelCacheDetected,
      modelId: activeModelId,
      status: String(info.status || ""),
      file: typeof info.file === "string" ? info.file : "",
      aggregate,
      progress: (aggregate || perFile) && Number.isFinite(info.progress) ? info.progress : null,
      loaded: Number.isFinite(info.loaded) ? info.loaded : null,
      total: Number.isFinite(info.total) ? info.total : null
    });
  } catch {}
}

function postStatus(label) {
  try { self.postMessage({ type: "status", label, modelId: activeModelId }); } catch {}
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

async function removeCachedModelFiles(modelId) {
  try {
    if (!self.caches) return;
    const cache = await self.caches.open(env.cacheKey);
    const requests = await cache.keys();
    const encodedModelId = encodeURIComponent(modelId);
    await Promise.all(requests.map((request) => {
      const url = request.url;
      if (url.includes(modelId) || url.includes(encodedModelId)) {
        return cache.delete(request);
      }
      return Promise.resolve(false);
    }));
  } catch (error) {
    console.warn("Could not remove obsolete model files from browser cache.", error);
  }
}

async function hasCachedModelFiles(modelId, dtype) {
  try {
    if (!self.caches || !env.useBrowserCache) return false;
    const cache = await self.caches.open(env.cacheKey);
    const requests = await cache.keys();
    const encodedModelId = encodeURIComponent(modelId);
    const weightName = dtype === "q4f16" ? "model_q4f16.onnx" : "model_q4.onnx";
    return requests.some((request) => {
      const url = request.url;
      const matchesModel = url.includes(modelId) || url.includes(encodedModelId);
      const matchesWeights = url.includes(weightName);
      return matchesModel && matchesWeights;
    });
  } catch {
    return false;
  }
}

function isUnusableReply(text) {
  const value = String(text || "").trim();
  if (value.length < 2) return true;

  // Reject obvious tokenizer/GPU corruption rather than showing symbol soup.
  const suspicious = value.match(/[#$%*+|<>_\[\]{}@^~]/g) || [];
  const slashCount = (value.match(/\//g) || []).length;
  const suspiciousCount = suspicious.length + slashCount;
  const suspiciousRatio = suspiciousCount / Math.max(1, value.length);
  const invalidRuns = /[#$%*+|<>_\[\]{}@^~]{4,}/.test(value) || /\/{4,}/.test(value);
  const letters = value.match(/\p{L}/gu) || [];
  return invalidRuns || (suspiciousCount >= 8 && suspiciousRatio > 0.08) ||
    (value.length > 20 && letters.length / value.length < 0.22);
}

async function loadModel() {
  if (generator) return generator;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    env.useBrowserCache = true;
    env.useWasmCache = true;
    env.cacheKey = "transformers-cache";
    try { await self.navigator.storage?.persist?.(); } catch {}

    // Use one compact CPU model on every device. The previous 1.5B WebGPU
    // path produced invalid output and a 1.14 GB download on mobile. A single
    // 386 MB model also avoids repeatedly switching between model caches.
    await removeCachedModelFiles(DESKTOP_MODEL_ID);
    const modelId = COMPACT_MODEL_ID;
    const dtype = "q4";
    activeModelId = modelId;
    activeBackend = "wasm";
    // Use Transformers.js' own cache registry so the decision matches
    // the exact pipeline and quantisation rather than guessing from one URL.
    try {
      modelCacheDetected = await ModelRegistry.is_pipeline_cached(
        "text-generation",
        modelId,
        { dtype }
      );
    } catch (cacheCheckError) {
      console.warn("Could not verify the local model cache; falling back to normal cache-aware loading.", cacheCheckError);
      modelCacheDetected = await hasCachedModelFiles(modelId, dtype);
    }
    postStatus(modelCacheDetected
      ? "Loading cached compact local AMÏA model"
      : "Preparing compact local AMÏA model");

    try {
      try {
        env.backends.onnx.wasm.numThreads = Math.max(
          1,
          Math.min(4, (self.navigator?.hardwareConcurrency || 2) - 1)
        );
      } catch {}

      generator = await pipeline("text-generation", modelId, {
        revision: "main",
        device: "wasm",
        dtype,
        // Once all required files are in cache, disallow remote fallbacks.
        // This prevents a cache miss from silently becoming a large re-download.
        local_files_only: modelCacheDetected,
        progress_callback: (event) => postProgress(event)
      });
      postStatus("Testing compact local AMÏA model");
      const smoke = await generator([{ role: "user", content: "Reply with OK." }], {
        max_new_tokens: 2,
        do_sample: false
      });
      if (isUnusableReply(extractReply(smoke))) {
        throw new Error("The local model failed its response-quality check.");
      }
    } catch (error) {
      generator = null;
      const detail = error?.message || String(error || "Unknown model startup error");
      throw new Error("Freya could not start the compact local model: " + detail);
    }

    postProgress({ status: "done", file: modelId });
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
    if (data.forceCpu === true) forceCpuBackend = true;
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
    if (isUnusableReply(reply)) {
      if (activeBackend === "webgpu") {
        throw new Error("WebGPU returned corrupted text output. Restart on CPU mode and retry.");
      }
      throw new Error("The local model returned malformed text instead of a readable reply. Try sending the question again.");
    }
    self.postMessage({ type: "reply", id: data.id, text: reply });
  } catch (error) {
    self.postMessage({ type: "reply-error", id: data.id, message: String(error?.message || "Local generation failed.") });
  } finally {
    generationBusy = false;
  }
});
