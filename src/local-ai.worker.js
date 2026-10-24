import { env, pipeline, ModelRegistry } from "@huggingface/transformers";

const COMPACT_MODEL_ID = "onnx-community/SmolLM2-360M-Instruct-ONNX";
const IS_MOBILE_DEVICE = (() => {
  const ua = String(self.navigator?.userAgent || "");
  const iPadDesktopUA = /Macintosh/i.test(ua) && Number(self.navigator?.maxTouchPoints || 0) > 1;
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
    // Transformers.js disables local model-file checks by default in browsers.
    // Cached models with local_files_only=true require this flag to be enabled.
    env.allowLocalModels = true;
    env.allowRemoteModels = true;
    env.useBrowserCache = true;
    env.useWasmCache = true;
    env.cacheKey = "transformers-cache";
    try { await self.navigator.storage?.persist?.(); } catch {}

    // Keep one small quantised model across devices to avoid a second download.
    // Do not delete any model cache during routine startup. Keep previously
    // downloaded files so a new worker can reuse them after a timeout/reload.
    const modelId = COMPACT_MODEL_ID;
    const dtype = "q4";
    activeModelId = modelId;

    try {
      modelCacheDetected = await ModelRegistry.is_pipeline_cached(
        "text-generation",
        modelId,
        { dtype }
      );
    } catch (cacheCheckError) {
      // If cache verification fails, let Transformers.js manage its normal cache.
      console.warn("Could not verify the model cache; using cache-aware loading.", cacheCheckError);
      modelCacheDetected = false;
    }

    postStatus(modelCacheDetected
      ? "Loading cached compact local AMÏA model"
      : "Preparing compact local AMÏA model");

    const tryBackend = async (device) => {
      activeBackend = device;
      generator = await pipeline("text-generation", modelId, {
        revision: "main",
        device,
        dtype,
        local_files_only: modelCacheDetected,
        progress_callback: (event) => postProgress(event)
      });
      postStatus(device === "webgpu"
        ? "Testing compact local AMÏA on GPU"
        : "Testing compact local AMÏA on CPU");
      const smoke = await generator([{ role: "user", content: "Reply with OK." }], {
        max_new_tokens: 2,
        do_sample: false
      });
      if (isUnusableReply(extractReply(smoke))) {
        throw new Error("The local model failed its response-quality check.");
      }
      return generator;
    };

    let gpuError = null;
    if (!forceCpuBackend && !IS_MOBILE_DEVICE && self.navigator?.gpu) {
      try {
        const adapter = await self.navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
        if (!adapter) throw new Error("No compatible WebGPU adapter was available.");
        // Use the already-downloaded Q4 model on desktop as well. This avoids
        // fetching a separate q4f16 weights file just to accelerate inference.
        await tryBackend("webgpu");
      } catch (error) {
        gpuError = error;
        generator = null;
        activeBackend = "wasm";
        forceCpuBackend = true;
        postStatus("GPU inference failed. Switching to CPU mode");
      }
    } else if (!IS_MOBILE_DEVICE && !forceCpuBackend) {
      gpuError = new Error("WebGPU is unavailable in this browser.");
      forceCpuBackend = true;
    }

    if (!generator) {
      try {
        // Multi-threaded WASM requires cross-origin isolation in some browsers.
        // Use a single thread when the app is not cross-origin isolated to avoid
        // a worker/runtime that starts but never returns tokens.
        const canUseWasmThreads = Boolean(self.crossOriginIsolated);
        env.backends.onnx.wasm.numThreads = canUseWasmThreads
          ? Math.max(1, Math.min(4, (self.navigator?.hardwareConcurrency || 2) - 1))
          : 1;
        await tryBackend("wasm");
      } catch (wasmError) {
        generator = null;
        const gpuDetail = gpuError?.message || "GPU inference was skipped on this device";
        const cpuDetail = wasmError?.message || String(wasmError || "CPU inference failed");
        throw new Error("Freya could not start local inference. GPU: " + gpuDetail + " CPU: " + cpuDetail);
      }
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
  const preferenceText = (Array.isArray(preferences) ? preferences : []).slice(-4).map((item, index) => {
    const text = String(item?.text || "").trim().slice(0, 140);
    return text ? (index + 1) + ". " + text : "";
  }).filter(Boolean).join("\n");
  const functionsText = Array.isArray(domesticFunctions) && domesticFunctions.length
    ? domesticFunctions.slice(0, 4).join(", ")
    : "not selected yet";
  const owner = String(profile.ownerName || "").trim().slice(0, 60) || "not yet supplied";
  const companion = String(profile.robotName || "").trim().slice(0, 60) || "their future companion";
  const robotType = String(profile.robotType || "").trim().slice(0, 80) || "compatible home robot";
  return [
    "You are Freya, the friendly and practical conversation partner in SYNQ.ME. You help a person teach their future home robot their routines and preferences.",
    "Reply directly to the latest user message in " + language + ". Be warm, specific and concise. Respond to the actual point, then ask at most one relevant follow-up question when helpful.",
    "Do not output canned customer-support apologies or say you are unable to respond. If the message is understandable, answer it normally. Do not merely repeat the user's words. Never claim you physically performed a task.",
    "User: " + owner + ". Future companion: " + companion + " (" + robotType + "). Interests: " + functionsText + ".",
    "Relevant preferences:\n" + (preferenceText || "None recorded yet."),
    repairMode
      ? "This is a retry. Give a fresh, useful answer to the latest user message. Do not apologise for failure and do not use a generic retry message."
      : "Continue the conversation naturally and avoid repetitive onboarding questions."
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
    const historyLimit = IS_MOBILE_DEVICE ? 3 : 4;
    const replyTokenLimit = IS_MOBILE_DEVICE ? 40 : 56;
    const messages = Array.isArray(data.messages)
      ? data.messages
          .filter((item) => item && (item.role === "assistant" || item.role === "user") && typeof item.content === "string")
          .slice(-historyLimit)
          .map((item) => {
            const content = String(item.content);
            const limit = item.role === "user" ? 700 : 450;
            const clipped = content.length > limit
              ? content.slice(0, Math.floor(limit * 0.65)) + "\n…\n" + content.slice(-Math.floor(limit * 0.35))
              : content;
            return { role: item.role, content: clipped };
          })
      : [];
    const preferences = Array.isArray(data.preferences)
      ? data.preferences.slice(IS_MOBILE_DEVICE ? -3 : -4)
      : [];
    postStatus(activeBackend === "webgpu"
      ? "Freya is generating your reply on GPU"
      : "Freya is generating your reply on CPU");
    const result = await model([{ role: "system", content: makeSystemPrompt({ ...data, preferences }) }, ...messages], {
      max_new_tokens: replyTokenLimit,
      do_sample: true,
      temperature: 0.7,
      top_p: 0.9,
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
