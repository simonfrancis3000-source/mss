import { createClient } from "@supabase/supabase-js";

const STORAGE_KEY = "synqme-demo-v1";
const LOCAL_MODEL_LABEL = "On-device AI";
const ACCOUNT_DRAFT_KEY = "synqme-pending-account-migration-v1";
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const AUTH_REDIRECT_URL = (() => {
  const configured = String(import.meta.env.VITE_AUTH_REDIRECT_URL || "").trim();
  if (configured && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured)) {
    return configured.replace(/\/+$/, "") + "/";
  }
  return "https://synqme.mysecondself.app/";
})();
let rememberMeEnabled = (() => {
  try {
    const savedChoice = localStorage.getItem("synqme-remember-me-choice");
    if (savedChoice === "true") return true;
    if (savedChoice === "false") return false;
  } catch {}
  return document.querySelector("#rememberMe")?.checked ?? true;
})();
if (document.querySelector("#rememberMe")) {
  document.querySelector("#rememberMe").checked = rememberMeEnabled;
}

// Select localStorage ("Remember me") or sessionStorage (this tab only) for
// the Supabase session. The persona itself is synchronised to the signed-in
// account and is not dependent on this device keeping an auth token.
const rememberMeStorage = {
  async getItem(key) {
    let persistent = null;
    let tabSession = null;
    try { persistent = localStorage.getItem(key); } catch {}
    try { tabSession = sessionStorage.getItem(key); } catch {}
    const rememberCheckbox = document.querySelector("#rememberMe");
    if (persistent !== null) {
      rememberMeEnabled = true;
      if (rememberCheckbox) rememberCheckbox.checked = true;
      return persistent;
    }
    if (tabSession !== null) {
      rememberMeEnabled = false;
      if (rememberCheckbox) rememberCheckbox.checked = false;
      return tabSession;
    }
    return null;
  },
  async setItem(key, value) {
    const preferred = rememberMeEnabled ? localStorage : sessionStorage;
    const other = rememberMeEnabled ? sessionStorage : localStorage;
    try { other.removeItem(key); } catch {}
    preferred.setItem(key, value);
  },
  async removeItem(key) {
    try { localStorage.removeItem(key); } catch {}
    try { sessionStorage.removeItem(key); } catch {}
  }
};
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storage: rememberMeStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;
const WELCOME = "Hi, I’m here to help you build your SecondSelf. Which parts of home life would you like it to understand first?";
const WELCOME_BY_LANGUAGE = {
  en: WELCOME,
  es: "Hola, estoy aquí para ayudarte a crear tu SecondSelf. ¿Qué aspectos de la vida en casa te gustaría que aprendiera primero?",
  fr: "Bonjour, je suis là pour t’aider à construire ton SecondSelf. Quels aspects de la vie à la maison aimerais-tu que je comprenne en premier ?",
  it: "Ciao, sono qui per aiutarti a costruire il tuo SecondSelf. Quali aspetti della vita in casa vorresti che imparassi per primi?",
  pt: "Olá, estou aqui para te ajudar a construir o teu SecondSelf. Que aspetos da vida em casa gostarias que eu aprendesse primeiro?",
  hi: "नमस्ते, मैं आपका SecondSelf बनाने में मदद करने के लिए यहाँ हूँ। आप चाहेंगे कि मैं घर की दिनचर्या के किन पहलुओं को सबसे पहले समझूँ?",
  ja: "こんにちは。あなたのSecondSelfづくりをお手伝いします。家での暮らしのどんなことを、まず理解してほしいですか？",
  zh: "你好，我来帮你建立自己的 SecondSelf。你希望我先了解家庭生活中的哪些方面？"
};
const KNOWN_WELCOME_MESSAGES = new Set(Object.values(WELCOME_BY_LANGUAGE));
function localizeWelcomeMessage(language) {
  const welcome = WELCOME_BY_LANGUAGE[language] || WELCOME;
  state.messages = state.messages.map((item) =>
    item?.role === "assistant" && KNOWN_WELCOME_MESSAGES.has(item.content)
      ? { ...item, content: welcome }
      : item
  );
}

const ROBOT_APPEARANCE_KEY = "synqme-robot-appearance-v1";
const OWNER_AVATAR_KEY = "synqme-owner-avatar-v1";
let ownerAvatarData = (() => {
  try {
    const saved = localStorage.getItem(OWNER_AVATAR_KEY);
    return typeof saved === "string" ? saved : "";
  } catch {
    return "";
  }
})();
const ROBOT_OPTIONS = [
  { id: "elo", name: "ELO", accent: "#58a6ff", description: "Friendly and familiar" },
  { id: "lumi", name: "LUMI", accent: "#77c8b2", description: "Calm and curious" },
  { id: "pip", name: "PIP", accent: "#f0b96d", description: "Playful and bright" },
  { id: "nova", name: "NOVA", accent: "#b3a0ff", description: "Quietly clever" },
  { id: "miso", name: "MISO", accent: "#f19ac4", description: "Soft and cheerful" }
];
let robotAppearance = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(ROBOT_APPEARANCE_KEY) || "{}");
    return {
      robotId: ROBOT_OPTIONS.some((item) => item.id === saved.robotId) ? saved.robotId : "elo",
      customImageData: typeof saved.customImageData === "string" ? saved.customImageData : ""
    };
  } catch {
    return { robotId: "elo", customImageData: "" };
  }
})();

const ACTIVITIES = [
  { id: "dishwashing", label: "Dishwashing" },
  { id: "vacuuming", label: "Vacuuming & floors" },
  { id: "laundry", label: "Laundry" },
  { id: "folding", label: "Folding & putting away" },
  { id: "tidying", label: "Tidying" },
  { id: "surfaces", label: "Surface cleaning" },
  { id: "meal-prep", label: "Meal preparation" },
  { id: "cooking", label: "Cooking" },
  { id: "groceries", label: "Groceries & supplies" },
  { id: "pet-care", label: "Pet care" },
  { id: "plants", label: "Plant care" },
  { id: "recycling", label: "Waste & recycling" }
];

const MILESTONES = [
  { id: "first-spark", title: "First spark", reward: "Starter badge", description: "Set your name, choose a home interest, or share your first preference.", unlocked: (s) => Boolean(s.profile.ownerName.trim() || s.functions.length || s.preferences.length) },
  { id: "home-explorer", title: "Home explorer", reward: "Explorer badge", description: "Choose three domestic functions for your SecondSelf to learn about.", unlocked: (s) => s.functions.length >= 3 },
  { id: "first-memory", title: "First memory", reward: "Memory badge", description: "Capture your first personal preference in conversation.", unlocked: (s) => s.preferences.length >= 1 },
  { id: "pattern-finder", title: "Pattern finder", reward: "Personalisation badge", description: "Share five preferences and begin to form recognisable patterns.", unlocked: (s) => s.preferences.length >= 5 },
  { id: "secondself-builder", title: "SecondSelf builder", reward: "Foundation badge", description: "Choose three functions and capture eight preferences.", unlocked: (s) => s.functions.length >= 3 && s.preferences.length >= 8 }
];

const $ = (selector) => document.querySelector(selector);
const elements = {
  splash: $("#appSplash"),
  providerLabel: $("#providerLabel"),
  preferredLanguage: $("#preferredLanguage"),
  conversationStatus: $("#conversationStatus"),
  localAIProgress: $("#localAIProgress"),
  localAIProgressLabel: $("#localAIProgressLabel"),
  localAIProgressFill: $("#localAIProgressFill"),
  localAIProgressTrack: $("#localAIProgressTrack"),
  chatTranscriptShell: $("#chatTranscriptShell"),
  chatMessages: $("#chatMessages"),
  chatScrollbarTrack: $("#chatScrollbarTrack"),
  chatScrollbarThumb: $("#chatScrollbarThumb"),
  chatForm: $("#chatForm"),
  messageInput: $("#messageInput"),
  sendButton: $("#sendButton"),
  voiceModeButton: $("#voiceModeButton"),
  voiceStatus: $("#voiceStatus"),
  selectedRobotArt: $("#selectedRobotArt"),
  selectedRobotName: $("#selectedRobotName"),
  robotPicker: $("#robotPicker"),
  robotImageInput: $("#robotImageInput"),
  uploadRobotImageButton: $("#uploadRobotImageButton"),
  voiceExperience: $("#voiceExperience"),
  voiceExperienceTitle: $("#voiceExperienceTitle"),
  voiceIntroCopy: $("#voiceIntroCopy"),
  voiceOrb: $("#voiceOrb"),
  voiceOrbCore: $("#voiceOrbCore"),
  voiceExperienceStatus: $("#voiceExperienceStatus"),
  voiceCompanionName: $("#voiceCompanionName"),
  voiceRetrySpeechButton: $("#voiceRetrySpeechButton"),
  voiceModelProgress: $("#voiceModelProgress"),
  voiceModelProgressTrack: $("#voiceModelProgressTrack"),
  voiceModelProgressFill: $("#voiceModelProgressFill"),
  voiceModelProgressLabel: $("#voiceModelProgressLabel"),
  voiceModelProgressPercent: $("#voiceModelProgressPercent"),
  voiceModelProgressMain: $("#voiceModelProgressMain"),
  voiceModelProgressTrackMain: $("#voiceModelProgressTrackMain"),
  voiceModelProgressFillMain: $("#voiceModelProgressFillMain"),
  voiceModelProgressLabelMain: $("#voiceModelProgressLabelMain"),
  voiceModelProgressPercentMain: $("#voiceModelProgressPercentMain"),
  voiceMuteButton: $("#voiceMuteButton"),
  voiceMuteControlButton: $("#voiceMuteControlButton"),
  voiceMuteControlLabel: $("#voiceMuteControlLabel"),
  voiceEndButton: $("#voiceEndButton"),
  voiceChatButton: $("#voiceChatButton"),
  resetDemo: $("#resetDemo"),
  memoryCount: $("#memoryCount"),
  foundationValue: $("#foundationValue"),
  personaProgress: $("#personaProgress"),
  preferenceCount: $("#preferenceCount"),
  preferenceList: $("#preferenceList"),
  memoryFootnote: $("#memoryFootnote"),
  decisionSummary: $("#decisionSummary"),
  amyaState: $("#amyaState"),
  pexiState: $("#pexiState"),
  runTask: $("#runTask"),
  taskResult: $("#taskResult"),
  taskDescription: $("#taskDescription"),
  taskSteps: $("#taskSteps"),
  openSettings: $("#openSettings"),
  openPersonaFromSummary: $("#openPersonaFromSummary"),
  settingsDialog: $("#settingsDialog"),
  settingsSheet: $(".settings-sheet"),
  settingsBackdrop: $("#settingsBackdrop"),
  profileSetupNotice: $("#profileSetupNotice"),
  settingsTitle: $("#settingsTitle"),
  settingsIntro: $("#settingsIntro"),
  settingsSaveButton: $(".settings-save"),
  companionName: $("#companionName"),
  exportPexiPackage: $("#exportPexiPackage"),
  pexiReadinessSummary: $("#pexiReadinessSummary"),
  pexiReadinessStatus: $("#pexiReadinessStatus"),
  closeSettings: $("#closeSettings"),
  cancelSettings: $("#cancelSettings"),
  settingsForm: $("#settingsForm"),
  ownerName: $("#ownerName"),
  ownerAvatarPreview: $("#ownerAvatarPreview"),
  ownerImageInput: $("#ownerImageInput"),
  uploadOwnerImageButton: $("#uploadOwnerImageButton"),
  removeOwnerImageButton: $("#removeOwnerImageButton"),
  robotName: $("#robotName"),
  robotType: $("#robotType"),
  confirmActions: $("#confirmActions"),
  functionGrid: $("#functionGrid"),
  functionCount: $("#functionCount"),
  toggleAllFunctions: $("#toggleAllFunctions"),
  settingsPreferenceCount: $("#settingsPreferenceCount"),
  settingsPreferenceList: $("#settingsPreferenceList"),
  milestoneCount: $("#milestoneCount"),
  milestoneList: $("#milestoneList"),
  openTaskFromSettings: $("#openTaskFromSettings"),
  mobileOwnerTitle: $("#mobileOwnerTitle"),
  mobileJourneyText: $("#mobileJourneyText"),
  mobileProgressValue: $("#mobileProgressValue"),
  authGate: $("#authGate"),
  authForm: $("#authForm"),
  authTitle: $("#authTitle"),
  authDescription: $("#authDescription"),
  authEmail: $("#authEmail"),
  authEmailLabel: $("#authEmailLabel"),
  authPassword: $("#authPassword"),
  authPasswordLabel: $("#authPasswordLabel"),
  rememberMe: $("#rememberMe"),
  authImportDraft: $("#authImportDraft"),
  authImportDraftWrap: $("#authImportDraftWrap"),
  authStatus: $("#authStatus"),
  authSubmit: $("#authSubmit"),
  authModeToggle: $("#authModeToggle"),
  authForgotPassword: $("#authForgotPassword"),
  accountStatusLabel: $("#accountStatusLabel"),
  accountEmail: $("#accountEmail"),
  signOutButton: $("#signOutButton")
};

function defaultProfile() {
  return { ownerName: "", robotName: "", robotType: "Humanoid robot", robotVoice: "female", preferredLanguage: "en", confirmActions: false };
}

function initialState() {
  return {
    messages: [{ role: "assistant", content: WELCOME }],
    preferences: [],
    profile: defaultProfile(),
    functions: [],
    pendingClarification: null,
    apiConnected: false,
    apiProvider: "local",
    apiModel: LOCAL_MODEL_LABEL,
    apiConfigured: true,
    apiError: "",
    apiErrorDetail: ""
  };
}

function cleanPreference(input, metadata = {}) {
  const text = String(input || "").trim().replace(/\s+/g, " ").slice(0, 240);
  if (!text) return null;
  return {
    text,
    category: metadata.category || classifyPreference(text),
    normalised: metadata.normalised || metadata.normalised_text || text.toLowerCase(),
    id: metadata.id || (Date.now() + "-" + Math.random().toString(36).slice(2, 7)),
    recordedAt: metadata.recordedAt || metadata.created_at || new Date().toISOString(),
    sourceMessage: metadata.sourceMessage || metadata.source_message || "",
    status: metadata.status || metadata.preference_status || "user_stated",
    explicitFacets: metadata.explicitFacets || metadata.explicit_facets || {},
    unresolvedFields: metadata.unresolvedFields || metadata.unresolved_fields || [],
    clarifications: Array.isArray(metadata.clarifications) ? metadata.clarifications : []
  };
}

function sanitiseConversationMessage(item) {
  if (!item || (item.role !== "assistant" && item.role !== "user") || typeof item.content !== "string") return null;
  if (item.role === "assistant" && /what matters most to you when getting that right\?|what detail would matter most to get right\?|let'?s make that preference more precise/i.test(item.content)) {
    return { role: "assistant", content: "Let’s focus on one practical detail at a time." };
  }
  if (item.role === "assistant" && /I've captured this preference for your browser-based SecondSelf|I've added it to your local digital persona|That's useful context for your SecondSelf/i.test(item.content)) {
    return { role: "assistant", content: "Let’s focus on one practical detail at a time." };
  }
  return { role: item.role, content: item.content };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.messages) || !Array.isArray(saved.preferences)) return initialState();

    const state = {
      messages: saved.messages
        .filter((m) => m && (m.role === "assistant" || m.role === "user") && typeof m.content === "string")
        .slice(-5000)
        .map((m) => {
          if (m.role === "assistant" && /follow these steps automatically|the robot will follow|robot will automatically/i.test(m.content)) {
            return { role: "assistant", content: "I’ve noted those preferences for a proposed routine. No physical robot is connected or carrying out the task. You can keep building your SecondSelf by adding more preferences." };
          }
          if (m.role === "assistant" && /Hi, I’m ELO, your SYNQ\.ME guide/i.test(m.content)) {
            return { role: "assistant", content: WELCOME };
          }
          return sanitiseConversationMessage(m);
        }),
      preferences: saved.preferences.slice(0, 24)
        .map((p) => typeof p === "string" ? cleanPreference(p) : cleanPreference(p?.text, p))
        .filter(Boolean),
      profile: { ...defaultProfile(), ...(saved.profile && typeof saved.profile === "object" ? saved.profile : {}) },
      functions: Array.isArray(saved.functions) ? saved.functions.filter((id) => ACTIVITIES.some((a) => a.id === id)) : [],
      pendingClarification: saved.pendingClarification && typeof saved.pendingClarification === "object" ? saved.pendingClarification : null,
      apiConnected: false,
      apiProvider: "local",
      apiModel: LOCAL_MODEL_LABEL,
      apiConfigured: true,
      apiError: "",
      apiErrorDetail: ""
    };
    return state;
  } catch {
    return initialState();
  }
}

let state = loadState();
let localAIWorker = null;
let localAIReady = false;
let localAILoadPromise = null;
let localAILoadResolve = null;
let localAILoadReject = null;
let localAIRequestSequence = 0;
const localAIPendingRequests = new Map();
let isSending = false;
let sendSequence = 0;
let lastAIReplyUsedFallback = false;
const SpeechRecognitionConstructor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const speechSynthesisAvailable = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
let voiceModeActive = false;
let voiceInputMuted = false;
let speechRecognition = null;
let recognitionListening = false;
let recognitionTranscript = "";
let voiceRestartTimer = null;
let assistantIsSpeaking = false;
let currentSpeechUtterance = null;
let lastAssistantReplyForSpeech = "";
let kokoroLoadPromise = null;
let kokoroTTSInstance = null;
let kokoroLoadFailed = false;
let voiceModelProgressTimer = null;
let kokoroAudioElement = null;
let kokoroAudioUrl = "";
let kokoroSpeechGeneration = 0;
const SPEECH_LOCALES = { en: "en-US", es: "es-ES", fr: "fr-FR", it: "it-IT", pt: "pt-BR", hi: "hi-IN", ja: "ja-JP", zh: "zh-CN" };
const KOKORO_VOICE_MAP = {
  en: { female: "af_heart", male: "am_michael" },
  es: { female: "ef_dora", male: "em_alex" },
  fr: { female: "ff_siwis", male: "" },
  it: { female: "if_sara", male: "im_nicola" },
  pt: { female: "pf_dora", male: "pm_alex" },
  hi: { female: "hf_alpha", male: "hm_omega" },
  ja: { female: "jf_alpha", male: "jm_kumo" },
  zh: { female: "zf_xiaobei", male: "zm_yunjian" }
};
let voiceMediaStream = null;
let voiceAudioContext = null;
let voiceAnalyser = null;
let voiceAnalysisBuffer = null;
let voiceMonitorFrame = 0;
let activeMediaRecorder = null;
let voiceAudioChunks = [];
let voiceSpeechDetected = false;
let voiceLastSpeechAt = 0;
let voiceRecordingStartedAt = 0;
let voiceTranscribing = false;
let taskRunning = false;
let lastFocusedElement = null;
let cloudUserId = null;
let cloudUserEmail = "";
let authMode = "signin";
let authBusy = false;
let authRecoveryInProgress = Boolean(/type=recovery/i.test(window.location.hash || ""));
let cloudMode = "local";
let cloudSaveTimer = null;
let cloudSaveChain = Promise.resolve();
let cloudSaveInFlight = false;
let cloudConversationUpdatedAt = null;
let cloudConversationChannel = null;
let cloudConversationRefreshTimer = null;
let cloudConversationRefreshTimeout = null;
let cloudConversationRefreshInFlight = false;

