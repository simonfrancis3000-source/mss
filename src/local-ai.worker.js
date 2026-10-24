import { env, pipeline } from "@huggingface/transformers";

const DESKTOP_MODEL_ID = "onnx-community/Qwen2.5-1.5B-Instruct";
const COMPACT_MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
const IS_MOBILE_DEVICE = (() => {
  const nav = self.navigator || {};
  const ua = String(nav.userAgent || "");
  const iPadDesktopUA = /Macintosh/i.test(ua) && Number(nav.maxTouchPoints || 0) > 1;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || iPadDesktopUA;
})();
let forceCpuBackend = IS_MOBILE_DEVICE;
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
  if (value.length < 3) return true;

  // Reject obvious tokenizer/GPU corruption rather than showing symbol soup.
  const suspicious = value.match(/[#$%*+|<>_\\[\\]{}@^~]/g) || [];
  const slashCount = (value.match(/\\//g) || []).length;
  const suspiciousCount = suspicious.length + slashCount;
  const suspiciousRatio = suspiciousCount / Math.max(1, value.length);
  const invalidRuns = /[#$%*+|<>_\\[\\]{}@^~]{4,}/.test(value) || /\\/{4,}/.test(value);
  const letters = value.match(/\p{L}/gu) || [];
  return invalidRuns || (suspicious.length >= 8 && suspiciousRatio > 0.08) ||
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

    // Mobile browsers can evict origin storage when a single model is larger
    // than their practical quota. Use the compact 0.5B model on mobile and
    // skip WebGPU there: the 1.5B q4f16 file is 1.22 GB.
    const preferredModelId = (IS_MOBILE_DEVICE || forceCpuBackend)
      ? COMPACT_MODEL_ID
      : DESKTOP_MODEL_ID;
    const preferredDtype = (IS_MOBILE_DEVICE || forceCpuBackend) ? "q4" : "q4f16";
    modelCacheDetected = await hasCachedModelFiles(preferredModelId, preferredDtype);
    postStatus(modelCacheDetected
      ? (IS_MOBILE_DEVICE ? "Loading cached compact local AMÏA model" : "Loading cached local AMÏA model")
      : (IS_MOBILE_DEVICE ? "Preparing compact local AMÏA model for mobile" : "Preparing local AMÏA model"));

    const tryBackend = async (device, modelId, dtype) => {
      activeBackend = "";
      activeModelId = modelId;
      modelCacheDetected = await hasCachedModelFiles(modelId, dtype);
      postStatus(device === "webgpu"
        ? (modelCacheDetected ? "Loading cached local AMÏA model on GPU" : "Loading local AMÏA model on GPU")
        : (modelId === COMPACT_MODEL_ID
          ? (modelCacheDetected ? "Loading cached compact local AMÏA model" : "Loading compact local AMÏA model")
          : "Switching local AMÏA to CPU inference"));
      generator = await pipeline("text-generation", modelId, {
        revision: "main",
        device,
        dtype,
        progress_callback: (event) => postProgress(event)
      });
      postStatus(device === "webgpu" ? "Testing local AMÏA GPU inference" : "Testing local AMÏA CPU inference");
      const smoke = await generator([{ role: "user", content: "Reply with OK." }], {
        max_new_tokens: 2,
        do_sample: false
      });
      if (isUnusableReply(extractReply(smoke))) {
        throw new Error("The local model failed its response-quality check.");
      }
      activeBackend = device;
      activeModelId = modelId;
      return generator;
    };

    let webgpuError = null;
    if (!IS_MOBILE_DEVICE && !forceCpuBackend && self.navigator?.gpu) {
      try {
        const adapter = await self.navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
        if (!adapter) throw new Error("No compatible WebGPU adapter was available.");
        await tryBackend("webgpu", DESKTOP_MODEL_ID, "q4f16");
      } catch (error) {
        webgpuError = error;
        generator = null;
        forceCpuBackend = true;
        postStatus("GPU inference unavailable. Switching to compact CPU mode");
      }
    } else if (!IS_MOBILE_DEVICE && !forceCpuBackend) {
      webgpuError = new Error("WebGPU is not available in this browser.");
      forceCpuBackend = true;
    }

    if (!generator) {
      try {
        try {
          env.backends.onnx.wasm.numThreads = Math.max(
            1,
            Math.min(4, (self.navigator?.hardwareConcurrency || 2) - 1)
          );
        } catch {}
        await tryBackend("wasm", COMPACT_MODEL_ID, "q4");
      } catch (wasmError) {
        generator = null;
        const gpuDetail = webgpuError?.message || String(webgpuError || "GPU inference was skipped");
        const cpuDetail = wasmError?.message || String(wasmError || "CPU inference failed");
        throw new Error("Freya could not start local inference. GPU: " + gpuDetail + " CPU: " + cpuDetail);
      }
    }

    postProgress({ status: "done", file: activeModelId || COMPACT_MODEL_ID });
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
