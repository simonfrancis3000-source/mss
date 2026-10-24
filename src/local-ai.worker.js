import { env, pipeline } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/Qwen3-4B-ONNX";
let generator = null;
let loadingPromise = null;
let generationBusy = false;

function postProgress(event) {
  try { self.postMessage({ type: "progress", ...event }); } catch {}
}

async function loadModel() {
  if (generator) return generator;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    env.useBrowserCache = true;
    env.useWasmCache = true;
    env.cacheKey = "transformers-cache";
    if (!self.navigator?.gpu) {
      throw new Error("This device/browser does not expose WebGPU. Open SYNQ.ME in an up-to-date Chrome or Edge browser on a WebGPU-compatible device.");
    }
    const adapter = await self.navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) {
      throw new Error("WebGPU is present, but no compatible GPU adapter is available. Try a current Chrome or Edge browser on a supported device.");
    }
    postProgress({ status: "initiate", file: "Qwen3-4B model" });
    generator = await pipeline("text-generation", MODEL_ID, {
      // Pin the model revision so upstream updates do not unexpectedly invalidate the local cache.
      revision: "21d7994e6b4736786dce45b3eef15dd58304e4b3",
      device: "webgpu",
      dtype: "q4f16",
      progress_callback: (event) => postProgress(event)
    });
    postProgress({ status: "done", file: "Qwen3-4B model" });
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
      self.postMessage({ type: "load-error", message: String(error?.message || "Could not load the local model.") });
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
      chat_template_kwargs: { enable_thinking: false }
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