function persist(syncCloud = true) {
  let localSaved = false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      messages: state.messages.slice(-5000),
      preferences: state.preferences.slice(0, 24),
      profile: state.profile,
      functions: state.functions,
      pendingClarification: state.pendingClarification || null
    }));
    localSaved = true;
  } catch {
    if (elements.memoryFootnote) elements.memoryFootnote.textContent = "Session memory only; browser storage is unavailable";
  }
  if (syncCloud) scheduleCloudSave();
  return localSaved;
}

function scheduleCloudSave(delay = 300) {
  if (!supabase || !cloudUserId) return;
  if (cloudSaveTimer) window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(() => {
    cloudSaveTimer = null;
    if (isSending) {
      cloudSaveTimer = window.setTimeout(() => {
        cloudSaveTimer = null;
        scheduleCloudSave();
      }, 1000);
      return;
    }
    cloudSaveChain = cloudSaveChain
      .then(async () => {
        cloudSaveInFlight = true;
        try {
          await saveCloudState();
        } finally {
          cloudSaveInFlight = false;
        }
      })
      .catch((error) => {
        console.info("SYNQ.ME account sync failed.", error);
        cloudMode = "error";
        renderPreferences();
      });
  }, delay);
}

async function flushCloudSave() {
  if (!supabase || !cloudUserId) return false;
  if (cloudSaveTimer) window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = null;
  cloudSaveChain = cloudSaveChain
    .then(async () => {
      cloudSaveInFlight = true;
      try {
        await saveCloudState();
      } finally {
        cloudSaveInFlight = false;
      }
    })
    .catch((error) => {
      console.info("SYNQ.ME account sync failed.", error);
      cloudMode = "error";
      renderPreferences();
      return false;
    });
  await cloudSaveChain;
  return cloudMode === "cloud";
}

function preferenceExtraction(item) {
  const extracted = extractExplicitPreferenceFacets(item.text);
  const storedFields = item.explicitFacets && typeof item.explicitFacets === "object" ? item.explicitFacets : {};
  const explicitFields = Object.keys(storedFields).length ? storedFields : extracted.explicitFacets;
  const storedUnresolved = Array.isArray(item.unresolvedFields) ? item.unresolvedFields : [];
  const confirmedFields = new Set(
    (Array.isArray(item.clarifications) ? item.clarifications : [])
      .filter((entry) => entry && entry.status === "user_confirmed" && typeof entry.field === "string")
      .map((entry) => entry.field)
  );
  const unresolvedFields = (storedUnresolved.length ? storedUnresolved : extracted.unresolvedFields)
    .filter((field) => !confirmedFields.has(field));
  return { explicitFields, unresolvedFields };
}

async function saveCloudState() {
  if (!supabase || !cloudUserId) return;
  const snapshot = {
    profile: { ...state.profile },
    functions: [...state.functions],
    preferences: state.preferences.map((item) => {
      const extracted = preferenceExtraction(item);
      return {
        text: item.text,
        category: item.category || classifyPreference(item.text),
        normalised: (item.normalised || item.text.toLowerCase()).slice(0, 240),
        status: item.status || "user_stated",
        explicitFacets: extracted.explicitFields,
        unresolvedFields: extracted.unresolvedFields,
        clarifications: Array.isArray(item.clarifications) ? item.clarifications : [],
        sourceMessage: item.sourceMessage || item.text,
        recordedAt: item.recordedAt || new Date().toISOString()
      };
    })
  };

  const { error: profileError } = await supabase.from("synqme_profiles").upsert({
    user_id: cloudUserId,
    owner_name: snapshot.profile.ownerName,
    future_robot_name: snapshot.profile.robotName,
    future_robot_type: snapshot.profile.robotType,
    future_robot_voice: snapshot.profile.robotVoice || "female",
    preferred_language: snapshot.profile.preferredLanguage || "en",
    confirm_actions: snapshot.profile.confirmActions,
    domestic_functions: snapshot.functions,
    updated_at: new Date().toISOString()
  }, { onConflict: "user_id" });
  if (profileError) throw profileError;

  const desired = snapshot.preferences.map((item) => ({
    user_id: cloudUserId,
    category: item.category,
    preference_text: item.text,
    normalised_text: item.normalised,
    preference_status: item.status,
    explicit_facets: item.explicitFacets,
    unresolved_fields: item.unresolvedFields,
    source_message: item.sourceMessage,
    clarifications: item.clarifications,
    schema_version: 1
  }));

  if (desired.length) {
    const { error: prefsError } = await supabase.from("synqme_preferences").upsert(
      desired,
      { onConflict: "user_id,normalised_text" }
    );
    if (prefsError) throw prefsError;
  }

  const { data: existing, error: selectError } = await supabase
    .from("synqme_preferences")
    .select("id,normalised_text")
    .eq("user_id", cloudUserId);
  if (selectError) throw selectError;
  const keep = new Set(desired.map((item) => item.normalised_text));
  const stale = (existing || []).filter((item) => !keep.has(item.normalised_text)).map((item) => item.id);
  if (stale.length) {
    const { error: deleteError } = await supabase
      .from("synqme_preferences")
      .delete()
      .eq("user_id", cloudUserId)
      .in("id", stale);
    if (deleteError) throw deleteError;
  }

  // Read the latest transcript before writing: two browsers can otherwise
  // replace the same row with stale, device-local snapshots.
  const { data: existingConversation, error: conversationReadError } = await supabase
    .from("synqme_conversations")
    .select("messages,pending_clarification,updated_at")
    .eq("user_id", cloudUserId)
    .maybeSingle();
  if (conversationReadError) throw conversationReadError;

  const cloudMessages = Array.isArray(existingConversation?.messages) ? existingConversation.messages : [];
  const mergedMessages = mergeConversationMessages(state.messages, cloudMessages);
  const localMessagesBeforeMerge = JSON.stringify(state.messages);
  if (JSON.stringify(mergedMessages) !== localMessagesBeforeMerge && !isSending) {
    state.messages = mergedMessages;
    persist(false);
    renderMessages();
  }
  const conversationUpdatedAt = new Date().toISOString();
  const { error: conversationError } = await supabase.from("synqme_conversations").upsert({
    user_id: cloudUserId,
    messages: mergedMessages,
    pending_clarification: state.pendingClarification || existingConversation?.pending_clarification || null,
    updated_at: conversationUpdatedAt
  }, { onConflict: "user_id" });
  if (conversationError) throw conversationError;
  cloudConversationUpdatedAt = conversationUpdatedAt;

  cloudMode = "cloud";
  renderPreferences();
}

function scheduleCloudConversationRefresh(delay = 120) {
  if (!cloudUserId || !supabase) return;
  if (cloudConversationRefreshTimeout) window.clearTimeout(cloudConversationRefreshTimeout);
  cloudConversationRefreshTimeout = window.setTimeout(() => {
    cloudConversationRefreshTimeout = null;
    void refreshCloudConversation();
  }, delay);
}

async function refreshCloudConversation() {
  if (
    !supabase ||
    !cloudUserId ||
    cloudMode !== "cloud" ||
    cloudConversationRefreshInFlight ||
    cloudSaveInFlight ||
    isSending ||
    cloudSaveTimer ||
    document.visibilityState !== "visible"
  ) return;

  cloudConversationRefreshInFlight = true;
  const userIdAtStart = cloudUserId;
  try {
    const { data, error } = await supabase
      .from("synqme_conversations")
      .select("messages,pending_clarification,updated_at")
      .eq("user_id", userIdAtStart)
      .maybeSingle();
    if (error) throw error;
    if (userIdAtStart !== cloudUserId || !data) return;

    const remoteUpdatedAt = data.updated_at || null;
    const remoteTimestamp = remoteUpdatedAt ? Date.parse(remoteUpdatedAt) : NaN;
    const localTimestamp = cloudConversationUpdatedAt ? Date.parse(cloudConversationUpdatedAt) : NaN;
    if (
      remoteUpdatedAt === cloudConversationUpdatedAt ||
      (Number.isFinite(remoteTimestamp) && Number.isFinite(localTimestamp) && remoteTimestamp === localTimestamp)
    ) return;

    // Account saves write profile, preferences and conversation together. Read
    // those records as well so the other browser's whole persona catches up.
    const [profileResult, preferencesResult] = await Promise.all([
      supabase.from("synqme_profiles").select("*").eq("user_id", userIdAtStart).maybeSingle(),
      supabase.from("synqme_preferences")
        .select("id,category,preference_text,normalised_text,preference_status,explicit_facets,unresolved_fields,source_message,created_at,schema_version,clarifications")
        .eq("user_id", userIdAtStart)
        .order("created_at", { ascending: false })
        .limit(24)
    ]);
    if (profileResult.error) throw profileResult.error;
    if (preferencesResult.error) throw preferencesResult.error;
    if (userIdAtStart !== cloudUserId) return;

    const remoteMessages = Array.isArray(data.messages) ? data.messages : [];
    const mergedMessages = mergeConversationMessages(state.messages, remoteMessages);
    const localChanged = JSON.stringify(mergedMessages) !== JSON.stringify(state.messages);
    const mergedDiffersFromCloud = JSON.stringify(mergedMessages) !== JSON.stringify(remoteMessages);
    const pendingChanged = JSON.stringify(state.pendingClarification || null) !== JSON.stringify(data.pending_clarification || null);

    let profileChanged = false;
    let languageChanged = false;
    const remoteProfile = profileResult.data;
    if (remoteProfile) {
      const nextProfile = {
        ownerName: remoteProfile.owner_name || "",
        robotName: remoteProfile.future_robot_name || "",
        robotType: remoteProfile.future_robot_type || "Humanoid robot",
        robotVoice: remoteProfile.future_robot_voice || "female",
        preferredLanguage: remoteProfile.preferred_language || "en",
        confirmActions: Boolean(remoteProfile.confirm_actions)
      };
      languageChanged = nextProfile.preferredLanguage !== state.profile.preferredLanguage;
      profileChanged = JSON.stringify(nextProfile) !== JSON.stringify(state.profile);
      if (profileChanged) state.profile = nextProfile;
      const nextFunctions = Array.isArray(remoteProfile.domestic_functions)
        ? remoteProfile.domestic_functions.filter((id) => ACTIVITIES.some((activity) => activity.id === id))
        : [];
      if (JSON.stringify(nextFunctions) !== JSON.stringify(state.functions)) {
        state.functions = nextFunctions;
        profileChanged = true;
      }
    }

    const remotePreferenceRows = (preferencesResult.data || []).map((item) => ({
      id: item.id,
      text: item.preference_text,
      category: item.category,
      normalised: item.normalised_text,
      preference_status: item.preference_status,
      explicit_facets: item.explicit_facets,
      unresolved_fields: item.unresolved_fields,
      source_message: item.source_message,
      created_at: item.created_at,
      clarifications: item.clarifications
    }));
    const remotePreferences = mergePreferences(remotePreferenceRows, []);
    const preferencesChanged = JSON.stringify(remotePreferences) !== JSON.stringify(state.preferences);

    cloudConversationUpdatedAt = remoteUpdatedAt;
    if (localChanged) state.messages = mergedMessages;
    if (pendingChanged) state.pendingClarification = data.pending_clarification || null;
    if (preferencesChanged) state.preferences = remotePreferences;
    if (languageChanged) localizeWelcomeMessage(state.profile.preferredLanguage || "en");

    if (localChanged || pendingChanged || profileChanged || preferencesChanged) {
      persist(false);
      renderAll();
    }

    // If this device has messages not yet represented in the cloud snapshot,
    // merge them back after applying the incoming transcript.
    if (mergedDiffersFromCloud && !isSending) scheduleCloudSave(250);
  } catch (error) {
    console.info("SYNQ.ME could not refresh conversation history from the cloud.", error);
  } finally {
    cloudConversationRefreshInFlight = false;
  }
}

function stopCloudConversationSync() {
  if (cloudConversationRefreshTimer) window.clearInterval(cloudConversationRefreshTimer);
  cloudConversationRefreshTimer = null;
  if (cloudConversationRefreshTimeout) window.clearTimeout(cloudConversationRefreshTimeout);
  cloudConversationRefreshTimeout = null;

  if (cloudConversationChannel && supabase) {
    const channel = cloudConversationChannel;
    cloudConversationChannel = null;
    void supabase.removeChannel(channel).catch((error) => {
      console.info("SYNQ.ME conversation sync channel could not be removed cleanly.", error);
    });
  }
  cloudConversationUpdatedAt = null;
}

function startCloudConversationSync() {
  if (!supabase || !cloudUserId) return;
  stopCloudConversationSync();
  const userIdAtStart = cloudUserId;

  // Realtime delivers immediate updates when the account row changes. A
  // lightweight foreground poll covers browsers/networks that drop the socket.
  cloudConversationChannel = supabase
    .channel("synqme-conversation-sync-" + userIdAtStart)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "synqme_conversations",
      filter: "user_id=eq." + userIdAtStart
    }, () => scheduleCloudConversationRefresh(150))
    .subscribe((status) => {
      if (status === "SUBSCRIBED") scheduleCloudConversationRefresh(100);
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.info("SYNQ.ME live conversation notifications are unavailable; foreground polling remains enabled.");
      }
    });

  cloudConversationRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") void refreshCloudConversation();
  }, 5000);
  scheduleCloudConversationRefresh(250);
}

window.addEventListener("focus", () => scheduleCloudConversationRefresh(100));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleCloudConversationRefresh(100);
});

function snapshotAppState() {
  return {
    messages: state.messages.slice(-5000),
    preferences: state.preferences.slice(0, 24).map((item) => ({ ...item })),
    profile: { ...state.profile },
    functions: [...state.functions],
    pendingClarification: state.pendingClarification ? { ...state.pendingClarification } : null
  };
}

function savePendingAccountDraft(email) {
  try {
    localStorage.setItem(ACCOUNT_DRAFT_KEY, JSON.stringify({
      email: String(email || "").trim().toLowerCase(),
      savedAt: new Date().toISOString(),
      state: snapshotAppState()
    }));
  } catch (error) {
    console.info("SYNQ.ME could not stage browser data for account migration.", error);
  }
}

function readMatchingAccountDraft(email) {
  try {
    const draft = JSON.parse(localStorage.getItem(ACCOUNT_DRAFT_KEY) || "null");
    return draft && String(draft.email || "").trim().toLowerCase() === String(email || "").trim().toLowerCase()
      ? draft
      : null;
  } catch {
    return null;
  }
}

function stateFromSnapshot(snapshot) {
  const base = initialState();
  if (!snapshot || typeof snapshot !== "object") return base;
  const messages = Array.isArray(snapshot.messages)
    ? snapshot.messages
        .slice(-5000)
        .map(sanitiseConversationMessage)
        .filter(Boolean)
    : [];
  base.messages = messages.length ? messages : [{ role: "assistant", content: WELCOME }];
  base.preferences = Array.isArray(snapshot.preferences)
    ? snapshot.preferences.slice(0, 24).map((item) => typeof item === "string" ? cleanPreference(item) : cleanPreference(item?.text, item)).filter(Boolean)
    : [];
  base.profile = { ...defaultProfile(), ...(snapshot.profile && typeof snapshot.profile === "object" ? snapshot.profile : {}) };
  base.functions = Array.isArray(snapshot.functions)
    ? snapshot.functions.filter((id) => ACTIVITIES.some((activity) => activity.id === id))
    : [];
  base.pendingClarification = snapshot.pendingClarification && typeof snapshot.pendingClarification === "object"
    ? snapshot.pendingClarification
    : null;
  base.apiConnected = false;
  return base;
}

function mergeConversationMessages(...groups) {
  // Merge device snapshots without duplicating an older transcript that is
  // already present in a newer one. Repeated messages inside one transcript
  // are preserved; overlap is considered only between separate snapshots.
  let messages = [];
  const key = (item) => item.role + "\\n" + item.content;
  const sequenceIndex = (haystack, needle) => {
    if (!needle.length || needle.length > haystack.length) return -1;
    outer: for (let start = 0; start <= haystack.length - needle.length; start++) {
      for (let offset = 0; offset < needle.length; offset++) {
        if (key(haystack[start + offset]) !== key(needle[offset])) continue outer;
      }
      return start;
    }
    return -1;
  };

  for (const group of groups) {
    const incoming = (Array.isArray(group) ? group : [])
      .map(sanitiseConversationMessage)
      .filter((item) => item && item.content.trim())
      .map((item) => ({ role: item.role, content: item.content.trim() }));
    if (!incoming.length) continue;
    if (!messages.length) {
      messages = incoming;
      continue;
    }

    // If one complete snapshot is contained in the other, keep the superset.
    if (sequenceIndex(messages, incoming) >= 0) continue;
    if (sequenceIndex(incoming, messages) >= 0) {
      messages = incoming;
      continue;
    }

    // When both devices share opening history but diverge later, keep both tails
    // instead of duplicating all of their shared conversation.
    let commonPrefix = 0;
    while (
      commonPrefix < messages.length &&
      commonPrefix < incoming.length &&
      key(messages[commonPrefix]) === key(incoming[commonPrefix])
    ) commonPrefix++;
    if (commonPrefix > 0) {
      messages.push(...incoming.slice(commonPrefix));
      continue;
    }

    // Handle a suffix of the current transcript overlapping the incoming head.
    let overlap = Math.min(messages.length, incoming.length);
    while (overlap > 0) {
      let matches = true;
      for (let i = 0; i < overlap; i++) {
        if (key(messages[messages.length - overlap + i]) !== key(incoming[i])) {
          matches = false;
          break;
        }
      }
      if (matches) break;
      overlap--;
    }
    if (overlap > 0) {
      messages.push(...incoming.slice(overlap));
      continue;
    }

    // Handle an incoming suffix that overlaps the current transcript's head.
    let prefixOverlap = Math.min(messages.length, incoming.length);
    while (prefixOverlap > 0) {
      let matches = true;
      for (let i = 0; i < prefixOverlap; i++) {
        if (key(incoming[incoming.length - prefixOverlap + i]) !== key(messages[i])) {
          matches = false;
          break;
        }
      }
      if (matches) break;
      prefixOverlap--;
    }
    if (prefixOverlap > 0) {
      messages = [...incoming.slice(0, incoming.length - prefixOverlap), ...messages];
      continue;
    }

    messages.push(...incoming);
  }
  return (messages.length ? messages : [{ role: "assistant", content: WELCOME }]).slice(-5000);
}

function mergePreferences(remoteItems, draftItems) {
  const unique = new Map();
  for (const item of [...(Array.isArray(remoteItems) ? remoteItems : []), ...(Array.isArray(draftItems) ? draftItems : [])]) {
    const cleaned = cleanPreference(item?.text, item || {});
    if (!cleaned) continue;
    const normalised = String(item?.normalised || item?.normalised_text || cleaned.normalised).slice(0, 240);
    unique.set(normalised, {
      ...cleaned,
      category: item?.category || cleaned.category,
      normalised,
      status: item?.status || item?.preference_status || cleaned.status,
      explicitFacets: item?.explicitFacets || item?.explicit_facets || cleaned.explicitFacets,
      unresolvedFields: item?.unresolvedFields || item?.unresolved_fields || cleaned.unresolvedFields,
      sourceMessage: item?.sourceMessage || item?.source_message || cleaned.sourceMessage,
      recordedAt: item?.recordedAt || item?.created_at || cleaned.recordedAt,
      clarifications: item?.clarifications || cleaned.clarifications || []
    });
  }
  return [...unique.values()].slice(-24);
}

function setAuthGateVisible(visible) {
  if (elements.authGate) elements.authGate.hidden = !visible;
  document.body.classList.toggle("auth-required", Boolean(visible));
  if (visible) window.setTimeout(() => elements.authEmail?.focus(), 0);
}

function setAuthMode(mode, message = "") {
  authMode = mode;
  const isSignup = mode === "signup";
  const isRecovery = mode === "recovery";
  if (elements.authTitle) elements.authTitle.textContent = isRecovery
    ? "Choose a new password."
    : isSignup ? "Create your SYNQ.ME account." : "Your SecondSelf, saved.";
  if (elements.authDescription) elements.authDescription.textContent = isRecovery
    ? "Enter a new password for your SYNQ.ME account."
    : isSignup
      ? "Create an account to keep your profile, conversations and preferences together across devices."
      : "Sign in to continue building your personal digital persona. Your conversations and preferences will be saved to your account.";
  if (elements.authSubmit) elements.authSubmit.textContent = isRecovery ? "Save new password" : isSignup ? "Create account" : "Sign in";
  if (elements.authModeToggle) {
    elements.authModeToggle.hidden = isRecovery;
    elements.authModeToggle.textContent = isSignup ? "Already have an account? Sign in" : "New to SYNQ.ME? Create an account";
  }
  if (elements.authForgotPassword) elements.authForgotPassword.hidden = mode !== "signin";
  const hasLocalBrowserPersona = Boolean(
    state.preferences.length ||
    state.functions.length ||
    state.profile.ownerName.trim() ||
    state.profile.robotName.trim() ||
    state.messages.length > 1
  );
  if (elements.authImportDraftWrap) elements.authImportDraftWrap.hidden = isRecovery || !hasLocalBrowserPersona;
  if (elements.authEmail) {
    elements.authEmail.hidden = isRecovery;
    elements.authEmail.required = !isRecovery;
  }
  if (elements.authEmailLabel) elements.authEmailLabel.hidden = isRecovery;
  if (elements.authPasswordLabel) elements.authPasswordLabel.textContent = isRecovery ? "New password" : "Password";
  if (elements.authPassword) {
    elements.authPassword.autocomplete = isSignup || isRecovery ? "new-password" : "current-password";
    elements.authPassword.minLength = 8;
  }
  if (elements.authStatus) elements.authStatus.textContent = message;
}

function renderAccountStatus() {
  if (elements.accountStatusLabel) elements.accountStatusLabel.textContent = cloudUserId ? "SIGNED IN" : "SIGN IN REQUIRED";
  if (elements.accountEmail) elements.accountEmail.textContent = cloudUserEmail || "Sign in to synchronise your SecondSelf.";
}

async function loadSignedInAccount(session, { migrateDraft = true } = {}) {
  const user = session?.user;
  if (!user?.id || !user.email || user.is_anonymous) {
    cloudUserId = null;
    cloudUserEmail = "";
    cloudMode = "local";
    renderAccountStatus();
    setAuthGateVisible(true);
    return false;
  }

  const email = user.email.trim().toLowerCase();
  const draft = migrateDraft ? readMatchingAccountDraft(email) : null;
  const draftState = draft?.state ? stateFromSnapshot(draft.state) : null;
  const fallbackProfile = draftState?.profile || defaultProfile();
  const fallbackFunctions = draftState?.functions || [];
  cloudUserId = user.id;
  cloudUserEmail = user.email;

  const [profileResult, preferencesResult, conversationResult] = await Promise.all([
    supabase.from("synqme_profiles").select("*").eq("user_id", cloudUserId).maybeSingle(),
    supabase.from("synqme_preferences").select("id,category,preference_text,normalised_text,preference_status,explicit_facets,unresolved_fields,source_message,created_at,schema_version,clarifications").eq("user_id", cloudUserId).order("created_at", { ascending: false }).limit(24),
    supabase.from("synqme_conversations").select("messages,pending_clarification,updated_at").eq("user_id", cloudUserId).maybeSingle()
  ]);
  if (profileResult.error) throw profileResult.error;
  if (preferencesResult.error) throw preferencesResult.error;
  if (conversationResult.error) throw conversationResult.error;

  const remoteProfile = profileResult.data;
  const remotePreferences = (preferencesResult.data || []).map((item) => ({
    id: item.id,
    text: item.preference_text,
    category: item.category,
    normalised: item.normalised_text,
    preference_status: item.preference_status,
    explicit_facets: item.explicit_facets,
    unresolved_fields: item.unresolved_fields,
    source_message: item.source_message,
    created_at: item.created_at,
    clarifications: item.clarifications
  }));
  const remoteConversation = conversationResult.data;
  cloudConversationUpdatedAt = remoteConversation?.updated_at || null;
  state = draftState || initialState();

  if (remoteProfile) {
    state.profile = {
      ownerName: remoteProfile.owner_name || fallbackProfile.ownerName || "",
      robotName: remoteProfile.future_robot_name || fallbackProfile.robotName || "",
      robotType: remoteProfile.future_robot_type || fallbackProfile.robotType || "Humanoid robot",
      robotVoice: remoteProfile.future_robot_voice || fallbackProfile.robotVoice || "female",
      preferredLanguage: remoteProfile.preferred_language || fallbackProfile.preferredLanguage || "en",
      confirmActions: Boolean(remoteProfile.confirm_actions)
    };
    const remoteFunctions = Array.isArray(remoteProfile.domestic_functions)
      ? remoteProfile.domestic_functions.filter((id) => ACTIVITIES.some((activity) => activity.id === id))
      : [];
    state.functions = draftState
      ? [...new Set([...remoteFunctions, ...fallbackFunctions])]
      : remoteFunctions;
  } else {
    state.profile = { ...defaultProfile(), ...fallbackProfile };
    state.functions = [...fallbackFunctions];
  }

  state.preferences = mergePreferences(remotePreferences, draftState?.preferences || []);
  state.messages = mergeConversationMessages(remoteConversation?.messages || [], draftState?.messages || []);
  localizeWelcomeMessage(state.profile.preferredLanguage || "en");
  state.pendingClarification = remoteConversation?.pending_clarification || draftState?.pendingClarification || null;
  state.apiConnected = false;
  cloudMode = "syncing";
  renderAccountStatus();
  populateSettingsForm();
  renderAll();
  persist();
  if (cloudSaveTimer) window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = null;

  await saveCloudState();
  if (draft) {
    try { localStorage.removeItem(ACCOUNT_DRAFT_KEY); } catch {}
  }
  setAuthGateVisible(false);
  renderAccountStatus();
  renderAll();
  if (!profileComplete()) openSettings();
  else updateSettingsMode();
  startCloudConversationSync();
  void ensureLocalAIReady()
    .then(() => scheduleKokoroBackgroundPreload(1400))
    .catch((error) => console.info("SYNQ.ME local model warm-up did not complete.", error));
  return true;
}

async function initialiseCloudStorage() {
  if (!supabase) {
    cloudUserId = null;
    cloudUserEmail = "";
    cloudMode = "local";
    setAuthGateVisible(true);
    setAuthMode("signin", "Account storage is not configured yet. Please check the app’s Supabase connection settings.");
    renderAccountStatus();
    return;
  }
  try {
    if (authRecoveryInProgress) {
      setAuthGateVisible(true);
      setAuthMode("recovery", "Choose a new password to finish resetting your account.");
      return;
    }
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const session = sessionData.session;
    if (!session || !session.user || session.user.is_anonymous || !session.user.email) {
      cloudUserId = null;
      cloudUserEmail = "";
      cloudMode = "local";
      setAuthGateVisible(true);
      setAuthMode("signin", session?.user?.is_anonymous
        ? "Create an account or sign in to keep this persona, its preferences and future replies linked to you."
        : "");
      renderAccountStatus();
      return;
    }
    await loadSignedInAccount(session);
  } catch (error) {
    cloudUserId = null;
    cloudUserEmail = "";
    cloudMode = "local";
    setAuthGateVisible(true);
    setAuthMode("signin", "We couldn’t load your account data. Check your connection and try again.");
    renderAccountStatus();
    console.info("SYNQ.ME account storage could not be loaded.", error);
  }
}
function dismissSplash() {
  if (!elements.splash) return;
  window.setTimeout(() => elements.splash.classList.add("is-hidden"), 1000);
}
dismissSplash();

function profileComplete() {
  return Boolean(state.profile.ownerName && state.profile.ownerName.trim());
}

function updateSettingsMode() {
  const setupRequired = !profileComplete();
  document.body.classList.toggle("profile-setup-required", setupRequired);
  if (elements.settingsTitle) elements.settingsTitle.textContent = setupRequired ? "Set up your SecondSelf" : "Settings";
  if (elements.settingsIntro) {
    elements.settingsIntro.textContent = setupRequired
      ? "First, add your name to start. Naming your future robot is entirely optional."
      : "Make SYNQ.ME feel like yours. Your profile, preferences and conversation history are saved to your account.";
  }
  if (elements.profileSetupNotice) elements.profileSetupNotice.hidden = !setupRequired;
  if (elements.closeSettings) elements.closeSettings.hidden = setupRequired;
  if (elements.cancelSettings) elements.cancelSettings.hidden = setupRequired;
  if (elements.settingsBackdrop) {
    elements.settingsBackdrop.setAttribute("aria-label", setupRequired ? "Complete profile setup to continue" : "Close settings");
    elements.settingsBackdrop.style.cursor = setupRequired ? "default" : "pointer";
  }
  if (elements.settingsSaveButton) elements.settingsSaveButton.textContent = setupRequired ? "Save profile & continue" : "Save settings";
  if (elements.ownerName) elements.ownerName.required = true;
  if (elements.robotName) elements.robotName.required = false;
}

function openSettings() {
  lastFocusedElement = document.activeElement;
  elements.settingsDialog.hidden = false;
  document.body.classList.add("settings-open");
  updateSettingsMode();
  populateSettingsForm();
  renderSettingsDetails();
  window.setTimeout(() => {
    if (!profileComplete()) {
      if (!state.profile.ownerName.trim()) elements.ownerName?.focus();
      else elements.robotName?.focus();
    } else {
      elements.settingsSheet?.focus();
    }
  }, 0);
}

function closeSettings() {
  if (!profileComplete()) {
    updateSettingsMode();
    elements.settingsDialog.hidden = false;
    if (elements.profileSetupNotice) {
      elements.profileSetupNotice.textContent = "Please enter both your name and your future robot’s name to begin. You can change the other settings later.";
      elements.profileSetupNotice.hidden = false;
    }
    if (!state.profile.ownerName.trim()) elements.ownerName?.focus();
    else elements.robotName?.focus();
    return;
  }
  elements.settingsDialog.hidden = true;
  document.body.classList.remove("settings-open");
  updateSettingsMode();
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") lastFocusedElement.focus();
}
elements.openSettings?.addEventListener("click", openSettings);
elements.openPersonaFromSummary?.addEventListener("click", openSettings);
elements.settingsBackdrop?.addEventListener("click", closeSettings);
elements.closeSettings?.addEventListener("click", closeSettings);
elements.cancelSettings?.addEventListener("click", closeSettings);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.settingsDialog && !elements.settingsDialog.hidden) closeSettings();
});

function populateSettingsForm() {
  elements.ownerName.value = state.profile.ownerName || "";
  elements.robotName.value = state.profile.robotName || "";
  elements.robotType.value = state.profile.robotType || "Humanoid robot";
  const voiceField = document.querySelector("#robotVoice");
  if (voiceField) voiceField.value = state.profile.robotVoice || "female";
  if (elements.preferredLanguage) elements.preferredLanguage.value = state.profile.preferredLanguage || "en";
  elements.confirmActions.checked = Boolean(state.profile.confirmActions);
  elements.functionGrid.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = state.functions.includes(checkbox.value);
  });
}
elements.settingsForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const ownerName = elements.ownerName.value.trim().slice(0, 60);
  const robotName = elements.robotName.value.trim().slice(0, 60);
  if (!ownerName) {
    if (elements.profileSetupNotice) {
      elements.profileSetupNotice.textContent = "Your name is required before you can start. A robot name is optional.";
      elements.profileSetupNotice.hidden = false;
    }
    elements.ownerName.focus();
    return;
  }
  state.profile = {
    ownerName,
    robotName,
    robotType: elements.robotType.value || "Humanoid robot",
    robotVoice: document.querySelector("#robotVoice")?.value || "female",
    preferredLanguage: elements.preferredLanguage?.value || "en",
    confirmActions: Boolean(elements.confirmActions.checked)
  };
  localizeWelcomeMessage(state.profile.preferredLanguage);
  persist();
  renderAll();
  const savedToAccount = await flushCloudSave();
  updateSettingsMode();
  closeSettings();
  elements.conversationStatus.textContent = savedToAccount
    ? "Your profile is ready · saved to account"
    : "Your profile is updated locally; account sync needs attention";
});

elements.functionGrid?.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
  checkbox.addEventListener("change", async () => {
    const selected = new Set(state.functions);
    if (checkbox.checked) selected.add(checkbox.value);
    else selected.delete(checkbox.value);
    state.functions = [...selected];
    persist();
    renderAll();
    await flushCloudSave();
    renderAll();
  });
});

elements.toggleAllFunctions?.addEventListener("click", async () => {
  const allSelected = ACTIVITIES.every((activity) => state.functions.includes(activity.id));
  state.functions = allSelected ? [] : ACTIVITIES.map((activity) => activity.id);
  elements.functionGrid?.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = state.functions.includes(checkbox.value);
  });
  persist();
  renderAll();
  const saved = await flushCloudSave();
  renderAll();
  if (elements.conversationStatus) {
    elements.conversationStatus.textContent = saved
      ? "Domestic functions updated · saved to account"
      : "Domestic functions updated · account sync needs attention";
  }
});

 elements.exportPexiPackage?.addEventListener("click", exportPexiPersonaPackage);

elements.openTaskFromSettings?.addEventListener("click", () => {
  closeSettings();
  elements.taskResult.hidden = false;
  elements.taskResult.scrollIntoView({ behavior: "smooth", block: "start" });
});

function selectedCompanionDisplayName() {
  const configuredName = (state.profile.robotName || "").trim();
  if (configuredName) return configuredName;
  if (robotAppearance.customImageData) return "Your robot";
  return (ROBOT_OPTIONS.find((item) => item.id === robotAppearance.robotId) || ROBOT_OPTIONS[0]).name;
}

function updateVoiceCompanionLabels() {
  const companionName = selectedCompanionDisplayName();
  if (elements.voiceExperienceTitle) elements.voiceExperienceTitle.textContent = "Talk to " + companionName + ".";
  if (elements.voiceCompanionName) elements.voiceCompanionName.textContent = companionName;
  if (elements.voiceIntroCopy) elements.voiceIntroCopy.textContent = "Speak naturally. " + companionName + " is listening.";
}

function renderOwnerAvatarPreview() {
  if (!elements.ownerAvatarPreview) return;
  elements.ownerAvatarPreview.replaceChildren();
  if (ownerAvatarData) {
    const image = document.createElement("img");
    image.src = ownerAvatarData;
    image.alt = "";
    elements.ownerAvatarPreview.append(image);
    elements.ownerAvatarPreview.classList.add("has-photo");
  } else {
    const initial = (elements.ownerName?.value || state.profile.ownerName || "").trim().charAt(0).toUpperCase() || "Y";
    const fallback = document.createElement("span");
    fallback.setAttribute("aria-hidden", "true");
    fallback.textContent = initial;
    elements.ownerAvatarPreview.append(fallback);
    elements.ownerAvatarPreview.classList.remove("has-photo");
  }
  if (elements.removeOwnerImageButton) elements.removeOwnerImageButton.hidden = !ownerAvatarData;
  if (elements.uploadOwnerImageButton) {
    const label = elements.uploadOwnerImageButton.querySelector("span");
    if (label) label.textContent = ownerAvatarData ? "Change your photo" : "Upload your photo";
  }
}

function saveOwnerAvatar() {
  try {
    if (ownerAvatarData) localStorage.setItem(OWNER_AVATAR_KEY, ownerAvatarData);
    else localStorage.removeItem(OWNER_AVATAR_KEY);
  } catch {
    if (elements.voiceStatus) elements.voiceStatus.textContent = "Photo selected for this session only; browser storage is full.";
  }
}

function handleOwnerImageUpload(file) {
  if (!file || !file.type || !file.type.startsWith("image/")) return;
  if (file.size > 8 * 1024 * 1024) {
    window.alert("Choose a profile image smaller than 8 MB.");
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => window.alert("That image could not be opened. Choose another file.");
  reader.onload = () => {
    const image = new Image();
    image.onerror = () => window.alert("That image could not be opened. Choose another file.");
    image.onload = () => {
      const maxSide = 512;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        window.alert("This browser could not process the profile image.");
        return;
      }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      try {
        ownerAvatarData = canvas.toDataURL("image/jpeg", 0.82);
        saveOwnerAvatar();
        renderOwnerAvatarPreview();
        renderMessages();
      } catch {
        window.alert("The profile image could not be processed. Try a smaller image.");
      }
    };
    image.src = String(reader.result || "");
  };
  reader.readAsDataURL(file);
}

function appendMessage(role, content) {
  const article = document.createElement("article");
  article.className = "message " + (role === "user" ? "user-message" : "assistant-message");
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  if (role === "user") {
    if (ownerAvatarData) {
      avatar.classList.add("owner-message-avatar");
      avatar.setAttribute("aria-hidden", "true");
      const image = document.createElement("img");
      image.className = "message-owner-image";
      image.src = ownerAvatarData;
      image.alt = "";
      avatar.append(image);
    } else {
      avatar.textContent = state.profile.ownerName.trim().charAt(0).toUpperCase() || "Y";
    }
  } else {
    avatar.classList.add("robot-message-avatar");
    avatar.setAttribute("aria-hidden", "true");
    if (robotAppearance.customImageData) {
      const image = document.createElement("img");
      image.className = "message-robot-image";
      image.src = robotAppearance.customImageData;
      image.alt = "";
      avatar.append(image);
    } else {
      avatar.innerHTML = robotSvgMarkup(robotAppearance.robotId);
    }
  }
  const body = document.createElement("div");
  body.className = "message-body";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = role === "user"
    ? (state.profile.ownerName.trim().toUpperCase() || "YOU")
    : "SYNQ.ME";
  const paragraph = document.createElement("p");
  paragraph.textContent = content;
  body.append(meta, paragraph);
  article.append(avatar, body);
  elements.chatMessages.append(article);
}

function updateChatScrollbar() {
  const messages = elements.chatMessages;
  const shell = elements.chatTranscriptShell;
  const track = elements.chatScrollbarTrack;
  const thumb = elements.chatScrollbarThumb;
  if (!messages || !shell || !track || !thumb) return;

  // Measure the full track even when it was hidden on the previous frame.
  track.hidden = false;
  const trackHeight = track.clientHeight || Math.max(0, shell.clientHeight - 20);
  const viewportHeight = messages.clientHeight;
  const contentHeight = messages.scrollHeight;

  if (!viewportHeight || !trackHeight || contentHeight <= viewportHeight + 4) {
    track.hidden = true;
    return;
  }

  const thumbHeight = Math.min(trackHeight, Math.max(22, trackHeight * viewportHeight / contentHeight));
  const maximumTop = Math.max(0, trackHeight - thumbHeight);
  const maximumScroll = Math.max(1, contentHeight - viewportHeight);
  const scrollRatio = Math.min(1, Math.max(0, messages.scrollTop / maximumScroll));
  thumb.style.height = thumbHeight + "px";
  thumb.style.transform = "translateY(" + (maximumTop * scrollRatio) + "px)";
  track.hidden = false;
}

function renderMessages() {
  elements.chatMessages.replaceChildren();
  // Render in conversation order so newer turns naturally appear at the bottom.
  state.messages.slice(-50).forEach((message) => appendMessage(message.role, message.content));
  window.requestAnimationFrame(() => {
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    updateChatScrollbar();
  });
}

elements.chatMessages?.addEventListener("scroll", updateChatScrollbar, { passive: true });
window.addEventListener("resize", updateChatScrollbar);

function classifyPreference(message) {
  const text = message.toLowerCase();
  if (/glass|fragile|delicate|mug|cup|top rack|upper rack/.test(text)) return "Care & placement";
  if (/ask me|ask before|confirm|permission|before start|before starting|check with me/.test(text)) return "Consent & boundaries";
  if (/knife|knives|sharp|cutlery|safety|safe/.test(text)) return "Safety";
  if (/quiet|noise|morning|evening|schedule|routine|time|when/.test(text)) return "Routine & timing";
  if (/laundry|wash|dry|fold|clothes|clothing|fabric|temperature/.test(text)) return "Laundry & clothing";
  if (/vacuum|floor|carpet|clean|tidy|wipe|counter|surface|order/.test(text)) return "Cleaning & organisation";
  if (/cook|meal|food|recipe|ingredient|spicy|vegetarian|grocery|shopping/.test(text)) return "Food & shopping";
  if (/pet|dog|cat|plant|water|garden/.test(text)) return "Home & care";
  return "Personal preference";
}

function splitPreferenceStatements(message) {
  const sentences = String(message || "")
    .replace(/[\r\n]+/g, ";")
    .split(/[.;!?]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const output = [];
  const directive = /(?:please\s+)?(?:keep|put|place|leave|ask|always|never|make|use|wash|sort|separate|fold|start|finish|avoid|ensure|prefer|move|store|hang|dry|clean|vacuum|wipe|cook|prepare|feed|water|take|I\s+(?:want|prefer|like|need)|I\s+don['’]t|do\s+not|the\s+robot\s+should|it\s+should|make\s+sure)\b/i;
  for (const sentence of sentences) {
    const clauses = sentence.split(/\s+(?:and|also|plus)\s+(?=(?:please\s+)?(?:keep|put|place|leave|ask|always|never|make|use|wash|sort|separate|fold|start|finish|avoid|ensure|prefer|move|store|hang|dry|clean|vacuum|wipe|cook|prepare|feed|water|take|I\s+(?:want|prefer|like|need)|I\s+don['’]t|do\s+not|the\s+robot\s+should|it\s+should)\b)/i);
    for (const clause of clauses) {
      const commaClauses = clause.split(/,\s+(?=(?:please\s+)?(?:keep|put|place|leave|ask|always|never|make|use|wash|sort|separate|fold|start|finish|avoid|ensure|prefer|move|store|hang|dry|clean|vacuum|wipe|cook|prepare|feed|water|take|I\s+(?:want|prefer|like|need)|do\s+not)\b)/i);
      for (const item of commaClauses) {
        const clean = item.trim().replace(/^and\s+/i, "");
        if (clean.length > 3) output.push(clean);
      }
    }
  }
  if (output.length <= 1 && message.length > 100 && !directive.test(message)) return [message.trim()];
  return output.length ? output : [message.trim()];
}

function extractExplicitPreferenceFacets(text) {
  const lower = String(text || "").toLowerCase();
  const facets = {};
  const unresolvedFields = [];

  if (/\bkitchen\b/.test(lower)) facets.room = "kitchen";
  if (/\b(bathroom|bathrooms|bedroom|bedrooms|living room|living rooms|hallway|hallways)\b/.test(lower)) {
    const rooms = lower.match(/\b(kitchen|bathrooms?|bedrooms?|living rooms?|hallways?)\b/g);
    if (rooms) facets.rooms = [...new Set(rooms)];
  }
  if (/\b(twice|two times|2 times)\s+(a|per)\s+day\b|\b(two|2) times daily\b/.test(lower)) facets.frequency = { count: 2, unit: "per_day" };
  else if (/\bonce\s+(a|per)\s+day\b|\bdaily\b|\bevery day\b/.test(lower)) facets.frequency = { count: 1, unit: "per_day" };
  else if (/\bthree times\s+(a|per)\s+day\b|\bthree times daily\b/.test(lower)) facets.frequency = { count: 3, unit: "per_day" };

  const times = [];
  if (/\bmorning\b/.test(lower)) times.push("morning");
  if (/\bafternoon\b/.test(lower)) times.push("afternoon");
  if (/\bevening\b/.test(lower)) times.push("evening");
  if (times.length) facets.timeOfDay = times;
  if (facets.frequency && facets.frequency.count > 1 && !facets.timeOfDay) unresolvedFields.push("preferred_times");

  if (/surfaces?.{0,40}\bbefore\b.{0,30}\bfloors?\b|\bfloors?.{0,40}\bafter\b.{0,30}\bsurfaces?\b/.test(lower)) {
    facets.taskOrder = ["surface_cleaning", "floor_cleaning"];
  }
  if (/\bpaper towels?\b/.test(lower)) facets.cleaningSupplies = [...(facets.cleaningSupplies || []), { type: "paper_towels", detail: "explicitly requested" }];
  if (/\bspray\b/.test(lower) && /\b(show you|show me|particular|specific|later|when i)\b/.test(lower)) {
    facets.cleaningSupplies = [...(facets.cleaningSupplies || []), { type: "spray", identity: "to_be_provided_by_user" }];
    unresolvedFields.push("specific_cleaning_spray");
  } else if (/\bspray\b/.test(lower)) {
    facets.cleaningSupplies = [...(facets.cleaningSupplies || []), { type: "spray", detail: "spray mentioned; exact product unspecified" }];
    unresolvedFields.push("specific_cleaning_spray");
  }
  if (/\b(ask me before|ask before|check with me before|confirm with me|my permission|without asking me)\b/.test(lower)) {
    facets.approvalBoundary = "ask_before_action";
  }
  if (/\bnever\b/.test(lower)) facets.negativeConstraint = "explicit_never_statement";
  if (/\b(?:don't|do not|must not|never)\b/.test(lower) && /\bmove|touch|use|throw away|discard|change\b/.test(lower)) {
    facets.preserveOrAvoid = "explicit_user_constraint";
  }
  if (/(paper towels?|spray|cleaning product|surface cleaner)/i.test(lower) && !facets.room && !/(all surfaces|every surface|all rooms)/i.test(lower)) unresolvedFields.push("scope");
  if (/(show you|show me|tell you later|provide it later|when i arrive|when you arrive)/i.test(text) && unresolvedFields.length === 0) {
    unresolvedFields.push("detail_promised_for_later");
  }
  return { explicitFacets: facets, unresolvedFields: [...new Set(unresolvedFields)] };
}

function savePreference(message) {
  const statements = splitPreferenceStatements(message);
  for (const statement of statements) {
    const preference = cleanPreference(statement);
    if (!preference) continue;
    const extracted = extractExplicitPreferenceFacets(statement);
    preference.explicitFacets = extracted.explicitFacets;
    preference.unresolvedFields = extracted.unresolvedFields;
    preference.sourceMessage = message;
    preference.clarifications = [];
    const exists = state.preferences.some((item) => (item.normalised || item.text.toLowerCase()) === preference.normalised);
    if (exists) continue;
    state.preferences.unshift(preference);
  }
  state.preferences = state.preferences.slice(0, 24);
}



function findOrCreateLaundryPreference(contextMessage = "", answer = "") {
  const normalise = (value) => String(value || "").trim().toLowerCase().replace(/\\s+/g, " ");
  const context = String(contextMessage || "").trim();
  const contextKey = normalise(context);
  const answerKey = normalise(answer);
  const candidates = state.preferences.filter((item) =>
    normalise(item.text) !== answerKey &&
    (/(laundry|washing|clothes|fold)/i.test(item.text) || /laundry/i.test(item.category))
  );
  if (contextKey) {
    const exactSource = candidates.find((item) => normalise(item.sourceMessage) === contextKey);
    if (exactSource) return exactSource;
    const exactText = candidates.find((item) => normalise(item.text) === contextKey);
    if (exactText) return exactText;
  }
  if (candidates.length) return candidates[0];

  // In some turns the assistant asks a useful follow-up even though the
  // original user wording was not classified as a saved preference. Create
  // a source-linked record so a short answer such as "washing" has a parent.
  if (!context || /^(washing|wash|sorting|sort|folding|fold|yes|no|okay|ok)$/i.test(context)) return null;
  const preference = cleanPreference(context, {
    category: "Laundry & clothing",
    sourceMessage: context
  });
  if (!preference) return null;
  const extracted = extractExplicitPreferenceFacets(context);
  preference.category = "Laundry & clothing";
  preference.explicitFacets = { ...extracted.explicitFacets };
  preference.unresolvedFields = [...new Set([...extracted.unresolvedFields, "laundry_detail"])];
  preference.sourceMessage = context;
  preference.clarifications = [];
  state.preferences.unshift(preference);
  state.preferences = state.preferences.slice(0, 24);
  return preference;
}

function detectPendingClarification(userMessage, reply) {
  const response = String(reply || "").toLowerCase();
  const latest = String(userMessage || "").toLowerCase();

  const asksLaundryDetail = /(which laundry detail matters most|sorting, washing and drying|how clothes are put away)/i.test(response);
  const isShortLaundryChoice = /^(washing|wash|washing and drying|wash and dry|laundering|cleaning clothes|sorting|sort|separating|separate clothes|sorting clothes|put(ting)? clothes away|clothes are put away|put away|folding|fold clothes|hanging|hang clothes|storage)$/i.test(latest.trim());
  if (asksLaundryDetail && !isShortLaundryChoice) {
    const target = findOrCreateLaundryPreference(userMessage);
    if (target) return { type: "laundry_detail", field: "laundry_detail", preferenceId: target.id };
  }

  const mentionsSupplies = /(paper towels?|spray|cleaning product|surface cleaner|cleaning supplies)/i.test(latest);
  const asksSupplyScope = /(all surface cleaning|all surfaces|every surface|just the kitchen|kitchen only|which rooms.*(clean|surface)|supplies.*(apply|use|scope))/i.test(response);
  if (mentionsSupplies && asksSupplyScope) {
    const target = state.preferences.find((item) =>
      item.explicitFacets?.cleaningSupplies?.length || /(paper towels?|spray|cleaning product)/i.test(item.text)
    );
    if (target) return { type: "supply_scope", field: "scope", preferenceId: target.id };
  }

  const asksCleaningTime = /(morning and evening|two other times|what time of day|which times|when should.*clean)/i.test(response);
  if (asksCleaningTime && /(twice|two times|2 times|two a day|2 a day|daily)/i.test(latest)) {
    const target = state.preferences.find((item) =>
      item.explicitFacets?.frequency?.count > 1 || /(twice|two times|2 times|two a day|2 a day)/i.test(item.text)
    );
    if (target) return { type: "cleaning_times", field: "preferred_times", preferenceId: target.id };
  }

  const asksApprovalScope = /(should asking first apply|every household task|every proposed action|moving and putting things away|all household actions)/i.test(response);
  if (asksApprovalScope && /(ask me before|ask before|permission|confirm before|without asking)/i.test(latest)) {
    const target = state.preferences.find((item) =>
      item.category === "Consent & boundaries" || item.explicitFacets?.approvalBoundary
    );
    if (target) return { type: "approval_scope", field: "approval_scope", preferenceId: target.id };
  }
  return null;
}

function resolvePendingClarification(message) {
  const pending = state.pendingClarification;
  if (!pending) return false;
  const preference = state.preferences.find((item) => item.id === pending.preferenceId);
  if (!preference) {
    state.pendingClarification = null;
    return false;
  }

  const answer = String(message || "").trim();
  const lower = answer.toLowerCase();
  let clarificationValue = null;
  preference.explicitFacets = { ...(preference.explicitFacets || {}) };
  let resolvedField = pending.field;

  if (pending.type === "laundry_detail") {
    if (/^(washing|wash|washing and drying|wash and dry|laundering|cleaning clothes)$/i.test(lower)) {
      preference.explicitFacets.laundryDetail = "washing_and_drying";
      clarificationValue = "washing_and_drying";
    } else if (/^(sorting|sort|separating|separate clothes|sorting clothes)$/i.test(lower)) {
      preference.explicitFacets.laundryDetail = "sorting";
      clarificationValue = "sorting";
    } else if (/(put(ting)? clothes away|clothes are put away|put away|folding|fold clothes|hanging|hang clothes|storage)/i.test(lower)) {
      preference.explicitFacets.laundryDetail = "putting_clothes_away";
      clarificationValue = "putting_clothes_away";
    } else {
      return false;
    }
  } else if (pending.type === "supply_scope") {
    if (/(just (the )?kitchen|kitchen only|only (in )?the kitchen|kitchen surfaces only)/i.test(lower)) {
      preference.explicitFacets.room = "kitchen";
      preference.explicitFacets.scope = "kitchen_surface_cleaning";
      clarificationValue = "kitchen_surface_cleaning";
    } else if (/(all surfaces|all surface cleaning|every surface|throughout the house|all rooms)/i.test(lower)) {
      preference.explicitFacets.scope = "all_surface_cleaning";
      clarificationValue = "all_surface_cleaning";
    } else {
      state.pendingClarification = null;
      return false;
    }
  } else if (pending.type === "cleaning_times") {
    const times = [];
    if (/\bmorning\b/i.test(lower)) times.push("morning");
    if (/\bafternoon\b/i.test(lower)) times.push("afternoon");
    if (/\bevening\b/i.test(lower)) times.push("evening");
    if (times.length) {
      preference.explicitFacets.timeOfDay = [...new Set(times)];
      clarificationValue = preference.explicitFacets.timeOfDay;
    } else {
      const clockTimes = lower.match(/\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s?(?:am|pm)\b/g);
      if (clockTimes && clockTimes.length) {
        preference.explicitFacets.clockTimes = [...new Set(clockTimes)];
        clarificationValue = preference.explicitFacets.clockTimes;
      } else {
        state.pendingClarification = null;
        return false;
      }
    }
  } else if (pending.type === "approval_scope") {
    if (/(every household task|every action|all actions|anything in my home|always ask|all the time)/i.test(lower)) {
      preference.explicitFacets.approvalBoundary = "ask_before_every_household_action";
      clarificationValue = "ask_before_every_household_action";
    } else if (/(moving|putting things away|moving or storing|handling items|rearranging)/i.test(lower)) {
      preference.explicitFacets.approvalBoundary = "ask_before_moving_or_handling_items";
      clarificationValue = "ask_before_moving_or_handling_items";
    } else {
      state.pendingClarification = null;
      return false;
    }
  }

  if (clarificationValue === null) {
    state.pendingClarification = null;
    return false;
  }

  preference.clarifications = Array.isArray(preference.clarifications) ? preference.clarifications : [];
  preference.clarifications.push({
    field: resolvedField,
    value: clarificationValue,
    answer,
    status: "user_confirmed",
    recordedAt: new Date().toISOString()
  });
  preference.unresolvedFields = (Array.isArray(preference.unresolvedFields) ? preference.unresolvedFields : [])
    .filter((field) => field !== resolvedField);
  preference.status = "user_stated";
  state.pendingClarification = null;
  return true;
}


function replyToResolvedClarification(answer, pending) {
  const lower = String(answer || "").trim().toLowerCase();
  const preference = state.preferences.find((item) => item.id === pending?.preferenceId);

  if (pending?.type === "laundry_detail") {
    if (preference?.explicitFacets?.laundryDetail === "washing_and_drying") {
      return "Got it — washing and drying. Do you prefer clothes to be air-dried, tumble-dried, or handled differently depending on the garment?";
    }
    if (preference?.explicitFacets?.laundryDetail === "sorting") {
      return "Got it — sorting. Do you prefer clothes separated by colour, fabric, or washing temperature?";
    }
    if (preference?.explicitFacets?.laundryDetail === "putting_clothes_away") {
      return "Got it — putting clothes away. Would you prefer items folded, hung up, or handled differently depending on the garment?";
    }
    return "Got it — I’ve recorded your laundry preference. Is there anything you’d like handled differently for delicate items?";
  }

  if (pending?.type === "supply_scope") {
    const scopeLabel = /(just (the )?kitchen|kitchen only|only (in )?the kitchen|kitchen surfaces only)/i.test(lower)
      ? "just the kitchen"
      : "all surface cleaning";
    const sprayStillUnspecified = (preference?.unresolvedFields || []).includes("specific_cleaning_spray");
    const sprayNote = sprayStillUnspecified ? " I’ll leave the spray itself unspecified until you show it to me." : "";
    return "Got it — " + scopeLabel + ". I’ve recorded that scope for those cleaning supplies." + sprayNote;
  }

  if (pending?.type === "cleaning_times") {
    const times = ["morning", "afternoon", "evening"].filter((time) => new RegExp("\\b" + time + "\\b", "i").test(lower));
    const timeLabel = times.length ? times.join(" and ") : String(answer || "").trim();
    return "Got it — I’ll record " + timeLabel + " as your preferred cleaning times.";
  }

  if (pending?.type === "approval_scope") {
    if (/(every household task|every action|all actions|anything in my home|always ask|all the time)/i.test(lower)) {
      return "Got it — I’ll record that I should ask before every household action.";
    }
    return "Got it — I’ll record that I should ask before moving or handling items.";
  }

  return "Got it — I’ve recorded that clarification. What is one practical detail that would help me respect that preference?";
}

function addElement(parent, className, text) {
  const element = document.createElement("div");
  element.className = className;
  if (text !== undefined) element.textContent = text;
  parent.append(element);
  return element;
}

function renderPreferences() {
  const count = state.preferences.length;
  elements.memoryCount.textContent = count + (count === 1 ? " MEMORY" : " MEMORIES");
  elements.preferenceCount.textContent = String(count);
  elements.personaProgress.style.width = Math.min(100, count * 12.5) + "%";
  elements.foundationValue.textContent = count === 0
    ? "Waiting for your first preference"
    : count === 1
      ? "First preference captured"
      : count < 5
        ? "Your preferences are taking shape"
        : "A richer personal pattern is emerging";
  $(".memory-pulse")?.classList.toggle("active", count > 0);
  elements.memoryFootnote.textContent = cloudMode === "cloud"
    ? "Saved to your account · " + count + (count === 1 ? " preference" : " preferences") + " and conversation history sync automatically"
    : cloudMode === "error"
      ? "Account sync needs attention. Keep this tab open and check your connection."
      : count === 0
        ? "Sign in to save your SecondSelf to your account"
        : "Account not connected · " + count + (count === 1 ? " preference" : " preferences") + " currently in this browser";

  elements.preferenceList.replaceChildren();
  if (!count) {
    const empty = document.createElement("div");
    empty.className = "empty-memory";
    const icon = addElement(empty, "empty-memory-icon", "+");
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = "Your persona starts here";
    const description = document.createElement("p");
    description.textContent = "Share a preference in the conversation. SYNQ.ME will add it to your SecondSelf.";
    copy.append(title, description);
    empty.append(icon, copy);
    elements.preferenceList.append(empty);
  } else {
    state.preferences.forEach((preference, index) => {
      const item = document.createElement("div");
      item.className = "preference-item";
      addElement(item, "preference-number", String(index + 1).padStart(2, "0"));
      const copy = document.createElement("div");
      copy.className = "preference-copy";
      addElement(copy, "preference-category", preference.category || classifyPreference(preference.text));
      addElement(copy, "preference-text", preference.text);
      item.append(copy);
      elements.preferenceList.append(item);
    });
  }

  if (elements.settingsPreferenceCount) elements.settingsPreferenceCount.textContent = String(count);
  if (elements.settingsPreferenceList) {
    elements.settingsPreferenceList.replaceChildren();
    if (!count) {
      const p = document.createElement("p");
      p.className = "settings-empty";
      p.textContent = "As you chat with ELO, your preferences will appear here.";
      elements.settingsPreferenceList.append(p);
    } else {
      state.preferences.slice(0, 8).forEach((preference) => {
        const item = document.createElement("div");
        item.className = "settings-preference";
        item.textContent = preference.text;
        elements.settingsPreferenceList.append(item);
      });
      if (count > 8) {
        const p = document.createElement("p");
        p.className = "settings-empty";
        p.textContent = "+" + (count - 8) + " more stored preferences";
        elements.settingsPreferenceList.append(p);
      }
    }
  }
}

function milestoneUnlocked(milestone) {
  return Boolean(milestone.unlocked(state));
}

function renderPexiReadiness() {
  const count = state.preferences.length;
  const unresolved = state.preferences.reduce((sum, item) => {
    return sum + preferenceExtraction(item).unresolvedFields.length;
  }, 0);
  if (elements.pexiReadinessStatus) {
    elements.pexiReadinessStatus.textContent = unresolved
      ? unresolved + (unresolved === 1 ? " OPEN DETAIL" : " OPEN DETAILS")
      : count ? "READY FOR MAPPING" : "NOT STARTED";
  }
  if (elements.pexiReadinessSummary) {
    elements.pexiReadinessSummary.textContent = !count
      ? "As you share preferences, SYNQ.ME will separate what you stated from details that still need clarification. PEXI mapping remains a later compatibility step."
      : unresolved
        ? count + (count === 1 ? " stated preference" : " stated preferences") + " recorded. " + unresolved + (unresolved === 1 ? " detail still" : " details still") + " need clarification before the profile can be fully mapped for PEXI."
        : count + (count === 1 ? " stated preference" : " stated preferences") + " recorded. The package can be exported for PEXI mapping, but target-robot capability and safety checks are still required.";
  }
}

function renderMilestones() {
  const unlockedCount = MILESTONES.filter(milestoneUnlocked).length;
  if (elements.milestoneCount) elements.milestoneCount.textContent = unlockedCount + " OF " + MILESTONES.length;
  if (!elements.milestoneList) return;
  elements.milestoneList.replaceChildren();
  MILESTONES.forEach((milestone, index) => {
    const unlocked = milestoneUnlocked(milestone);
    const row = document.createElement("div");
    row.className = "milestone" + (unlocked ? " is-unlocked" : "");
    const icon = addElement(row, "milestone-icon", unlocked ? "✓" : "◇");
    const copy = document.createElement("div");
    copy.className = "milestone-copy";
    addElement(copy, "milestone-title", milestone.title).style.cssText = "display:block;color:#e0e6ef;font-size:10px;font-weight:600";
    addElement(copy, "milestone-reward", milestone.reward).style.cssText = "display:inline-block;margin-top:4px;padding:2px 6px;border:1px solid #36475c;border-radius:3px;color:#a7c5ed;font-size:7px;letter-spacing:.3px";
    addElement(copy, "milestone-description", milestone.description).style.cssText = "display:block;margin-top:5px;color:#8792a1;font-family:system-ui,sans-serif;font-size:9px;line-height:1.5";
    row.append(copy);
    addElement(row, "milestone-status", unlocked ? "UNLOCKED" : "IN PROGRESS");
    elements.milestoneList.append(row);
  });
}

function renderSettingsDetails() {
  elements.functionCount.textContent = state.functions.length + " SELECTED";
  if (elements.toggleAllFunctions) {
    const allSelected = ACTIVITIES.every((activity) => state.functions.includes(activity.id));
    elements.toggleAllFunctions.textContent = allSelected ? "Deselect all" : "Select all";
    elements.toggleAllFunctions.setAttribute("aria-pressed", String(allSelected));
  }
  renderMilestones();
}

function updateDecisionSummary() {
  const preferences = state.preferences;
  if (!preferences.length && !state.functions.length) {
    elements.decisionSummary.textContent = "Choose the home activities that matter to you, then share preferences with ELO. Your SecondSelf grows one step at a time.";
    elements.amyaState.textContent = "Getting started";
    elements.pexiState.textContent = "Not connected";
    elements.amyaState.classList.remove("ready");
    elements.pexiState.classList.remove("ready");
    return;
  }
  elements.decisionSummary.textContent = "Your persona includes " + preferences.length + (preferences.length === 1 ? " saved preference" : " saved preferences") + " across " + state.functions.length + (state.functions.length === 1 ? " selected domestic function" : " selected domestic functions") + ". Keep going to unlock personalisation milestones.";
  elements.amyaState.textContent = "Building context";
  elements.pexiState.textContent = "Future use";
  elements.amyaState.classList.add("ready");
  elements.pexiState.classList.remove("ready");
}

function renderAll() {
  renderMessages();
  renderOwnerAvatarPreview();
  renderPreferences();
  updateDecisionSummary();
  renderSettingsDetails();
  renderPexiReadiness();

  const name = state.profile.ownerName.trim();
  const robotName = state.profile.robotName.trim();
  const companionName = robotName || "your companion";
  if (elements.companionName) elements.companionName.textContent = companionName;
  if (elements.messageInput) elements.messageInput.placeholder = "Tell SYNQ.ME how you like things done...";
  if (elements.mobileOwnerTitle) elements.mobileOwnerTitle.textContent = name ? name + "’s SecondSelf" : "Your SecondSelf";
  const count = state.preferences.length;
  const functionsCount = state.functions.length;
  if (elements.mobileJourneyText) {
    elements.mobileJourneyText.textContent = count
      ? count + (count === 1 ? " preference" : " preferences") + " captured · " + functionsCount + (functionsCount === 1 ? " home interest" : " home interests")
      : functionsCount
        ? functionsCount + (functionsCount === 1 ? " home interest selected" : " home interests selected") + " · keep building"
        : "Choose home interests and start your first conversation";
  }
  const achieved = MILESTONES.filter(milestoneUnlocked).length;
  const progress = Math.round((achieved / MILESTONES.length) * 100);
  if (elements.mobileProgressValue) elements.mobileProgressValue.textContent = progress + "%";
  if (state.apiConnected) {
    elements.providerLabel.textContent = "LOCAL AI · ON-DEVICE";
  } else if (state.apiError) {
    elements.providerLabel.textContent = "LOCAL AI · MODEL NEEDS ATTENTION";
  } else {
    elements.providerLabel.textContent = "LOCAL AI · FIRST-TIME SETUP";
  }
  document.title = name ? "SYNQ.ME | " + name + "’s SecondSelf" : "SYNQ.ME | Build Your SecondSelf";
  const intro = $(".conversation-intro p");
  if (intro) intro.textContent = robotName
    ? "Tell me what matters to you. I’ll help shape your digital persona, one preference at a time. Your future robot name is " + robotName + "."
    : "Tell me what matters to you. I’ll help shape your digital persona, one preference at a time.";
}
renderAll();

function chooseFallbackQuestion(options) {
  const recentReplies = state.messages
    .filter((item) => item.role === "assistant")
    .slice(-6)
    .map((item) => item.content);
  const unused = options.find((option) => !recentReplies.some((reply) => option.seen.test(reply)));
  if (unused) return unused.question;
  const latest = recentReplies[recentReplies.length - 1] || "";
  const differentFromLatest = options.find((option) => !option.seen.test(latest));
  return (differentFromLatest || options[0]).question;
}

function localReply(message) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  const robotName = state.profile.robotName.trim() || "robot";
  const previousAssistant = [...state.messages.slice(0, -1)].reverse().find((item) => item.role === "assistant")?.content || "";
  const recentAssistant = state.messages.filter((item) => item.role === "assistant").slice(-6).map((item) => item.content);
  const normalise = (value) => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const alreadyAsked = (question) => recentAssistant.some((reply) => normalise(reply).includes(normalise(question)) || normalise(question).includes(normalise(reply)));
  const choose = (options) => {
    const fresh = options.find((option) => !alreadyAsked(option));
    if (fresh) return fresh;
    const newAngles = [
      "Can you walk me through how that usually happens at home?",
      "What tends to happen just before you need that done?",
      "What small detail would make the biggest difference to you in that situation?",
      "When this doesn’t go the way you like, what usually goes wrong?"
    ];
    return newAngles.find((option) => !alreadyAsked(option)) || "What does a typical day look like for you in that situation?";
  };
  const lastWas = (pattern) => pattern.test(previousAssistant);

  if (isClarificationRequest(text)) return clarificationHelpReply(previousAssistant, state.messages.filter((item) => item.role === "user").slice(-2, -1)[0]?.content || "");

  if (/^(morning|in the morning|evening|in the evening|afternoon|at night)$/i.test(text) && lastWas(/what time|morning and evening|which times|when would/i)) {
    if (/morning/i.test(text)) return "Morning sounds like a good fit. Is that because you're usually up and about then, or would you prefer it done before you start using the kitchen?";
    if (/evening|night/i.test(text)) return "Evening, then. Would you picture that happening after you've cooked or eaten, or at a set time regardless?";
    return "That gives me a better picture. Is that time tied to a particular part of your routine, or does it simply suit you best?";
  }

  if (/^(washing|wash|washing and drying|wash and dry|laundering)$/i.test(text) && lastWas(/which part|sorting, washing|putting clothes away/i)) {
    return choose([
      "When you wash clothes, do you usually separate them by colour first, or pay more attention to fabric and care labels?",
      "Are there any garments you treat differently from the rest—delicates, wool, work clothes, or anything you prefer to air-dry?",
      "Do you tend to have a regular laundry day, or do you wash smaller loads as things need doing?"
    ]);
  }

  if (/^(sorting|sort|separating|separate clothes)$/i.test(text) && lastWas(/which part|sorting, washing/i)) {
    return choose([
      "What’s your usual rule for sorting: colours, fabric, or how warm the items can be washed?",
      "Are there any colours or fabrics you’re especially careful to keep separate?",
      "Do you prefer to sort everything before a wash starts, or keep separate laundry baskets ready?"
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

  if (/(ask me|ask before|check with me|permission|confirm before|without asking|don't want.*(?:move|touch|throw away)|should avoid|avoid doing)/i.test(text) ||
      (/avoid|permission|boundary/i.test(previousAssistant) && text.length < 100)) {
    return choose([
      "That’s an important boundary. Are you most concerned about the robot moving or damaging things, entering private spaces, or making a decision without checking with you?",
      "What kinds of things should it never decide for itself—moving belongings, throwing something away, or using a product you haven’t approved?",
      "Would you like it to ask about every uncertain action, or only when there’s a real risk of damage, privacy, or an unwanted change?"
    ]).replace(/\bthe robot\b/gi, robotName);
  }

  if (/(laundry|washing|clothes|fold|drying|wardrobe)/i.test(lower)) {
    return choose([
      "What tends to matter most with laundry in your home: keeping colours separate, protecting delicate items, or having everything ready when you need it?",
      "How do you like clean clothes left—folded, hung up, or put back in specific places?",
      "Are there any laundry habits you already have that you’d definitely want your robot to follow?"
    ]).replace(/\byour robot\b/gi, robotName);
  }

  if (/(vacuum|floor|carpet|tidy|cleaning|clean|surface|counter|worktop|kitchen)/i.test(lower)) {
    return choose([
      "When a room feels properly looked after to you, what do you notice first: clean surfaces, clear floors, or everything being back where it belongs?",
      "Are there parts of the room you like to deal with first, or do you tend to work around whatever needs attention?",
      "Is there anything in that space that should stay exactly where it is, even during a tidy-up?"
    ]).replace(/\byour robot\b/gi, robotName);
  }

  if (/(cook|meal|food|recipe|ingredient|grocery|shopping)/i.test(lower)) {
    return choose([
      "When it comes to meals, do you prefer familiar favourites or a bit of variety during the week?",
      "Are there ingredients you avoid for taste, preference, or practical reasons?",
      "What usually makes meal planning easier for you: knowing what's in the fridge, having a plan, or keeping things flexible?"
    ]);
  }

  if (/(pet|dog|cat|plant|water|garden)/i.test(lower)) {
    return choose([
      "What little signs tell you your pet or plants need attention?",
      "Are there any routines around that you'd want kept exactly as they are?",
      "Is there anything you’d want the robot to check with you about rather than decide on its own?"
    ]).replace(/\byour robot\b/gi, robotName);
  }

  if (/^(yes|yeah|yep|no|nope|probably|maybe|not sure|i don't know)$/i.test(text)) {
    return "Fair enough. What would help you decide—thinking through a real example at home, or starting with what usually happens today?";
  }

  if (lastWas(/\?$/) || lastWas(/\b(which|what|when|where|how|would you|do you|should)\b/i)) {
    const previousUser = state.messages.filter((item) => item.role === "user").slice(-2, -1)[0]?.content || "";
    if (previousUser && previousUser.length > 12) {
      return choose([
        "I’m getting a clearer picture now. What’s the one part of that routine you’d be most particular about?",
        "That helps. Is there a real example from your own home that would make your preference clearer?",
        "I see. What would be the most annoying thing for the robot to get wrong in that situation?"
      ]);
    }
  }

  return choose([
    "Tell me a little more about how that works at home for you. What do you tend to do first?",
    "I'm curious—what makes that feel right for you: convenience, keeping things consistent, or something else entirely?",
    "What would you notice first if your future robot really understood your way of doing that?"
  ]);
}



function robotSvgMarkup(robotId) {
  const option = ROBOT_OPTIONS.find((item) => item.id === robotId) || ROBOT_OPTIONS[0];
  const accent = option.accent;
  const shell = {
    elo: '<rect x="25" y="25" width="70" height="67" rx="25"/>',
    lumi: '<path d="M60 20c23 0 39 16 39 39S83 98 60 98 21 82 21 59 37 20 60 20Z"/>',
    pip: '<path d="M29 35 22 17l20 9h36l20-9-7 18v39c0 13-11 22-31 22S29 87 29 74Z"/>',
    nova: '<path d="M31 25 60 14l29 11 10 25-7 29-32 15-32-15-7-29Z"/>',
    miso: '<path d="M28 37 22 14l25 14h26l25-14-6 23v34c0 16-12 25-32 25S28 87 28 71Z"/>'
  }[robotId] || '<rect x="25" y="25" width="70" height="67" rx="25"/>';
  const extra = {
    elo: '<path d="M20 50h6m68 0h6M47 18v-5m26 5v-5" fill="none"/>',
    lumi: '<path d="M60 10v8m-4-4h8" fill="none"/>',
    pip: '<circle cx="60" cy="17" r="5"/>',
    nova: '<circle cx="60" cy="22" r="3"/>',
    miso: '<path d="M49 18h22" fill="none"/>'
  }[robotId] || '';
  const eyes = robotId === "miso"
    ? '<path d="M42 59q7-9 14 0M64 59q7-9 14 0" fill="none" stroke="' + accent + '" stroke-width="4" stroke-linecap="round"/>'
    : '<circle cx="44" cy="58" r="5" fill="' + accent + '"/><circle cx="76" cy="58" r="5" fill="' + accent + '"/>';
  return '<svg class="robot-svg robot-svg-' + robotId + '" viewBox="0 0 120 120" role="img" aria-label="' + option.name + ' robot">' +
    '<ellipse cx="60" cy="104" rx="31" ry="5" fill="#1d2937" opacity=".08"/>' +
    '<g stroke="#aab5c3" stroke-width="2.5" stroke-linejoin="round" fill="#fbfcfe">' + shell + extra + '</g>' +
    '<rect x="33" y="43" width="54" height="34" rx="13" fill="#192432"/>' +
    eyes +
    '<path d="M52 68q8 5 16 0" fill="none" stroke="#dce6f2" stroke-width="2" stroke-linecap="round"/>' +
    '<circle cx="60" cy="86" r="3" fill="' + accent + '"/>' +
    '<path d="M42 94v5m36-5v5" stroke="' + accent + '" stroke-width="3" stroke-linecap="round"/>' +
    '</svg>';
}

function saveRobotAppearance() {
  try {
    localStorage.setItem(ROBOT_APPEARANCE_KEY, JSON.stringify(robotAppearance));
  } catch {
    if (elements.voiceStatus) elements.voiceStatus.textContent = "Robot image selected for this session only; browser storage is full.";
  }
}

function renderRobotPicker() {
  if (!elements.robotPicker) return;
  elements.robotPicker.replaceChildren();
  ROBOT_OPTIONS.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "robot-picker-item";
    button.dataset.robotId = option.id;
    button.setAttribute("aria-label", "Choose robot image " + (index + 1) + ": " + option.description);
    button.setAttribute("aria-pressed", String(robotAppearance.robotId === option.id && !robotAppearance.customImageData));
    button.title = option.description;
    button.innerHTML = robotSvgMarkup(option.id);
    button.addEventListener("click", () => {
      robotAppearance.robotId = option.id;
      robotAppearance.customImageData = "";
      saveRobotAppearance();
      renderRobotPicker();
      applyRobotAppearance();
    });
    elements.robotPicker.append(button);
  });
  if (robotAppearance.customImageData) {
    const custom = document.createElement("button");
    custom.type = "button";
    custom.className = "robot-picker-item robot-picker-custom is-selected";
    custom.setAttribute("aria-label", "Your uploaded robot image");
    custom.setAttribute("aria-pressed", "true");
    custom.innerHTML = '<span class="robot-picker-custom-preview"><img src="' + robotAppearance.customImageData + '" alt="" /></span>';
    custom.addEventListener("click", () => applyRobotAppearance());
    elements.robotPicker.append(custom);
  }
}

function applyRobotAppearance() {
  if (!elements.selectedRobotArt) return;
  const option = ROBOT_OPTIONS.find((item) => item.id === robotAppearance.robotId) || ROBOT_OPTIONS[0];
  elements.selectedRobotArt.replaceChildren();
  if (elements.voiceOrbCore) {
    elements.voiceOrbCore.replaceChildren();
    if (robotAppearance.customImageData) {
      const voiceImage = document.createElement("img");
      voiceImage.src = robotAppearance.customImageData;
      voiceImage.alt = "";
      voiceImage.className = "voice-robot-image";
      elements.voiceOrbCore.append(voiceImage);
    } else {
      elements.voiceOrbCore.innerHTML = robotSvgMarkup(option.id);
    }
  }
  if (robotAppearance.customImageData) {
    const image = document.createElement("img");
    image.src = robotAppearance.customImageData;
    image.alt = "Your custom robot companion";
    image.className = "custom-robot-image";
    elements.selectedRobotArt.append(image);
    if (elements.selectedRobotName) elements.selectedRobotName.textContent = "YOUR ROBOT";
  } else {
    elements.selectedRobotArt.innerHTML = robotSvgMarkup(option.id);
    if (elements.selectedRobotName) elements.selectedRobotName.textContent = option.name;
  }
  if (elements.robotPicker) {
    elements.robotPicker.querySelectorAll("[data-robot-id]").forEach((button) => {
      const selected = button.dataset.robotId === robotAppearance.robotId && !robotAppearance.customImageData;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const customButton = elements.robotPicker.querySelector(".robot-picker-custom");
    if (customButton) {
      customButton.classList.toggle("is-selected", Boolean(robotAppearance.customImageData));
      customButton.setAttribute("aria-pressed", String(Boolean(robotAppearance.customImageData)));
    }
  }
  updateVoiceCompanionLabels();
  // Keep existing and future assistant avatars in sync with the selected appearance.
  if (elements.chatMessages) renderMessages();
}

function updateVoiceExperience(mode, message) {
  if (elements.voiceOrb) elements.voiceOrb.dataset.state = mode || "idle";
  if (elements.voiceExperience) {
    elements.voiceExperience.dataset.state = mode || "idle";
    elements.voiceExperience.classList.toggle("is-muted", voiceInputMuted);
  }
  if (elements.voiceExperienceStatus && message) elements.voiceExperienceStatus.textContent = message;
  if (elements.voiceMuteButton) {
    elements.voiceMuteButton.setAttribute("aria-pressed", String(voiceInputMuted));
    elements.voiceMuteButton.setAttribute("aria-label", voiceInputMuted ? "Unmute microphone" : "Mute microphone");
    elements.voiceMuteButton.title = voiceInputMuted ? "Unmute microphone" : "Mute microphone";
  }
  if (elements.voiceMuteControlButton) {
    elements.voiceMuteControlButton.setAttribute("aria-label", voiceInputMuted ? "Unmute microphone" : "Mute microphone");
  }
  if (elements.voiceMuteControlLabel) elements.voiceMuteControlLabel.textContent = voiceInputMuted ? "Unmute" : "Mute";
}

function primeBrowserSpeechForSession() {
  if (!speechSynthesisAvailable) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    synth.resume();
    // A silent utterance inside the user's Voice-button gesture helps unlock
    // browser speech on stricter mobile browsers before the first AI reply.
    const primer = new SpeechSynthesisUtterance(" ");
    primer.volume = 0;
    primer.rate = 10;
    primer.onend = () => { try { synth.resume(); } catch {} };
    synth.speak(primer);
  } catch (error) {
    console.info("Browser speech could not be primed; the retry control remains available.", error);
  }
}

function openVoiceExperience() {
  if (!elements.voiceExperience) return;
  elements.voiceExperience.hidden = false;
  document.body.classList.add("voice-experience-open");
  voiceInputMuted = false;
  updateVoiceCompanionLabels();
  if (elements.voiceRetrySpeechButton) elements.voiceRetrySpeechButton.hidden = true;
  if (!SpeechRecognitionConstructor) {
    updateVoiceExperience("idle", "Voice input is unavailable in this browser. Return to chat or try Chrome.");
    return;
  }
  if (voiceModeActive) return;
  voiceModeActive = true;
  voiceInputMuted = false;
  primeBrowserSpeechForSession();
  if (kokoroTTSInstance) {
    renderVoiceModelProgress({ visible: false });
  } else if (kokoroVoiceForProfile()) {
    if (kokoroLoadFailed) kokoroLoadFailed = false;
    if (!kokoroLoadPromise) {
      renderVoiceModelProgress({ label: "Checking for a saved voice model…", indeterminate: true });
      void loadKokoroTTS().catch((error) => {
        console.info("Kokoro model unavailable; browser speech remains available.", error);
      });
    } else if (elements.voiceModelProgress) {
      elements.voiceModelProgress.hidden = false;
    }
  } else {
    renderVoiceModelProgress({ visible: false });
  }
  if (elements.voiceStatus) {
    elements.voiceStatus.dataset.error = "";
    elements.voiceStatus.textContent = speechSynthesisAvailable
      ? "Voice on · browser speech services"
      : "Voice input on · spoken replies may not be supported";
  }
  updateVoiceModeButton();
  updateVoiceExperience("listening", "Connecting to your microphone…");
  startVoiceListening();
}

function closeVoiceExperience(statusMessage) {
  stopVoiceConversation(statusMessage || "Voice conversation stopped.");
  if (elements.voiceRetrySpeechButton) elements.voiceRetrySpeechButton.hidden = true;
  voiceInputMuted = false;
  if (elements.voiceExperience) elements.voiceExperience.hidden = true;
  document.body.classList.remove("voice-experience-open");
}

function toggleVoiceInputMute() {
  if (!voiceModeActive) return;
  voiceInputMuted = !voiceInputMuted;
  if (voiceInputMuted) {
    if (speechRecognition && recognitionListening) {
      try { speechRecognition.abort(); } catch {}
    }
    recognitionListening = false;
    updateVoiceExperience("muted", "Microphone muted. Your companion can still finish speaking.");
  } else {
    updateVoiceExperience("listening", "Microphone on. Speak whenever you are ready.");
    startVoiceListening();
  }
}

function handleRobotImageUpload(file) {
  if (!file || !file.type || !file.type.startsWith("image/")) return;
  if (file.size > 8 * 1024 * 1024) {
    window.alert("Choose an image smaller than 8 MB.");
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => window.alert("That image could not be opened. Choose another file.");
  reader.onload = () => {
    const image = new Image();
    image.onerror = () => window.alert("That image could not be opened. Choose another file.");
    image.onload = () => {
      const maxSide = 640;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return window.alert("This browser could not process the image.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      try {
        robotAppearance.customImageData = canvas.toDataURL("image/jpeg", 0.84);
        saveRobotAppearance();
        renderRobotPicker();
        applyRobotAppearance();
      } catch {
        window.alert("The image could not be saved in this browser. Try a smaller image.");
      }
    };
    image.src = String(reader.result || "");
  };
  reader.readAsDataURL(file);
}

function initialiseRobotAndVoiceControls() {
  renderRobotPicker();
  applyRobotAppearance();
  renderOwnerAvatarPreview();
  elements.uploadOwnerImageButton?.addEventListener("click", () => elements.ownerImageInput?.click());
  elements.ownerImageInput?.addEventListener("change", () => {
    const file = elements.ownerImageInput.files?.[0];
    handleOwnerImageUpload(file);
    elements.ownerImageInput.value = "";
  });
  elements.removeOwnerImageButton?.addEventListener("click", () => {
    ownerAvatarData = "";
    saveOwnerAvatar();
    renderOwnerAvatarPreview();
    renderMessages();
  });
  elements.ownerName?.addEventListener("input", renderOwnerAvatarPreview);
  elements.uploadRobotImageButton?.addEventListener("click", () => elements.robotImageInput?.click());
  elements.robotImageInput?.addEventListener("change", () => {
    const file = elements.robotImageInput.files?.[0];
    handleRobotImageUpload(file);
    elements.robotImageInput.value = "";
  });
  elements.voiceMuteButton?.addEventListener("click", toggleVoiceInputMute);
  elements.voiceMuteControlButton?.addEventListener("click", toggleVoiceInputMute);
  elements.voiceEndButton?.addEventListener("click", () => closeVoiceExperience("Voice conversation ended."));
  elements.voiceChatButton?.addEventListener("click", () => closeVoiceExperience("Returned to text chat."));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && elements.voiceExperience && !elements.voiceExperience.hidden) {
      closeVoiceExperience("Returned to text chat.");
    }
  });
}

function updateVoiceModeButton() {
  if (elements.voiceModeButton) {
    elements.voiceModeButton.classList.toggle("is-active", voiceModeActive);
    elements.voiceModeButton.setAttribute("aria-pressed", String(voiceModeActive));
    elements.voiceModeButton.setAttribute("aria-label", voiceModeActive ? "Stop voice conversation" : "Start voice conversation");
    elements.voiceModeButton.title = voiceModeActive ? "Stop voice conversation" : "Start a spoken conversation";
    const label = elements.voiceModeButton.querySelector("span");
    if (label) label.textContent = voiceModeActive ? "Stop" : "Voice";
  }
  if (elements.voiceStatus && !voiceModeActive && !elements.voiceStatus.dataset.error) {
    elements.voiceStatus.textContent = "";
  }
}

function stopVoiceConversation(statusMessage = "Voice conversation stopped.") {
  voiceModeActive = false;
  voiceInputMuted = false;
  stopKokoroAudio();
  updateVoiceExperience("idle", statusMessage);
  if (voiceRestartTimer) window.clearTimeout(voiceRestartTimer);
  voiceRestartTimer = null;
  recognitionTranscript = "";
  voiceTranscribing = false;
  if (speechRecognition && recognitionListening) {
    try { speechRecognition.abort(); } catch {}
  }
  recognitionListening = false;
  if (speechSynthesisAvailable) {
    currentSpeechUtterance = null;
    assistantIsSpeaking = false;
    window.speechSynthesis.cancel();
  }
  if (elements.voiceStatus) {
    elements.voiceStatus.dataset.error = statusMessage === "Voice conversation stopped." ? "" : "true";
    elements.voiceStatus.textContent = statusMessage;
  }
  updateVoiceModeButton();
  if (elements.conversationStatus) elements.conversationStatus.textContent = "Ready to talk";
}

function scheduleVoiceListening(delay = 350) {
  if (!voiceModeActive || voiceInputMuted || isSending || assistantIsSpeaking) return;
  if (voiceRestartTimer) window.clearTimeout(voiceRestartTimer);
  voiceRestartTimer = window.setTimeout(() => {
    voiceRestartTimer = null;
    startVoiceListening();
  }, delay);
}


function createSpeechRecognition() {
  if (!SpeechRecognitionConstructor) return null;
  try {
    const recognizer = new SpeechRecognitionConstructor();
    recognizer.lang = ({"en":"en-US","es":"es-ES","fr":"fr-FR","it":"it-IT","pt":"pt-BR","hi":"hi-IN","ja":"ja-JP","zh":"zh-CN"})[state.profile.preferredLanguage || "en"] || "en-US";
    recognizer.continuous = false;
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 1;
    recognizer.onstart = () => {
      recognitionListening = true;
      updateVoiceExperience("listening", selectedCompanionDisplayName() + " is listening. Speak naturally.");
      if (elements.conversationStatus) elements.conversationStatus.textContent = "Listening · speak naturally";
      if (elements.voiceStatus) {
        elements.voiceStatus.dataset.error = "";
        elements.voiceStatus.textContent = "Voice on · say a sentence at a time";
      }
    };
    recognizer.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = String(result?.[0]?.transcript || "").trim();
        if (result.isFinal && transcript) finalText += (finalText ? " " : "") + transcript;
      }
      if (finalText) recognitionTranscript = [recognitionTranscript, finalText].filter(Boolean).join(" ").trim();
    };
    recognizer.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        stopVoiceConversation("Microphone blocked. Allow microphone access in your browser settings, then try again.");
      } else if (event.error === "audio-capture") {
        stopVoiceConversation("No microphone was found. Connect or enable a microphone, then try again.");
      } else if (event.error === "network") {
        stopVoiceConversation("The browser speech service is unavailable. You can continue by typing.");
      } else if (event.error !== "no-speech" && elements.voiceStatus) {
        elements.voiceStatus.textContent = "Voice input stopped · you can try again or type";
      }
    };
    recognizer.onend = () => {
      recognitionListening = false;
      const transcript = recognitionTranscript.trim();
      recognitionTranscript = "";
      if (!voiceModeActive) return;
      if (transcript) {
        if (elements.messageInput) elements.messageInput.value = "";
        if (elements.conversationStatus) elements.conversationStatus.textContent = "Heard you · preparing a reply";
        void sendMessage(transcript);
        return;
      }
      scheduleVoiceListening(350);
    };
    return recognizer;
  } catch (error) {
    console.info("SYNQ.ME speech recognition could not be initialised.", error);
    return null;
  }
}

async function startVoiceListening() {
  if (!voiceModeActive || voiceInputMuted || isSending || assistantIsSpeaking || voiceTranscribing || recognitionListening) return;
  if (!speechRecognition) speechRecognition = createSpeechRecognition();
  if (!speechRecognition) {
    stopVoiceConversation("Voice input isn't supported by this browser. Try a current version of Chrome or use typing.");
    return;
  }
  recognitionTranscript = "";
  try {
    recognitionListening = true;
    speechRecognition.start();
  } catch (error) {
    recognitionListening = false;
    if (voiceModeActive) {
      if (elements.voiceStatus) elements.voiceStatus.textContent = "Starting microphone…";
      scheduleVoiceListening(700);
    }
  }
}

function kokoroVoiceForProfile() {
  const language = state.profile.preferredLanguage || "en";
  const gender = state.profile.robotVoice === "male" ? "male" : "female";
  return KOKORO_VOICE_MAP[language]?.[gender] || "";
}

function formatVoiceModelBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  const megabytes = bytes / (1024 * 1024);
  return megabytes.toFixed(megabytes >= 20 ? 0 : 1) + " MB";
}

function renderVoiceModelProgress({ visible = true, label = "", progress = null, indeterminate = false }) {
  if (voiceModelProgressTimer) {
    window.clearTimeout(voiceModelProgressTimer);
    voiceModelProgressTimer = null;
  }
  const views = [
    {
      container: elements.voiceModelProgress,
      track: elements.voiceModelProgressTrack,
      fill: elements.voiceModelProgressFill,
      label: elements.voiceModelProgressLabel,
      percent: elements.voiceModelProgressPercent
    },
    {
      container: elements.voiceModelProgressMain,
      track: elements.voiceModelProgressTrackMain,
      fill: elements.voiceModelProgressFillMain,
      label: elements.voiceModelProgressLabelMain,
      percent: elements.voiceModelProgressPercentMain
    }
  ];

  const hasProgress = Number.isFinite(progress);
  for (const view of views) {
    if (!view.container) continue;
    view.container.hidden = !visible;
    if (label && view.label) view.label.textContent = label;
    if (!view.track) continue;
    view.track.classList.toggle("is-indeterminate", Boolean(indeterminate));
    if (hasProgress) {
      const value = Math.max(0, Math.min(100, Number(progress)));
      view.track.setAttribute("aria-valuenow", String(Math.round(value)));
      if (view.fill) view.fill.style.width = value + "%";
      if (view.percent) view.percent.textContent = Math.round(value) + "%";
    } else {
      view.track.removeAttribute("aria-valuenow");
      if (view.fill) view.fill.style.width = indeterminate ? "34%" : "0%";
      if (view.percent) view.percent.textContent = "";
    }
  }
}

function scheduleVoiceModelProgressHide(delay = 2500) {
  if (voiceModelProgressTimer) window.clearTimeout(voiceModelProgressTimer);
  voiceModelProgressTimer = window.setTimeout(() => {
    voiceModelProgressTimer = null;
    if (elements.voiceModelProgress) elements.voiceModelProgress.hidden = true;
    if (elements.voiceModelProgressMain) elements.voiceModelProgressMain.hidden = true;
  }, delay);
}

function handleKokoroProgress(info) {
  if (!info || typeof info !== "object") return;
  if (info.status === "initiate") {
    renderVoiceModelProgress({ label: "Checking for a saved voice model…", indeterminate: true });
    return;
  }
  if (info.status === "download") {
    renderVoiceModelProgress({ label: "Downloading voice model…", indeterminate: true });
    return;
  }
  if (info.status === "progress_total" || info.status === "progress") {
    const loaded = Number(info.loaded);
    const total = Number(info.total);
    const progress = Number(info.progress);
    const isOverallProgress = info.status === "progress_total";
    const fileName = typeof info.file === "string" ? info.file.split("/").pop() : "";
    let label = isOverallProgress ? "Downloading voice model…" : "Downloading " + (fileName || "voice model file") + "…";
    if (Number.isFinite(loaded) && Number.isFinite(total) && total > 0) {
      const amount = formatVoiceModelBytes(loaded) + " of " + formatVoiceModelBytes(total);
      label = isOverallProgress
        ? "Voice model download · " + amount
        : "Current file " + (fileName || "download") + " · " + amount;
    }
    renderVoiceModelProgress({
      label,
      progress: Number.isFinite(progress) ? progress : null,
      indeterminate: !Number.isFinite(progress)
    });
  }
}

async function loadKokoroTTS() {
  if (kokoroTTSInstance) return kokoroTTSInstance;
  if (!kokoroLoadPromise) {
    kokoroLoadFailed = false;
    renderVoiceModelProgress({ label: "Checking for a saved voice model…", indeterminate: true });
    kokoroLoadPromise = (async () => {
      const [{ KokoroTTS }, { env }] = await Promise.all([
        import("kokoro-js"),
        import("@huggingface/transformers")
      ]);
      // Keep the model files in the browser's Cache API and reuse the WASM
      // runtime between app launches instead of fetching them again.
      env.useBrowserCache = true;
      env.useWasmCache = true;
      env.cacheKey = "transformers-cache";
      const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: "q8",
        device: "wasm",
        progress_callback: handleKokoroProgress
      });
      kokoroTTSInstance = tts;
      renderVoiceModelProgress({ label: "Voice ready on this device", progress: 100 });
      scheduleVoiceModelProgressHide(2800);
      return tts;
    })().catch((error) => {
      kokoroLoadPromise = null;
      kokoroTTSInstance = null;
      kokoroLoadFailed = true;
      renderVoiceModelProgress({ label: "Voice model unavailable · using built-in speech", progress: null, indeterminate: false });
      scheduleVoiceModelProgressHide(6000);
      throw error;
    });
  }
  return kokoroLoadPromise;
}

function scheduleKokoroBackgroundPreload(delay = 1400) {
  if (!kokoroVoiceForProfile() || kokoroTTSInstance || kokoroLoadPromise || kokoroLoadFailed) return;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection && connection.saveData) {
    console.info("SYNQ.ME voice model preload deferred because Data Saver is enabled.");
    return;
  }

  window.setTimeout(() => {
    if (kokoroTTSInstance || kokoroLoadPromise || kokoroLoadFailed) return;
    if (document.visibilityState === "hidden") {
      scheduleKokoroBackgroundPreload(8000);
      return;
    }
    // Best-effort request to reduce the chance the browser evicts the cached
    // 88 MB model under storage pressure. This never blocks voice loading.
    if (navigator.storage && typeof navigator.storage.persist === "function") {
      void navigator.storage.persist().then((persisted) => {
        if (!persisted) console.info("Browser storage persistence was not granted; cached model files may be evicted by the browser.");
      }).catch(() => {});
    }
    void loadKokoroTTS().catch((error) => {
      console.info("Kokoro background preload failed; built-in speech remains available.", error);
    });
  }, delay);
}

function clearKokoroAudio(player = kokoroAudioElement, url = kokoroAudioUrl) {
  if (player && player === kokoroAudioElement) kokoroAudioElement = null;
  if (url) {
    try { URL.revokeObjectURL(url); } catch {}
    if (url === kokoroAudioUrl) kokoroAudioUrl = "";
  }
}

function stopKokoroAudio() {
  kokoroSpeechGeneration += 1;
  if (kokoroAudioElement) {
    const player = kokoroAudioElement;
    kokoroAudioElement = null;
    try { player.pause(); player.removeAttribute("src"); player.load(); } catch {}
  }
  if (kokoroAudioUrl) {
    try { URL.revokeObjectURL(kokoroAudioUrl); } catch {}
    kokoroAudioUrl = "";
  }
  assistantIsSpeaking = false;
}

async function playKokoroReply(reply, voiceId, requestId, onPlaybackStarted = () => {}) {
  const tts = await loadKokoroTTS();
  if (!voiceModeActive || requestId !== kokoroSpeechGeneration) return true;
  const generated = await tts.generate(reply, { voice: voiceId });
  if (!voiceModeActive || requestId !== kokoroSpeechGeneration) return true;
  if (!generated || typeof generated.toBlob !== "function") throw new Error("Kokoro returned no playable audio.");
  const blob = generated.toBlob();
  const url = URL.createObjectURL(blob);
  const player = new Audio(url);
  player.preload = "auto";
  kokoroAudioElement = player;
  kokoroAudioUrl = url;
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearKokoroAudio(player, url);
      if (!ok) assistantIsSpeaking = false;
      resolve(ok);
    };
    player.onplay = () => {
      if (requestId !== kokoroSpeechGeneration || !voiceModeActive) {
        try { player.pause(); } catch {}
        finish(true);
        return;
      }
      onPlaybackStarted();
      assistantIsSpeaking = true;
      const companion = selectedCompanionDisplayName();
      updateVoiceExperience("speaking", companion + " is speaking.");
      if (elements.conversationStatus) elements.conversationStatus.textContent = companion + " is speaking";
      if (elements.voiceStatus) elements.voiceStatus.textContent = "Voice on · Kokoro on-device speech";
    };
    player.onended = () => {
      finish(true);
      assistantIsSpeaking = false;
      if (voiceModeActive && !voiceInputMuted) updateVoiceExperience("listening", selectedCompanionDisplayName() + " is listening. Speak naturally.");
      if (voiceModeActive) scheduleVoiceListening(250);
    };
    player.onerror = () => finish(false);
    player.play().catch(() => finish(false));
  });
}

function speakAssistantReplyWithBrowser(reply, retryAttempt = 0, userInitiated = false) {
  const spokenText = String(reply || "");
  if (!speechSynthesisAvailable) {
    if (elements.voiceStatus) elements.voiceStatus.textContent = "Speech output is unavailable in this browser.";
    updateVoiceExperience("listening", "Your reply is visible in chat. Spoken replies are not supported here.");
    return;
  }

  const synth = window.speechSynthesis;
  // Clear any stale utterance before resetting Chrome/Safari's speech queue.
  currentSpeechUtterance = null;
  assistantIsSpeaking = false;
  try {
    synth.cancel();
    synth.resume();
  } catch (error) {
    console.info("Browser speech queue reset was not available.", error);
  }

  const language = state.profile.preferredLanguage || "en";
  const locale = SPEECH_LOCALES[language] || "en-US";
  const utterance = new SpeechSynthesisUtterance(spokenText);
  utterance.lang = locale;
  utterance.rate = 1;
  utterance.pitch = state.profile.robotVoice === "male" ? 0.96 : 1.03;
  utterance.volume = 1;

  const voices = synth.getVoices();
  const languageCode = locale.split("-")[0].toLowerCase();
  const localeVoices = voices.filter((voice) => String(voice.lang || "").toLowerCase().startsWith(languageCode));
  const namePattern = state.profile.robotVoice === "male"
    ? /(male|daniel|fred|alex|george|oliver|aaron|david|michael|liam|jorge|thomas)/i
    : /(female|samantha|victoria|serena|karen|moira|fiona|libby|susan|kate|ava|zira|sara|monica)/i;
  const preferredVoice = localeVoices.find((voice) => namePattern.test(voice.name));
  const selectedVoice = preferredVoice || localeVoices.find((voice) => voice.default) || localeVoices[0] || voices.find((voice) => voice.default) || voices[0];
  if (selectedVoice) utterance.voice = selectedVoice;

  let didStart = false;
  let watchdog = null;
  const clearWatchdog = () => {
    if (watchdog !== null) {
      window.clearTimeout(watchdog);
      watchdog = null;
    }
  };

  const reportSpeechFailure = (reason) => {
    if (currentSpeechUtterance !== utterance) return;
    clearWatchdog();
    currentSpeechUtterance = null;
    assistantIsSpeaking = false;
    try { synth.cancel(); } catch {}

    console.info("SYNQ.ME browser speech did not complete.", reason);
    if (retryAttempt < 1 && voiceModeActive) {
      if (elements.voiceStatus) elements.voiceStatus.textContent = "Restarting your device’s speech service…";
      window.setTimeout(() => {
        if (voiceModeActive && lastAssistantReplyForSpeech === spokenText) {
          speakAssistantReplyWithBrowser(spokenText, retryAttempt + 1);
        }
      }, 220);
      return;
    }

    if (elements.voiceStatus) elements.voiceStatus.textContent = "Device speech did not start. Your reply is still in chat.";
    updateVoiceExperience("listening", selectedCompanionDisplayName() + " couldn’t start audio automatically. Your reply is in chat—tap below to hear it.");
    if (elements.voiceRetrySpeechButton) {
      elements.voiceRetrySpeechButton.textContent = "Tap to hear " + selectedCompanionDisplayName() + "’s reply";
      elements.voiceRetrySpeechButton.hidden = false;
    }
    if (voiceModeActive) scheduleVoiceListening(500);
  };

  currentSpeechUtterance = utterance;
  assistantIsSpeaking = true;
  utterance.onstart = () => {
    if (currentSpeechUtterance !== utterance) return;
    didStart = true;
    clearWatchdog();
    if (elements.voiceRetrySpeechButton) elements.voiceRetrySpeechButton.hidden = true;
    const companion = selectedCompanionDisplayName();
    updateVoiceExperience("speaking", companion + " is speaking.");
    if (elements.conversationStatus) elements.conversationStatus.textContent = companion + " is speaking";
    if (elements.voiceStatus) elements.voiceStatus.textContent = "Voice on · device speech";
  };
  utterance.onend = () => {
    if (currentSpeechUtterance !== utterance) return;
    clearWatchdog();
    currentSpeechUtterance = null;
    assistantIsSpeaking = false;
    if (elements.voiceRetrySpeechButton) elements.voiceRetrySpeechButton.hidden = true;
    if (voiceModeActive && !voiceInputMuted) updateVoiceExperience("listening", selectedCompanionDisplayName() + " is listening. Speak naturally.");
    if (voiceModeActive) scheduleVoiceListening(250);
  };
  utterance.onerror = (event) => {
    reportSpeechFailure(event?.error || "speech synthesis error");
  };

  const beginSpeaking = () => {
    if (currentSpeechUtterance !== utterance || !voiceModeActive) return;
    try {
      // resume() is important on browsers that leave speechSynthesis paused
      // after a cancelled or interrupted utterance.
      synth.resume();
      synth.speak(utterance);
    } catch (error) {
      reportSpeechFailure(error?.message || "speech synthesis threw an exception");
    }
  };

  watchdog = window.setTimeout(() => {
    if (currentSpeechUtterance === utterance && !didStart) {
      reportSpeechFailure("speech start timeout");
    }
  }, 3200);

  // If the user presses the retry button, speak in the same gesture stack so
  // browsers with stricter audio policies can unlock their speech service.
  if (userInitiated) beginSpeaking();
  else window.setTimeout(beginSpeaking, 80);
}

async function speakAssistantReply(reply) {
  if (!voiceModeActive) return;
  lastAssistantReplyForSpeech = String(reply || "");
  if (elements.voiceRetrySpeechButton) elements.voiceRetrySpeechButton.hidden = true;

  const voiceId = kokoroVoiceForProfile();
  // Use the configured character voice for the full reply. Do not speak with
  // the browser's generic voice just because Kokoro is still downloading.
  if (!voiceId) {
    speakAssistantReplyWithBrowser(reply);
    return;
  }

  try {
    if (!kokoroTTSInstance) {
      const loadPromise = kokoroLoadPromise || loadKokoroTTS();
      if (elements.voiceStatus) elements.voiceStatus.textContent = "Loading the selected robot voice…";
      updateVoiceExperience("thinking", "Preparing " + selectedCompanionDisplayName() + "’s voice…");
      await loadPromise;
    }
    if (!voiceModeActive) return;
    if (!kokoroTTSInstance) throw new Error("The selected voice model is not ready.");

    if (speechSynthesisAvailable) window.speechSynthesis.cancel();
    currentSpeechUtterance = null;
    const requestId = ++kokoroSpeechGeneration;
    if (elements.voiceStatus) elements.voiceStatus.textContent = "Preparing the selected robot voice…";
    updateVoiceExperience("thinking", "Preparing " + selectedCompanionDisplayName() + "’s reply…");

    // Wait for inference and playback to finish. A short startup timeout caused
    // slower devices to abandon Kokoro and fall back to an unrelated system voice.
    const played = await playKokoroReply(String(reply || ""), voiceId, requestId);
    if (played || !voiceModeActive || requestId !== kokoroSpeechGeneration) return;
    throw new Error("The selected voice could not start audio playback.");
  } catch (error) {
    console.info("SYNQ.ME selected voice could not play.", error);
    if (!voiceModeActive) return;
    assistantIsSpeaking = false;
    if (elements.voiceStatus) elements.voiceStatus.textContent = "The selected robot voice could not start.";
    updateVoiceExperience("listening", "I couldn’t start the selected voice. Tap retry to try it again.");
    if (elements.voiceRetrySpeechButton) {
      elements.voiceRetrySpeechButton.textContent = "Retry " + selectedCompanionDisplayName() + "’s voice";
      elements.voiceRetrySpeechButton.hidden = false;
    }
    if (voiceModeActive) scheduleVoiceListening(500);
  }
}

elements.voiceRetrySpeechButton?.addEventListener("click", () => {
  if (!lastAssistantReplyForSpeech || !voiceModeActive) return;
  elements.voiceRetrySpeechButton.hidden = true;
  void speakAssistantReply(lastAssistantReplyForSpeech);
});

elements.voiceModeButton?.addEventListener("click", () => {
  if (voiceModeActive && elements.voiceExperience && !elements.voiceExperience.hidden) {
    closeVoiceExperience("Voice conversation stopped.");
    return;
  }
  openVoiceExperience();
});

initialiseRobotAndVoiceControls();


function isClarificationRequest(message) {
  const value = String(message || "").toLowerCase().replace(/[.!?]+$/g, "").trim();
  return /^(such as what|like what|what do you mean|what do you mean by that|examples?|give me an example|can you give me an example|can you give me some examples|could you give me an example|could you give me some examples|what kind of things|what sort of things|can you explain that|could you explain that)$/.test(value);
}

function clarificationHelpReply(previousAssistantMessage, previousUserMessage = "") {
  const question = String(previousAssistantMessage || "").toLowerCase();
  const previousPreference = String(previousUserMessage || "");
  if (/(avoid|prevent|left untouched|never happen|shouldn't|should not)/i.test(question)) {
    return "For example, you might want me to ask before moving personal belongings, avoid touching fragile or private items, leave certain rooms alone, or check with you before throwing anything away. Those are just examples—do any apply to you, or is there something else?";
  }
  if (/(ask|permission|confirm|check with me)/i.test(question)) {
    return "For example, asking before moving your belongings, using a new cleaning product, throwing something away, or handling something fragile. Which, if any, would you want me to check with you first?";
  }
  if (/(time|timing|schedule|morning|evening|when)/i.test(question)) {
    return "For example, you might prefer a task before breakfast, after you leave a room, at a set time each day, or only when needed. Which sounds closest to your routine?";
  }
  if (/(order|sequence|first|before|after)/i.test(question)) {
    return "For example, cleaning surfaces before floors, putting things away before wiping a counter, or finishing one room before moving to the next. Is there a particular order you prefer?";
  }
  if (/(clean|surface|floor|vacuum|tidy|kitchen)/i.test(question) || /(clean|surface|floor|vacuum|tidy|kitchen)/i.test(previousPreference)) {
    return "For example, protecting delicate surfaces, using only products you approve, leaving personal items where they are, or cleaning high-use areas first. Which detail matters in your home?";
  }
  return "For example, I can learn about timing, task order, items that need special care, or things you want me to ask about before changing. Is there one of those you want to explore first?";
}

function responseRepeatsRecentAssistant(reply) {
  const normalise = (value) => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const current = normalise(reply);
  if (/what matters most to you when getting that right/.test(current)) return true;
  return state.messages
    .filter((item) => item.role === "assistant")
    .slice(-4)
    .some((item) => normalise(item.content) === current && current.length > 8);
}

function responseRepeatsUser(reply, userMessage) {
  const normalise = (value) => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const userText = normalise(userMessage);
  const replyText = normalise(reply);
  if (!userText || userText.length < 24) return false;
  if (replyText.includes(userText)) return true;

  const stopWords = new Set(["that","this","with","your","you","have","will","would","when","then","they","them","and","the","for","from","into","onto","some","particular","specific","about","because","before","after","once","what","where","which","just","like","need","want","i","me","my","to","a","an","of","it","is"]);
  const words = [...new Set(userText.split(" ").filter((word) => word.length >= 3 && !stopWords.has(word)))];
  if (words.length < 8) return false;
  const replyWords = new Set(replyText.split(" "));
  const overlap = words.filter((word) => replyWords.has(word)).length / words.length;
  return overlap >= 0.78;
}

function setLocalAIProgress({ label = "", progress = null, visible = true, indeterminate = false } = {}) {
  if (!elements.localAIProgress) return;
  elements.localAIProgress.hidden = !visible;
  if (elements.localAIProgressLabel) elements.localAIProgressLabel.textContent = label;
  const knownProgress = Number.isFinite(progress);
  if (elements.localAIProgressFill) {
    elements.localAIProgressFill.style.width = knownProgress ? Math.max(0, Math.min(100, progress)) + "%" : (indeterminate ? "18%" : "0%");
    elements.localAIProgressFill.classList.toggle("is-indeterminate", Boolean(indeterminate && !knownProgress));
  }
  if (elements.localAIProgressTrack) {
    if (knownProgress) elements.localAIProgressTrack.setAttribute("aria-valuenow", String(Math.round(progress)));
    else elements.localAIProgressTrack.removeAttribute("aria-valuenow");
    if (label) elements.localAIProgressTrack.setAttribute("aria-valuetext", label);
    else elements.localAIProgressTrack.removeAttribute("aria-valuetext");
  }
  if (!isSending && elements.conversationStatus && label) elements.conversationStatus.textContent = label;
}

function rejectPendingLocalAIRequests(error) {
  for (const [id, pending] of localAIPendingRequests.entries()) {
    pending.reject(error);
    localAIPendingRequests.delete(id);
  }
}

function handleLocalAIWorkerMessage(event) {
  const data = event.data || {};
  if (data.type === "status") {
    setLocalAIProgress({
      label: String(data.label || "Loading local AMÏA model"),
      progress: null,
      indeterminate: true
    });
    return;
  }
  if (data.type === "progress") {
    const progress = Number.isFinite(data.progress) ? data.progress : null;
    const label = data.status === "initiate"
      ? "Preparing local AMÏA model files"
      : "Loading local AMÏA model";
    setLocalAIProgress({
      label,
      progress,
      indeterminate: progress === null
    });
    return;
  }
  if (data.type === "ready") {
    localAIReady = true;
    state.apiProvider = "local";
    state.apiModel = LOCAL_MODEL_LABEL;
    state.apiConfigured = true;
    state.apiConnected = true;
    state.apiError = "";
    state.apiErrorDetail = "";
    setLocalAIProgress({ label: "Local AI ready", progress: 100 });
    if (localAILoadResolve) localAILoadResolve();
    localAILoadResolve = null;
    localAILoadReject = null;
    renderAll();
    window.setTimeout(() => setLocalAIProgress({ visible: false }), 6000);
    return;
  }
  if (data.type === "load-error") {
    const error = new Error(String(data.message || "The local model could not be loaded."));
    localAIReady = false;
    state.apiConnected = false;
    state.apiConfigured = true;
    state.apiProvider = "local";
    state.apiModel = LOCAL_MODEL_LABEL;
    state.apiError = "local model unavailable";
    state.apiErrorDetail = error.message;
    setLocalAIProgress({ label: error.message, progress: null, indeterminate: false });
    if (localAILoadReject) localAILoadReject(error);
    localAILoadResolve = null;
    localAILoadReject = null;
    renderAll();
    return;
  }
  if (data.type === "reply" || data.type === "reply-error") {
    const pending = localAIPendingRequests.get(data.id);
    if (!pending) return;
    localAIPendingRequests.delete(data.id);
    if (data.type === "reply-error") pending.reject(new Error(String(data.message || "Local generation failed.")));
    else pending.resolve(String(data.text || ""));
  }
}

function workerFailure(error) {
  const message = error?.message || "The local AI worker stopped unexpectedly.";
  localAIReady = false;
  localAIWorker = null;
  localAILoadPromise = null;
  state.apiConnected = false;
  state.apiError = "local model unavailable";
  state.apiErrorDetail = message;
  setLocalAIProgress({ label: message });
  if (localAILoadReject) localAILoadReject(new Error(message));
  localAILoadResolve = null;
  localAILoadReject = null;
  rejectPendingLocalAIRequests(new Error(message));
  renderAll();
}

function ensureLocalAIReady() {
  if (localAIReady) return Promise.resolve();
  if (localAILoadPromise) return localAILoadPromise;
  state.apiProvider = "local";
  state.apiModel = LOCAL_MODEL_LABEL;
  state.apiError = "";
  state.apiErrorDetail = "";
  try { Promise.resolve(navigator.storage?.persist?.()).catch(() => {}); } catch {}
  setLocalAIProgress({ label: "Checking local AMÏA model cache", progress: null, indeterminate: true });
  localAILoadPromise = new Promise((resolve, reject) => {
    localAILoadResolve = resolve;
    localAILoadReject = reject;
    try {
      if (!localAIWorker) {
        localAIWorker = new Worker(new URL("./local-ai.worker.js", import.meta.url), { type: "module" });
        localAIWorker.addEventListener("message", handleLocalAIWorkerMessage);
        localAIWorker.addEventListener("error", (error) => workerFailure(error));
        localAIWorker.addEventListener("messageerror", () => workerFailure(new Error("Local AI worker returned an unreadable message.")));
      }
      localAIWorker.postMessage({ type: "load" });
    } catch (error) {
      reject(error);
    }
  }).catch((error) => {
    localAILoadPromise = null;
    localAIReady = false;
    state.apiConnected = false;
    state.apiProvider = "local";
    state.apiModel = LOCAL_MODEL_LABEL;
    state.apiError = "local model unavailable";
    state.apiErrorDetail = String(error?.message || "The local model could not be loaded.");
    setLocalAIProgress({ label: state.apiErrorDetail });
    renderAll();
    throw error;
  });
  return localAILoadPromise;
}

function runLocalAIRequest(payload) {
  const id = ++localAIRequestSequence;
  return new Promise((resolve, reject) => {
    localAIPendingRequests.set(id, { resolve, reject });
    try {
      localAIWorker.postMessage({ ...payload, id });
    } catch (error) {
      localAIPendingRequests.delete(id);
      reject(error);
    }
  });
}

async function requestAIReply(repairMode = false) {
  if (!repairMode) lastAIReplyUsedFallback = false;
  state.apiProvider = "local";
  state.apiModel = LOCAL_MODEL_LABEL;
  state.apiError = "";
  state.apiErrorDetail = "";
  try {
    await ensureLocalAIReady();
    if (elements.conversationStatus) elements.conversationStatus.textContent = "Your companion is thinking…";
    const messages = state.messages.slice(-18).map((message) => ({ role: message.role, content: message.content }));
    const preferences = state.preferences.map((preference) => {
      const extracted = preferenceExtraction(preference);
      return {
        category: preference.category || classifyPreference(preference.text),
        text: preference.text,
        epistemicStatus: preference.status || "user_stated",
        explicitFields: extracted.explicitFields,
        unresolvedFields: extracted.unresolvedFields
      };
    });
    const reply = await runLocalAIRequest({
      type: "generate",
      messages,
      preferences,
      profile: {
        ownerName: state.profile.ownerName,
        robotName: state.profile.robotName,
        robotType: state.profile.robotType,
        robotVoice: state.profile.robotVoice || "female",
        preferredLanguage: state.profile.preferredLanguage || "en",
        askBeforeActions: state.profile.confirmActions
      },
      domesticFunctions: state.functions.map((id) => ACTIVITIES.find((activity) => activity.id === id)?.label).filter(Boolean),
      repairMode
    });
    if (!reply.trim()) throw new Error("The local model returned an empty reply.");
    state.apiConnected = true;
    state.apiConfigured = true;
    state.apiError = "";
    state.apiErrorDetail = "";
    elements.providerLabel.textContent = "LOCAL AI · ON-DEVICE";
    lastAIReplyUsedFallback = false;
    return reply.trim();
  } catch (error) {
    console.info("SYNQ.ME local Qwen generation failed.", error);
    state.apiConnected = false;
    state.apiError = "local model unavailable";
    state.apiErrorDetail = String(error?.message || "Local generation failed. Check WebGPU support and available memory.");
    elements.providerLabel.textContent = "LOCAL AI · MODEL NEEDS ATTENTION";
    return null;
  }
}

function localizedAIUnavailable(language) {
  const messages = {
    es: "Ahora mismo no he podido generar una respuesta. Prefiero no inventar una; inténtalo de nuevo dentro de un momento.",
    fr: "Je n’ai pas pu générer de réponse pour le moment. Je préfère ne pas deviner ; réessaie dans un instant.",
    it: "Al momento non riesco a generare una risposta. Preferisco non inventare; riprova tra poco.",
    pt: "Não consegui gerar uma resposta agora. Prefiro não inventar; tenta novamente daqui a pouco.",
    hi: "मैं अभी जवाब तैयार नहीं कर पाया हूँ। अनुमान लगाने के बजाय, कृपया थोड़ी देर बाद फिर कोशिश करें।",
    ja: "今は返答を生成できませんでした。推測で答えず、少し時間をおいてもう一度試してください。",
    zh: "我现在暂时无法生成回复。我不想凭猜测回答，请稍后再试一次。"
  };
  return messages[language] || "I can’t generate a reply right now. Please try again shortly.";
}

function responseErrorLabel(error) {
  const message = String(error?.message || "").toLowerCase();
  if (/429|quota|usage limit/.test(message) || error?.apiStatus === 429) return "quota limit";
  if (error?.apiStatus === 401 || error?.apiStatus === 403) return "AI key/access error";
  if (Number.isInteger(error?.apiStatus) && error.apiStatus >= 500) return "AI provider error";
  if (error?.apiStatus) return "API error " + error.apiStatus;
  if (/503|not configured|api key/.test(message)) return "not configured";
  if (/failed to fetch|network|cors|timeout|aborted/.test(message)) return "connection failed";
  return "request failed";
}

async function sendMessage(rawText) {
  if (!cloudUserId) {
    setAuthGateVisible(true);
    setAuthMode("signin", "Sign in or create an account before continuing. Your conversation history is saved to your account.");
    return;
  }
  if (!profileComplete()) {
    openSettings();
    elements.conversationStatus.textContent = "Set up your profile to begin";
    return;
  }
  const message = rawText.trim();
  if (!message || isSending) return;
  const clarificationRequest = isClarificationRequest(message);
  const turnId = ++sendSequence;
  isSending = true;
  if (voiceModeActive) updateVoiceExperience("thinking", "AMÏA is thinking…");
  elements.sendButton.disabled = true;
  elements.messageInput.disabled = true;
  elements.conversationStatus.textContent = (state.profile.robotName || "Your robot").trim() + " is thinking";
  state.messages.push({ role: "user", content: message });
  const previousAssistantMessage = state.messages.length > 1 && state.messages[state.messages.length - 2]?.role === "assistant"
    ? state.messages[state.messages.length - 2].content
    : "";
  const previousUserMessage = state.messages.slice(0, -1).reverse().find((item) => item.role === "user")?.content || "";
  const inferredPending = !state.pendingClarification &&
    /(which laundry detail matters most|sorting, washing and drying|how clothes are put away)/i.test(previousAssistantMessage) &&
    /^(washing|wash|washing and drying|wash and dry|laundering|cleaning clothes|sorting|sort|separating|separate clothes|sorting clothes|put(ting)? clothes away|clothes are put away|put away|folding|fold clothes|hanging|hang clothes|storage)$/i.test(message.trim())
    ? (() => {
        const target = findOrCreateLaundryPreference(previousUserMessage, message);
        return target ? { type: "laundry_detail", field: "laundry_detail", preferenceId: target.id } : null;
      })()
    : null;
  if (!state.pendingClarification && inferredPending) state.pendingClarification = inferredPending;
  const pendingBeforeAnswer = state.pendingClarification ? { ...state.pendingClarification } : null;
  const answeredPendingClarification = resolvePendingClarification(message);
  if (!answeredPendingClarification && !clarificationRequest) savePreference(message);
  persist();
  renderAll();

  const sentToAIThisTurn = true;
  let reply = await requestAIReply();
  const replyNeedsRepair = (value) => !value ||
    responseRepeatsUser(value, message) ||
    responseRepeatsRecentAssistant(value) ||
    /I've captured this preference for your browser-based SecondSelf|I've added it to your local digital persona|That's useful context for your SecondSelf|Let's make that preference more precise|What detail would matter most to get right|What matters most to you when getting that right|Which laundry detail matters most to you: sorting, washing and drying, or how clothes are put away|Can you walk me through how that usually happens at home/i.test(value);
  if (replyNeedsRepair(reply) && state.apiConnected && !lastAIReplyUsedFallback) {
    const retriedReply = await requestAIReply(true);
    if (retriedReply && retriedReply !== "__SYNQME_UNHELPFUL_AI_RESPONSE__" && !replyNeedsRepair(retriedReply)) {
      reply = retriedReply;
    } else {
      reply = (state.profile.preferredLanguage || "en") === "en"
        ? "I’m having trouble making a useful connection from that answer. I’ve understood the detail you shared; please try once more, or tell me which part of your routine you’d like to explore."
        : localizedAIUnavailable(state.profile.preferredLanguage);
    }
  } else if (!reply) {
    reply = state.apiErrorDetail || localizedAIUnavailable(state.profile.preferredLanguage || "en");
  } else if (reply === "__SYNQME_UNHELPFUL_AI_RESPONSE__") {
    reply = (state.profile.preferredLanguage || "en") === "en"
      ? "I’m having trouble making a useful connection from that answer. I’ve understood the detail you shared; please try once more, or tell me which part of your routine you’d like to explore."
      : localizedAIUnavailable(state.profile.preferredLanguage);
  }
  state.messages.push({ role: "assistant", content: reply });
  state.pendingClarification = detectPendingClarification(message, reply);
  state.messages = state.messages.slice(-5000);
  persist();
  renderAll();

  // The reply is already visible. Release the composer immediately instead of
  // keeping the UI in a thinking state while Supabase finishes syncing.
  isSending = false;
  elements.sendButton.disabled = false;
  elements.messageInput.disabled = false;
  const responseProviderLabel = (state.apiProvider ? state.apiProvider.toUpperCase() : "AI") + " · " + (state.apiModel || "model");
  elements.conversationStatus.textContent = sentToAIThisTurn && state.apiConnected
    ? responseProviderLabel + " · reply received · saving to account…"
    : "Reply received · saving to account…";
  if (voiceModeActive) speakAssistantReply(reply);
  else elements.messageInput.focus();

  void flushCloudSave().then((conversationSaved) => {
    // An older save must not overwrite the status for a newer user turn.
    if (turnId !== sendSequence || isSending) return;
    elements.conversationStatus.textContent = conversationSaved
      ? (sentToAIThisTurn && state.apiConnected
          ? responseProviderLabel + " response · saved to account"
          : state.apiError && sentToAIThisTurn
            ? (state.apiErrorDetail || responseProviderLabel + " unavailable · no scripted reply")
            : "Reply saved to account")
      : "Reply received · account sync needs attention";
  });
}

elements.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = elements.messageInput.value;
  elements.messageInput.value = "";
  sendMessage(text);
});
elements.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.chatForm.requestSubmit();
  }
});
document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    elements.messageInput.value = button.dataset.prompt || "";
    elements.messageInput.focus();
  });
});
elements.resetDemo.addEventListener("click", () => {
  if (!window.confirm("Reset this browser demo, including your settings and saved preferences?")) return;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  state = initialState();
  state.apiConnected = false;
  elements.conversationStatus.textContent = "Ready to talk";
  elements.taskResult.hidden = true;
  populateSettingsForm();
  renderAll();
  persist();
});

function buildPexiPersonaPackage() {
  const now = new Date().toISOString();
  const preferences = state.preferences.map((item) => {
    const extracted = preferenceExtraction(item);
    return {
      preference_id: item.id,
      record_version: 1 + (Array.isArray(item.clarifications) ? item.clarifications.length : 0),
      statement: item.text,
      category: item.category || classifyPreference(item.text),
      epistemic_status: item.status === "user_confirmed" ? "user_confirmed" : "user_stated",
      provenance: {
        source_application: "SYNQ.ME",
        source_type: "conversation",
        recorded_at: item.recordedAt || now,
        last_updated_at: item.clarifications?.length ? item.clarifications[item.clarifications.length - 1].recordedAt : (item.recordedAt || now),
        source_message: item.sourceMessage || item.text
      },
      explicit_fields: extracted.explicitFields,
      unresolved_fields: extracted.unresolvedFields,
      clarifications: Array.isArray(item.clarifications) ? item.clarifications : [],
      execution_status: "not_executable",
      requires_robot_capability_mapping: true
    };
  });

  const boundaries = preferences.filter((item) =>
    item.category === "Consent & boundaries" ||
    item.explicit_fields.approvalBoundary ||
    item.explicit_fields.negativeConstraint ||
    item.explicit_fields.preserveOrAvoid
  );

  return {
    schema: "app.mysecondself.pexi-persona",
    schema_version: "1.0.0",
    package_type: "portable_persona_profile",
    exported_at: now,
    source: {
      product: "SYNQ.ME",
      platform: "MySecondSelf",
      intelligence_layer: "AMÏA",
      package_status: "data_export_only"
    },
    owner: {
      display_name: state.profile.ownerName || ""
    },
    companion_profile: {
      chosen_name: state.profile.robotName || "",
      target_robot_type: state.profile.robotType || "Humanoid robot",
      preferred_voice: state.profile.robotVoice || "female",
      ask_before_actions: Boolean(state.profile.confirmActions)
    },
    domestic_functions: state.functions.map((id) => {
      const activity = ACTIVITIES.find((item) => item.id === id);
      return { function_id: id, label: activity?.label || id, status: "user_selected" };
    }),
    preferences,
    boundaries,
    pending_clarification: state.pendingClarification || null,
    completeness: {
      preference_count: preferences.length,
      selected_domestic_function_count: state.functions.length,
      unresolved_detail_count: preferences.reduce((sum, item) => sum + item.unresolved_fields.length, 0)
    },
    pexi_transfer_contract: {
      target: "PEXI",
      transfer_status: "portable_persona_data_package",
      requires_robot_capability_mapping: true,
      requires_target_robot_safety_validation: true,
      requires_user_authorisation_before_physical_actions: true,
      physical_robot_connected: false,
      physical_actions_enabled: false,
      note: "This package carries stated persona data and unresolved details. It is not a robot-control command or proof of compatibility."
    }
  };
}

function exportPexiPersonaPackage() {
  const payload = buildPexiPersonaPackage();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "mysecondself-pexi-persona.json";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (elements.conversationStatus) elements.conversationStatus.textContent = "Persona package exported";
}

function makeTaskStep(number, title, description) {
  const item = document.createElement("div");
  item.className = "task-step";
  addElement(item, "task-step-number", String(number).padStart(2, "0"));
  const copy = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = title;
  copy.append(strong);
  const p = document.createElement("p");
  p.textContent = description;
  copy.append(p);
  item.append(copy);
  elements.taskSteps.append(item);
}

elements.runTask.addEventListener("click", () => {
  if (taskRunning) return;
  taskRunning = true;
  elements.runTask.disabled = true;
  elements.runTask.querySelector("span").textContent = "Preparing preview…";
  elements.taskResult.hidden = false;
  elements.taskSteps.replaceChildren();
  elements.amyaState.textContent = "Structuring";
  elements.pexiState.textContent = "Future use";
  elements.amyaState.classList.add("ready");
  elements.pexiState.classList.remove("ready");
  elements.taskDescription.textContent = "This optional preview illustrates how a future household routine could draw on preferences you choose to record. It does not connect to or control a robot.";
  window.setTimeout(() => {
    makeTaskStep(1, "Start with your interests", state.functions.length
      ? "Use the domestic functions you selected: " + state.functions.map((id) => ACTIVITIES.find((activity) => activity.id === id)?.label).filter(Boolean).join(", ") + "."
      : "No domestic functions selected yet. Choose the areas of home life you want your SecondSelf to learn about in Settings.");
    makeTaskStep(2, "Use your personal preferences", state.preferences.length
      ? "Reference the " + state.preferences.length + (state.preferences.length === 1 ? " preference" : " preferences") + " saved to your account."
      : "No preferences recorded yet. Start a conversation with your chosen companion to add details to your persona.");
    makeTaskStep(3, "Build the persona, not a robot connection", "The preview shows a conceptual structure for personalisation. No physical robot is connected, and no action is executed.");
    elements.amyaState.textContent = "Context outlined";
    elements.pexiState.textContent = "Not connected";
    elements.taskDescription.textContent = "This is a persona-building preview: a look at how selected interests and stated preferences could be organised into a future household routine. It is not a simulation of verified robot capability.";
    elements.runTask.querySelector("span").textContent = "Preview ready";
    elements.taskResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
    taskRunning = false;
    elements.runTask.disabled = false;
    window.setTimeout(() => { elements.runTask.querySelector("span").textContent = "Preview future household routine"; }, 1800);
  }, 350);
});

async function submitAccountForm(event) {
  event.preventDefault();
  if (authBusy) return;
  if (!supabase) {
    setAuthMode(authMode, "Account sign-in is unavailable because Supabase is not configured for this deployment.");
    return;
  }

  const email = String(elements.authEmail?.value || "").trim().toLowerCase();
  const password = String(elements.authPassword?.value || "");
  rememberMeEnabled = Boolean(elements.rememberMe?.checked);
  try { localStorage.setItem("synqme-remember-me-choice", String(rememberMeEnabled)); } catch {}
  if (authMode !== "recovery" && !email) {
    setAuthMode(authMode, "Enter your email address to continue.");
    elements.authEmail?.focus();
    return;
  }
  if (password.length < 8) {
    setAuthMode(authMode, "Use a password with at least 8 characters.");
    elements.authPassword?.focus();
    return;
  }

  authBusy = true;
  if (elements.authSubmit) {
    elements.authSubmit.disabled = true;
    elements.authSubmit.textContent = authMode === "signup" ? "Creating account…" : authMode === "recovery" ? "Saving password…" : "Signing in…";
  }

  try {
    if (authMode === "recovery") {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      authRecoveryInProgress = false;
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!data.session) throw new Error("Your password was changed, but the account session could not be restored. Please sign in.");
      await loadSignedInAccount(data.session, { migrateDraft: true });
      if (elements.authPassword) elements.authPassword.value = "";
      if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
      return;
    }

    if (authMode === "signup" || authMode === "signin") {
      const importingDraft = Boolean(elements.authImportDraft?.checked);
      if (importingDraft) savePendingAccountDraft(email);
      else {
        try { localStorage.removeItem(ACCOUNT_DRAFT_KEY); } catch {}
      }
      if (authMode === "signup") {
      const { data: currentData, error: currentError } = await supabase.auth.getSession();
      if (currentError) throw currentError;
      if (currentData.session?.user?.is_anonymous) {
        const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
        if (signOutError) throw signOutError;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: AUTH_REDIRECT_URL }
      });
      if (error) throw error;
      if (data.session && data.user && !data.user.is_anonymous) {
        await loadSignedInAccount(data.session, { migrateDraft: true });
        if (elements.authPassword) elements.authPassword.value = "";
      } else {
        if (elements.authEmail) elements.authEmail.value = email;
        if (elements.authPassword) elements.authPassword.value = "";
        setAuthMode("signin", importingDraft
          ? "Account created. Check your email for the confirmation link, then return here and sign in. The browser persona you chose to import will be saved to this account."
          : "Account created. Check your email for the confirmation link, then return here and sign in.");
      }
      return;
      }
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data.session || !data.user || data.user.is_anonymous) throw new Error("We couldn’t establish your account session. Please try again.");
    await loadSignedInAccount(data.session, { migrateDraft: true });
    if (elements.authPassword) elements.authPassword.value = "";
  } catch (error) {
    const raw = String(error?.message || "");
    const message = /invalid login credentials/i.test(raw)
      ? "That email and password combination was not recognised. Check your details or create an account."
      : /email not confirmed/i.test(raw)
        ? "Please confirm your email address using the link we sent you, then sign in."
        : /already registered|user already registered/i.test(raw)
          ? "An account already exists for that email. Switch to Sign in or use Forgot password."
          : /password/i.test(raw) && /length|characters|short/i.test(raw)
            ? "Use a longer password (at least 8 characters)."
            : "We couldn’t complete that request. Check your details and connection, then try again.";
    cloudUserId = null;
    cloudUserEmail = "";
    cloudMode = "error";
    setAuthGateVisible(true);
    renderAccountStatus();
    setAuthMode(authMode, message);
    console.info("SYNQ.ME account action failed.", error);
  } finally {
    authBusy = false;
    if (elements.authSubmit) {
      elements.authSubmit.disabled = false;
      elements.authSubmit.textContent = authMode === "signup" ? "Create account" : authMode === "recovery" ? "Save new password" : "Sign in";
    }
  }
}

elements.authForm?.addEventListener("submit", submitAccountForm);
elements.rememberMe?.addEventListener("change", () => {
  rememberMeEnabled = Boolean(elements.rememberMe.checked);
});
elements.authModeToggle?.addEventListener("click", () => {
  if (authBusy) return;
  setAuthMode(authMode === "signup" ? "signin" : "signup");
});
elements.authForgotPassword?.addEventListener("click", async () => {
  if (!supabase) {
    setAuthMode("signin", "Password reset is unavailable because Supabase is not configured.");
    return;
  }
  const email = String(elements.authEmail?.value || "").trim().toLowerCase();
  if (!email) {
    setAuthMode("signin", "Enter your email address first, then choose Forgot password.");
    elements.authEmail?.focus();
    return;
  }
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: AUTH_REDIRECT_URL
    });
    if (error) throw error;
    setAuthMode("signin", "If an account exists for that address, a password-reset email has been sent. Follow its link to choose a new password.");
  } catch (error) {
    setAuthMode("signin", "We couldn’t send a reset email right now. Check your connection and try again.");
    console.info("SYNQ.ME password reset request failed.", error);
  }
});
elements.signOutButton?.addEventListener("click", async () => {
  if (!supabase || authBusy) return;
  authBusy = true;
  elements.signOutButton.disabled = true;
  try {
    if (cloudUserId) {
      const saved = await flushCloudSave();
      if (!saved) throw new Error("Latest account data has not synchronised");
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    if (cloudSaveTimer) window.clearTimeout(cloudSaveTimer);
    cloudSaveTimer = null;
    stopCloudConversationSync();
    cloudUserId = null;
    cloudUserEmail = "";
    cloudMode = "local";
    state = initialState();
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(ACCOUNT_DRAFT_KEY);
    } catch {}
    populateSettingsForm();
    renderAll();
    renderAccountStatus();
    setAuthGateVisible(true);
    setAuthMode("signin", "You’re signed out. Sign in again to access your saved SecondSelf.");
  } catch (error) {
    if (elements.conversationStatus) elements.conversationStatus.textContent = "Sign-out paused: the latest changes could not be confirmed as saved.";
    if (elements.memoryFootnote) elements.memoryFootnote.textContent = "Account sync needs attention. Reconnect before signing out.";
    console.info("SYNQ.ME sign-out failed.", error);
  } finally {
    authBusy = false;
    elements.signOutButton.disabled = false;
  }
});

if (supabase) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      authRecoveryInProgress = true;
      setAuthGateVisible(true);
      setAuthMode("recovery", "Enter a new password to finish resetting your account.");
    }
  });
}

initialiseCloudStorage().finally(() => {
  renderAccountStatus();
  if (cloudUserId) {
    if (!profileComplete()) openSettings();
    else updateSettingsMode();
  }
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.info("SYNQ.ME offline install features are unavailable on this load.", error);
    });
  });
}
