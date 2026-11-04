import { createVoiceBalance } from './voice-balance.js';
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { createMobileAuthTurnstile } from "./mobile-turnstile-bridge.js";
import { createMssInterface, buildInterfaceModel, COMPANION_HEAD_IMAGE } from "./mss-interface.js";
import { coalesceTranscriptTurns, preferTranscriptTurn, bestUserTranscript, isServiceErrorText } from "./transcript-turns.js";
import { createRememberedSessionStorage, nativePersistentSessionStorage } from "./session-storage.js";
import { applianceReminderTurn } from "./appliance-reminders.js";
import { conversationCheckpoint, englishResumeReply } from "./conversation-resume.js";
import { syncRobotSpeaking } from "./robot-speaking.js";
import { collectReviewableFragments, preferenceDisplayLabel, preferenceIdentity } from "./preference-review.js";
import { scenarioSummary, passportEligibleMemories, buildPersonaPassport, passportText } from "./persona-passport.js";
import { createVoiceBreakTracker, breakResponse, responseBeforeBreak, standardBreakPhrase } from "./voice-break.js";
import { parseReminderCommand, matchReminder, validReminderTitle } from "./reminders.js";
import { simulationCapabilitySummary } from "./simulation.js";
import { conversationIntent } from "./conversation-plan.js";
import { createMemoryJobRunner, memoryRetryDelaySeconds, memoryJobKey } from "./memory-job-runner.js";
import { areaLearningState, areaStatusLabel, scenarioLearningObjectives, scenarioForId } from "./scenario-learning.js";
import { buildConversationContinuity } from "./conversation-continuity.js";
import { progressOwnerLabel, shareProgressImage } from "./progress-share.js";
import { PHONIC_LANGUAGES, CONVERSATION_LANGUAGE_NAMES } from "./conversation-languages.js";
import { shouldWelcomeBack, welcomeBackReply, spokenSentenceBreaks, addressByNameReply } from "./conversation-return.js";
import { isApplianceIdentityAnswer } from "./appliance-persona.js";
import { ruleSourceReferences, scenarioReviewRecord } from "./amia-persistence.js";
import { SCENARIOS, completedScenarioIds, availableScenarioCount, buildScenarioStartPatch, scenarioTasks, scenarioLearnings, scenarioProgressSummary } from "./scenario-journey.js";
import { createClient } from "@supabase/supabase-js";
import { createAuthTurnstile } from "./auth-turnstile.js";
import { createPhonicVoiceConversation, voiceFailureMessage } from "./phonic-voice.js";
import { createGooglePlayCheckout } from "./google-play-checkout.js";
import { buildPexiCapabilityPlan, cleanPexiCapabilityManifest } from "./pexi-readiness.js";
import { companionThinkingMessage, companionWelcomeMessage, isCompanionWelcomeMessage } from "./companion-copy.js";
import { assistantReplyRepeatsRecentAssistant, enforceFirstPersonTaskQuestions, normaliseVoicePreference, phonicVoiceIdForPreference } from "./voice-language.js";
import { ROOM_JOURNEY_ROOMS, addMonthsAnchored, getRoomTaskStates, resolveConversationRoomId } from "./room-journey.js";
import { OUT_OF_HOME_CATEGORIES, findOutOfHomeScenario, buildOutOfHomeScenarioPrompt } from "./out-of-home-training.js";
import { findOutOfHomeScenarioContext, isOutOfHomeTopicChange } from "./out-of-home-persona-prompt.js";
import {
  buildHomeMemoryIndexRows,
  extractHomeMemoryKeys,
  extractHomeMemoryTopics,
  rankHomeMemoryCandidates
} from "./home-memory-index.js";
import {
  buildPersonaMemorySearchKeys,
  cleanPersonaMemoryCandidate,
  deriveMemoryKind,
  deriveMemoryScopeKey,
  deriveMemoryTopic,
  makePersonaMemoryKey,
  memoryIsActive,
  isUsefulStandalonePreference,
  preferenceToPersonaMemory,
  rankPersonaMemories,
  shouldExtractPersonaMemory, SENSITIVE_MEMORY_PATTERN
} from "./persona-memory.js";

const STORAGE_KEY = "synqme-demo-v1";
const ACCOUNT_DRAFT_KEY = "synqme-pending-account-migration-v1";
const PEXI_CAPABILITY_MANIFEST_KEY = "synqme-pexi-capability-manifest-v1";
const INTRO_AUDIO_DISMISSED_KEY = "synqme-intro-audio-dismissed-v1";
let pexiCapabilityManifest = (() => {
  try {
    return cleanPexiCapabilityManifest(JSON.parse(localStorage.getItem(PEXI_CAPABILITY_MANIFEST_KEY) || "null"));
  } catch {
    return null;
  }
})();
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const PHONIC_API_BASE_URL = String(import.meta.env.VITE_PHONIC_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || "https://synqme-api.onrender.com").replace(/\/+$/, "");
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const AUTH_REDIRECT_URL = (() => {
  const configured = String(import.meta.env.VITE_AUTH_REDIRECT_URL || "").trim();
  if (configured && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured)) {
    return configured.replace(/\/+$/, "") + "/";
  }
  return "https://synqme.mysecondself.app/";
})();
var mssInterface = null;
const REMEMBER_CHOICE_KEY = "synqme-remember-me-choice";
const storedRememberChoice = (() => {
  try { return localStorage.getItem(REMEMBER_CHOICE_KEY); } catch { return null; }
})();
let rememberMeEnabled = storedRememberChoice !== "false";
let rememberChoiceExplicit = storedRememberChoice === "true" || storedRememberChoice === "false";
let rememberChoiceChangedThisLaunch = false;
if (document.querySelector("#rememberMe")) {
  document.querySelector("#rememberMe").checked = rememberMeEnabled;
}
// Read the durable native selection before Supabase restores its session.
// A late device read must not reverse a selection the user made this launch.
const rememberChoiceReady = Capacitor.isNativePlatform()
  ? Preferences.get({ key: REMEMBER_CHOICE_KEY }).then(({ value }) => {
      if (rememberChoiceChangedThisLaunch || (value !== "true" && value !== "false")) return;
      rememberMeEnabled = value === "true";
      rememberChoiceExplicit = true;
      const checkbox = document.querySelector("#rememberMe");
      if (checkbox) checkbox.checked = rememberMeEnabled;
    }).catch(error => {
      console.info("MSS remembered sign-in preference could not be restored.", error);
    })
  : Promise.resolve();

async function setRememberChoice(remember) {
  rememberChoiceChangedThisLaunch = true;
  rememberChoiceExplicit = true;
  rememberMeEnabled = Boolean(remember);
  const checkbox = document.querySelector("#rememberMe");
  if (checkbox) checkbox.checked = rememberMeEnabled;
  try { localStorage.setItem(REMEMBER_CHOICE_KEY, String(rememberMeEnabled)); } catch {}
  if (Capacitor.isNativePlatform()) {
    try {
      await rememberChoiceReady;
      await Preferences.set({ key: REMEMBER_CHOICE_KEY, value: String(rememberMeEnabled) });
    } catch (error) {
      console.warn("MSS could not store the remembered sign-in preference.", error);
    }
  }
}

const rememberMeStorage = createRememberedSessionStorage({
  persistent: Capacitor.isNativePlatform() ? nativePersistentSessionStorage(Preferences, localStorage) : localStorage,
  temporary: sessionStorage,
  getRemember: () => rememberMeEnabled,
  hasExplicitChoice: () => rememberChoiceExplicit,
  beforeRead: () => rememberChoiceReady,
  onRestore: remember => {
    if (rememberChoiceExplicit) return;
    rememberMeEnabled = remember;
    const checkbox = document.querySelector("#rememberMe");
    if (checkbox) checkbox.checked = remember;
  }
});
let trainingRevision = 0;
const trainingSessionStartedAt = Date.now();
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { fetch: (url, options = {}) => {
        const headers = new Headers(options.headers);
        headers.set("x-training-revision", String(trainingRevision));
        return fetch(url, { ...options, headers });
      } },
      auth: {
        storage: rememberMeStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;
const WELCOME = companionWelcomeMessage("en", "Vikki");

async function authenticatedApiHeaders(extra = {}) {
  if (!supabase) throw new Error("Your SYNQ.ME account session is unavailable. Sign in again.");
  const { data, error } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token || data?.session?.user?.is_anonymous) {
    throw new Error("Your SYNQ.ME account session has expired. Sign in again.");
  }
  return { "Content-Type": "application/json", "X-Training-Revision": String(trainingRevision), ...extra, Authorization: "Bearer " + token };
}

function localizeWelcomeMessage(language) {
  const welcome = companionWelcomeMessage(language, selectedCompanionDisplayName());
  state.messages = state.messages.map((item) =>
    item?.role === "assistant" && isCompanionWelcomeMessage(item.content)
      ? { ...item, content: welcome }
      : item
  );
}

const ROBOT_APPEARANCE_KEY = "synqme-robot-appearance-v1";
const OWNER_AVATAR_KEY = "synqme-owner-avatar-v1";
let ownerAvatarNeedsCloudSync = false;
let ownerAvatarRevision = 0;
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
      robotId: saved.robotId === "none" || ROBOT_OPTIONS.some((item) => item.id === saved.robotId) ? saved.robotId : "elo",
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
  { id: "home-explorer", title: "Home explorer", reward: "Explorer badge", description: "Capture three personal preferences through your journey.", unlocked: (s) => s.preferences.length >= 3 },
  { id: "first-memory", title: "First memory", reward: "Memory badge", description: "Capture your first personal preference in conversation.", unlocked: (s) => s.preferences.length >= 1 },
  { id: "pattern-finder", title: "Pattern finder", reward: "Personalisation badge", description: "Share five preferences and begin to form recognisable patterns.", unlocked: (s) => s.preferences.length >= 5 },
  { id: "secondself-builder", title: "SecondSelf builder", reward: "Foundation badge", description: "Choose three functions and capture eight preferences.", unlocked: (s) => s.functions.length >= 3 && s.preferences.length >= 8 }
];

const $ = (selector) => document.querySelector(selector);
const elements = {
  splash: $("#appSplash"),
  preferredLanguage: $("#preferredLanguage"),
  conversationStatus: $("#conversationStatus"),
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
  pexiCapabilityPlanList: $("#pexiCapabilityPlanList"),
  downloadPexiManifestTemplate: $("#downloadPexiManifestTemplate"),
  pexiManifestInput: $("#pexiManifestInput"),
  pexiManifestStatus: $("#pexiManifestStatus"),
  removePexiManifest: $("#removePexiManifest"),
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
  shareAnonymizedLearning: $("#shareAnonymizedLearning"),
  functionGrid: $("#functionGrid"),
  functionCount: $("#functionCount"),
  toggleAllFunctions: $("#toggleAllFunctions"),
  settingsPreferenceCount: $("#settingsPreferenceCount"),
  settingsPreferenceList: $("#settingsPreferenceList"),
  personaMemoryCount: $("#personaMemoryCount"),
  personaMemoryStatus: $("#personaMemoryStatus"),
  personaMemoryList: $("#personaMemoryList"),
  toggleArchivedPersonaMemories: $("#toggleArchivedPersonaMemories"),
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
  authPasswordToggle: $("#authPasswordToggle"),
  authPasswordLabel: $("#authPasswordLabel"),
  rememberMe: $("#rememberMe"),
  authStatus: $("#authStatus"),
  authSubmit: $("#authSubmit"),
  authModeToggle: $("#authModeToggle"),
  authForgotPassword: $("#authForgotPassword"),
  accountStatusLabel: $("#accountStatusLabel"),
  accountEmail: $("#accountEmail"),
  signOutButton: $("#signOutButton"),
  roomJourneyPanel: $("#roomJourneyPanel"),
  roomJourneyIntro: $("#roomJourneyIntro"),
  roomJourneyNextUnlock: $("#roomJourneyNextUnlock"),
  roomJourneyFeature: $("#roomJourneyFeature"),
  roomJourneyRoomGrid: $("#roomJourneyRoomGrid"),
  chatStage: $("#chatStage"),
  welcomeAudioOffer: $("#welcomeAudioOffer"),
  welcomeAudioPlayer: $("#welcomeAudioPlayer"),
  welcomeAudioContinue: $("#welcomeAudioContinue"),
  welcomeAudioSkip: $("#welcomeAudioSkip"),
  introAudioReplay: $("#introAudioReplay")
};

if (elements.preferredLanguage) elements.preferredLanguage.replaceChildren(...PHONIC_LANGUAGES.map(({code,label}) => {
  const option = document.createElement("option"); option.value = code; option.textContent = label; option.selected = code === "en"; return option;
}));

function defaultProfile() {
  return {
    ownerName: "",
    robotName: "",
    robotType: "Humanoid robot",
    robotVoice: "female",
    preferredLanguage: "en",
    confirmActions: false,
    shareAnonymizedLearning: false,
    shareLearningConsentAt: null
  };
}

function companionNameForProfile(profile = {}) {
  return String(profile.robotName || "").trim() || (normaliseVoicePreference(profile.robotVoice) === "male" ? "Andy" : "Vikki");
}

function personaliseWelcomeMessages(messages, profile = {}) {
  const welcome = companionWelcomeMessage(
    profile.preferredLanguage || "en",
    companionNameForProfile(profile)
  );
  return (Array.isArray(messages) ? messages : []).map((item) =>
    item?.role === "assistant" && isCompanionWelcomeMessage(item.content)
      ? { ...item, content: welcome }
      : item
  );
}

function initialState() {
  const profile = defaultProfile();
  return {
    messages: [{ role: "assistant", content: companionWelcomeMessage(profile.preferredLanguage, companionNameForProfile(profile)), timestamp: new Date().toISOString() }],
    preferences: [],
    profile,
    functions: [],
    pendingClarification: null,
    apiConnected: false,
    apiProvider: "",
    apiModel: "",
    apiConfigured: null,
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

function normaliseMessageTimestamp(item) {
  const candidate = item?.timestamp || item?.createdAt || item?.created_at || null;
  if (!candidate) return null;
  const milliseconds = Date.parse(candidate);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function sanitiseConversationMessage(item) {
  if (!item || (item.role !== "assistant" && item.role !== "user") || typeof item.content !== "string") return null;
  // A single "I" (or an unfinished "I'm"/"I am") is a captured audio token,
  // not a complete assistant message. Remove this legacy artefact on restore.
  if (item.role === "assistant" && /^i(?:['’]m| am)?$/i.test(item.content.trim())) return null;
  if (item.role === "assistant" && isServiceErrorText(item.content)) return null;
  const timestamp = normaliseMessageTimestamp(item);
  const scenarioMetadata = SCENARIOS.some(scenario => scenario.id === item.scenario_id) ? { scenario_id: item.scenario_id } : {};
  if (item.role === "assistant" && /what matters most to you when getting that right\?|what detail would matter most to get right\?|let'?s make that preference more precise/i.test(item.content)) {
    return { role: "assistant", content: "Let’s focus on one practical detail at a time.", timestamp, ...scenarioMetadata };
  }
  if (item.role === "assistant" && /I've captured this preference for your browser-based SecondSelf|I've added it to your local digital persona|That's useful context for your SecondSelf/i.test(item.content)) {
    return { role: "assistant", content: "Let’s focus on one practical detail at a time.", timestamp, ...scenarioMetadata };
  }
  return { role: item.role, content: item.content, timestamp, ...scenarioMetadata, ...(item.voice_turn_id ? {voice_turn_id:String(item.voice_turn_id).slice(0,140)} : {}), ...(typeof item.transcript_final === "boolean" ? {transcript_final:item.transcript_final} : {}) };
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
        })
        .filter(Boolean),
      preferences: saved.preferences
        .map((p) => typeof p === "string" ? cleanPreference(p) : cleanPreference(p?.text, p))
        .filter(Boolean),
      profile: { ...defaultProfile(), ...(saved.profile && typeof saved.profile === "object" ? saved.profile : {}), robotVoice: normaliseVoicePreference(saved.profile?.robotVoice) },
      functions: Array.isArray(saved.functions) ? saved.functions.filter((id) => ACTIVITIES.some((a) => a.id === id)) : [],
      pendingClarification: saved.pendingClarification && typeof saved.pendingClarification === "object" ? saved.pendingClarification : null,
      apiConnected: false,
      apiProvider: "",
      apiModel: "",
      apiConfigured: null,
      apiError: "",
      apiErrorDetail: ""
    };
    state.messages = personaliseWelcomeMessages(state.messages, state.profile);
    return state;
  } catch {
    return initialState();
  }
}

let state = loadState();
let activeOutOfHomeScenarioContext = findOutOfHomeScenarioContext(state.messages);
let isSending = false;
let sendSequence = 0;
let lastAIReplyUsedFallback = false;
let voiceModeActive = false;
const voiceBreakTracker = createVoiceBreakTracker();
let voiceBreakOfferDue = false;
let voicePauseAfterReply = false;
let voiceWakeLock = null;
let voiceIdleTimer = null;
let voiceIdleDeadline = 0;
async function requestVoiceWakeLock() {
  if (!voiceModeActive || document.visibilityState !== "visible" || !navigator.wakeLock) return;
  try {
    const lock = await navigator.wakeLock.request("screen");
    if (!voiceModeActive) { await lock.release(); return; }
    voiceWakeLock = lock;
    lock.addEventListener("release", () => { if (voiceWakeLock === lock) voiceWakeLock = null; });
  } catch { /* The browser or device may not allow wake locks. */ }
}
function clearVoiceIdle() { clearTimeout(voiceIdleTimer); voiceIdleTimer = null; voiceIdleDeadline = 0; }
function armVoiceIdle() {
  if (!voiceModeActive || voiceIdleDeadline) return;
  voiceIdleDeadline = Date.now() + 30000;
  voiceIdleTimer = setTimeout(() => {
    if (voiceModeActive) stopVoiceConversation("Paused after 30 seconds of silence. Press Start to continue.");
  }, 30000);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !voiceModeActive) return;
  if (voiceIdleDeadline && Date.now() >= voiceIdleDeadline) stopVoiceConversation("Paused after 30 seconds of silence. Press Start to continue.");
  else if (!voiceWakeLock) void requestVoiceWakeLock();
});
let voiceInputMuted = false;
let phonicVoiceConversation = null;
let phonicUsageSession = null;
let phonicUsageStartedAt = 0;
let phonicUserSpeechStartedAt = 0;
let phonicAssistantSpeechStartedAt = 0;
let phonicUserSpeechMs = 0;
let phonicAssistantSpeechMs = 0;
let phonicUsageSubmitted = false;
const phonicItemMap = new Map();
const phonicTurnMetadata = new Map();
let assistantIsSpeaking = false;
let voiceAudioPauseTimer = null;
let taskRunning = false;
let lastFocusedElement = null;
let cloudUserId = null;
let cloudUserEmail = "";
let profileCreatedAt = null;
let roomJourney = null;
let roomJourneyLoadInFlight = false;
let roomJourneyTableUnavailable = false;
let roomJourneyWarningShown = false;
let roomJourneySaveInFlight = false;
let welcomeBackPending = false;
let chatReturnSummary = "";
let selectedJourneyScenario = null;
let journeyDisplay = "scenarios";
let selectedReviewArea = null;
let simulationSession = null;
let todoItems = [];
let todoLoadedUserId = null;
let todoEditingId = null;
let todoAwaitingTitle = false;
let lastVoiceWasTodo = false;
let lastVoiceWasBreak = false;
function todoCommandForMessage(message) {
  if (voiceModeActive && breakResponse(message) === "pause") return null;
  const explicit = parseReminderCommand(message);
  if (explicit) return explicit;
  const turns = state.messages.at(-1)?.role === "user" && state.messages.at(-1)?.content === message ? state.messages : [...state.messages,{role:"user",content:message}];
  const offered = applianceReminderTurn(turns);
  if (offered?.command) return offered.command;
  if (!todoAwaitingTitle) return null;
  return /^(?:cancel|never mind|nevermind|forget it)[.! ]*$/i.test(message) ? {action:'cancel'} : {action:'add',title:message};
}
function todoStatus(text) { const node=document.querySelector('#todoStatus'); if(node) node.textContent=text; }
async function loadTodoReminders() {
  const owner=cloudUserId;
  if (!owner || !supabase) { todoItems=[]; todoLoadedUserId=null; renderTodoReminders(); return false; }
  try {
    const {data,error}=await supabase.from('synqme_reminders').select('id,title,completed,scenario_id,created_at,updated_at').eq('user_id',owner).order('created_at',{ascending:false}).limit(500);
    if(error) throw error;
    if(owner!==cloudUserId) return false;
    todoItems=Array.isArray(data)?data:[]; todoLoadedUserId=owner; renderTodoReminders(); return true;
  } catch { if(owner===cloudUserId) { todoLoadedUserId=null; todoStatus('Your reminders could not be loaded. Please try again.'); renderTodoReminders(); } return false; }
}
async function writeTodoReminder(action, item, title) {
  const owner=cloudUserId;
  if(!owner || !supabase) throw Error('Sign in to use your to-do list.');
  let query;
  if(action==='add') query=supabase.from('synqme_reminders').insert({user_id:owner,title,completed:false});
  else if(action==='delete') query=supabase.from('synqme_reminders').delete().eq('user_id',owner).eq('id',item.id);
  else query=supabase.from('synqme_reminders').update(action==='edit'?{title,updated_at:new Date().toISOString()}:{completed:action==='complete',updated_at:new Date().toISOString()}).eq('user_id',owner).eq('id',item.id);
  const {data,error}=await query.select('id').maybeSingle();
  if(error || !data) throw Error('The reminder could not be saved. Please try again.');
  if(owner!==cloudUserId) throw Error('The account changed before the reminder was confirmed.');
  todoEditingId=null;
  await loadTodoReminders();
}
function renderTodoReminders() {
  const summary=document.querySelector('#todoSummary'), active=document.querySelector('#todoActive'), completed=document.querySelector('#todoCompletedList'), count=document.querySelector('#todoCompletedCount');
  if(!summary || !active || !completed) return;
  const loaded=Boolean(cloudUserId && todoLoadedUserId===cloudUserId);
  const open=loaded?todoItems.filter(item=>!item.completed):[], done=loaded?todoItems.filter(item=>item.completed):[];
  summary.textContent=loaded ? open.length+' open · View list' : cloudUserId ? 'List unavailable · Open to retry' : 'Sign in to view your list';
  if(count) count.textContent=loaded?'('+done.length+')':'';
  active.replaceChildren(); completed.replaceChildren();
  if(!loaded) return;
  if(!open.length) { const empty=document.createElement('p'); empty.textContent='No open reminders.'; active.append(empty); }
  function renderItem(item, parent) {
    const row=document.createElement('div'); row.className='todo-item';
    if(todoEditingId===item.id) {
      const form=document.createElement('form'); form.className='todo-edit';
      const input=document.createElement('input'); input.value=item.title; input.maxLength=500; input.required=true; input.setAttribute('aria-label','Edit reminder');
      const save=document.createElement('button'); save.type='submit'; save.textContent='Save';
      const cancel=document.createElement('button'); cancel.type='button'; cancel.textContent='Cancel'; cancel.addEventListener('click',()=>{todoEditingId=null;renderTodoReminders();});
      form.addEventListener('submit',async event=>{event.preventDefault();const title=validReminderTitle(input.value);if(!title){todoStatus('Enter a reminder between 3 and 500 characters.');return;}save.disabled=true;try{await writeTodoReminder('edit',item,title);todoStatus('Reminder updated.');}catch(error){todoStatus(error.message);}finally{save.disabled=false;}});
      form.append(input,save,cancel);row.append(form);
    } else {
      const title=document.createElement('span');title.className='todo-title';title.textContent=item.title;row.append(title);
      const actions=document.createElement('div');actions.className='todo-actions';
      const button=(label,handler)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('aria-label',label+' '+item.title);b.addEventListener('click',handler);return b;};
      actions.append(button(item.completed?'Reopen':'Complete',async event=>{event.currentTarget.disabled=true;try{await writeTodoReminder(item.completed?'reopen':'complete',item);todoStatus(item.completed?'Reminder reopened.':'Reminder completed.');}catch(error){todoStatus(error.message);event.currentTarget.disabled=false;}}));
      actions.append(button('Edit',()=>{todoEditingId=item.id;renderTodoReminders();document.querySelector('.todo-edit input')?.focus();}));
      actions.append(button('Delete',async event=>{event.currentTarget.disabled=true;try{await writeTodoReminder('delete',item);todoStatus('Reminder deleted.');}catch(error){todoStatus(error.message);event.currentTarget.disabled=false;}}));
      row.append(actions);
    }
    parent.append(row);
  }
  open.forEach(item=>renderItem(item,active)); done.forEach(item=>renderItem(item,completed));
}
async function handleTodoCommand(command) {
  if(!command) return null;
  if(command.action==='cancel') { todoAwaitingTitle=false; return 'Okay, I will leave your to-do list as it is.'; }
  if(command.action!=='add') todoAwaitingTitle=false;
  if(command.action==='help') return 'You can say “Add finding the dishwasher model to my to-do list”, “What are my reminders?”, or name a reminder to complete or remove it.';
  if(!cloudUserId || !supabase) return 'Sign in to use your to-do list.';
  if(!(await loadTodoReminders())) return 'I could not load your to-do list. Please try again.';
  if(command.action==='list') {
    const items=todoItems.filter(item=>!item.completed);
    if(!items.length) return 'Your to-do list has no open reminders.';
    return 'Your open to-do reminders are: '+items.slice(0,30).map((item,index)=>(index+1)+'. '+item.title).join(' ') + (items.length>30?' You can see the rest in Journey.':'');
  }
  if(command.action==='add') {
    const title=validReminderTitle(command.title);
    if(!title) { todoAwaitingTitle=true; return 'What would you like me to add to your to-do list? Please describe the reminder.'; }
    todoAwaitingTitle=false;
    if (todoItems.some(item=>!item.completed && item.title.trim().toLowerCase()===title.toLowerCase())) return 'That is already in your to-do list: '+title+'.';
    try { await writeTodoReminder('add',null,title); return 'Added to your to-do list: '+title+'.'; } catch { return 'I could not save that reminder. Please try again.'; }
  }
  const relevant=command.action==='complete'?todoItems.filter(item=>!item.completed):todoItems;
  const match=matchReminder(relevant,command.query);
  if(match.status==='ambiguous') return 'More detail is needed to identify that reminder. Please tell me its name.';
  if(match.status==='missing') return 'I could not find that reminder. You can ask me to list your reminders.';
  if(command.action==='edit' && !validReminderTitle(command.title)) return 'Please tell me what you would like the reminder to say.';
  try { await writeTodoReminder(command.action,match.item,validReminderTitle(command.title));
    return command.action==='delete'?'Removed from your to-do list: '+match.item.title+'.':command.action==='complete'?'Marked as complete: '+match.item.title+'.':'Updated your reminder to: '+validReminderTitle(command.title)+'.';
  } catch { return 'I could not update that reminder. Please try again.'; }
}
document.querySelector('#todoReminders')?.addEventListener('toggle', event=>{if(event.currentTarget.open) void loadTodoReminders();});
document.querySelector('#todoAddForm')?.addEventListener('submit',async event=>{
  event.preventDefault();const input=document.querySelector('#todoInput'),title=validReminderTitle(input?.value);if(!title){todoStatus('Enter a reminder between 3 and 500 characters.');return;}
  const submit=event.currentTarget.querySelector('button');submit.disabled=true;try{await writeTodoReminder('add',null,title);input.value='';todoStatus('Reminder added.');}catch(error){todoStatus(error.message);}finally{submit.disabled=false;}
});

const SCENARIO_PROGRESS_KEY = "scenario_journey_v1";
function scenarioData() {
  const stored = roomJourney?.room_progress?.[SCENARIO_PROGRESS_KEY];
  return stored && typeof stored === "object" ? stored : {};
}
function renderLiveScenarioProgress() {
  const data = scenarioData();
  const scenarioId = mssInterface?.getActiveScenarioId() || data.started || (roomJourney?.active_room_id ? "room:" + roomJourney.active_room_id : "");
  const scenario = SCENARIOS.find(item => item.id === scenarioId);
  const done = completedScenarioIds(data.completed);
  document.querySelectorAll("[data-scenario-progress]").forEach(node => {
    node.replaceChildren();
    if (!scenario || !cloudUserId) { node.hidden = true; return; }
    node.hidden = false;
    const tasks = scenarioTasks(scenario);
    const reviewed = new Set(data.reviewed?.[scenario.id] || []);
    const discussed = tasks.filter(task => { const area=areaLearningState(scenario.id, task.id, personaMemoryRecords, [...reviewed]);return area.evidence.length || area.status==="reviewed"; }).length;
    const count = done.includes(scenario.id) ? tasks.length : tasks.filter(task => areaLearningState(scenario.id, task.id, personaMemoryRecords, [...reviewed]).status === "reviewed").length;
    const header = document.createElement("div"); header.className = "scenario-live-label";
    const title = document.createElement("strong"); title.textContent = scenario.title;
    const value = document.createElement("span"); value.textContent = done.includes(scenario.id) && !data.reviewed?.[scenario.id] ? "Previously completed" : Math.max(count,discussed) + " / " + tasks.length + " areas explored";
    header.append(title, value);
    const track = document.createElement("div"); track.className = "scenario-live-track"; track.setAttribute("role", "progressbar"); track.setAttribute("aria-label", scenario.title + " areas explored"); track.setAttribute("aria-valuemin", "0"); track.setAttribute("aria-valuemax", String(tasks.length)); track.setAttribute("aria-valuenow", String(Math.max(count,discussed)));
    const fill = document.createElement("span"); fill.style.width = (tasks.length ? Math.max(count,discussed) / tasks.length * 100 : 0) + "%"; track.append(fill);
    node.append(header, track);
  });
}
let passportSelection = new Set();
function renderScenarioSummary(scenario) {
  const section=document.createElement('section'); section.className='persona-scenario-summary';
  const heading=document.createElement('h4');heading.textContent='What you have taught me';section.append(heading);
  const intro=document.createElement('p');intro.textContent='Review the preferences you shared for this scenario. Your words and conditions remain yours to change.';section.append(intro);
  const groups=scenarioSummary(scenario,scenarioTasks(scenario),personaMemoryRecords);
  if(!groups.length){const empty=document.createElement('p');empty.textContent='No preferences have been linked to this scenario yet.';section.append(empty);}
  for(const group of groups){
    const block=document.createElement('div');block.className='persona-summary-group';const title=document.createElement('h5');title.textContent=group.title;block.append(title);
    for(const memory of group.rules){
      const item=document.createElement('article');item.className='persona-summary-rule';
      const statement=document.createElement('p');statement.textContent=memory.statement;item.append(statement);
      if(memory.conditions?.length){const condition=document.createElement('p');condition.textContent='Conditions: '+memory.conditions.join('; ');item.append(condition);}
      const detail=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Review or change';detail.append(summary);
      const form=document.createElement('form');form.className='persona-rule-form';
      const label=document.createElement('label');label.textContent='Preference';const input=document.createElement('textarea');input.rows=3;input.maxLength=420;input.required=true;input.value=memory.statement;label.append(input);
      const conditionsLabel=document.createElement('label');conditionsLabel.textContent='Conditions or exceptions, one per line';const conditions=document.createElement('textarea');conditions.rows=2;conditions.value=(memory.conditions||[]).join('\n');conditionsLabel.append(conditions);
      const permissionLabel=document.createElement('label');permissionLabel.textContent='Permission for this specific action';const permission=document.createElement('select');
      for(const [value,text] of [['unspecified','Not specified'],['ask_first','Ask me first'],['allowed','I explicitly allow it'],['prohibited','Do not do it']]){const option=document.createElement('option');option.value=value;option.textContent=text;permission.append(option);}permission.value=memory.permission_policy||'unspecified';permissionLabel.append(permission);
      const globalLabel=document.createElement('label');globalLabel.className='persona-global-choice';const global=document.createElement('input');global.type='checkbox';global.checked=memory.attributes?.apply_across_scenarios===true;globalLabel.append(global,document.createTextNode('Consider this guidance in other relevant situations, with the same conditions and permissions.'));
      const origin=document.createElement('p');origin.textContent=memory.source_timestamp?'Saved from your conversation on '+new Date(memory.source_timestamp).toLocaleDateString()+'.':'Saved from your conversation.';
      const save=document.createElement('button');save.type='submit';save.className='journey-task-button';save.textContent='Save changes';const feedback=document.createElement('p');feedback.setAttribute('role','status');
      form.addEventListener('submit',async event=>{event.preventDefault();const owner=cloudUserId,value=input.value.trim().replace(/\s+/g,' '), nextConditions=conditions.value.split('\n').map(x=>x.trim()).filter(Boolean);
        if(!owner || !isUsefulStandalonePreference(value) || value.length<8 || nextConditions.length>8 || nextConditions.some(c=>c.length>180 || SENSITIVE_MEMORY_PATTERN.test(c))){feedback.textContent='Enter a complete preference and up to eight short, non-sensitive conditions.';return;}
        save.disabled=true;try{const kind=deriveMemoryKind(value);await updatePersonaMemoryRow(memory.id,{statement:value,kind,conditions:nextConditions,permission_policy:permission.value,attributes:{...(memory.attributes||{}),apply_across_scenarios:global.checked},search_keys:buildPersonaMemorySearchKeys(value,[],memory.topic),status:'user_confirmed',confidence:0.98,reviewed_at:new Date().toISOString()});if(owner!==cloudUserId)return;renderScenarioJourney();}
        catch{feedback.textContent='The change could not be saved. Please try again.';save.disabled=false;}});
      form.append(label,conditionsLabel,permissionLabel,globalLabel,origin,save,feedback);detail.append(form);item.append(detail);block.append(item);
    }section.append(block);
  }
  const proposals=personaMemoryRecords.filter(item=>item.status==='inferred_pending_confirmation' && item.attributes?.pending_replaces && item.attributes?.scenario_id===scenario.id);
  for(const proposal of proposals){
    const original=personaMemoryRecords.find(item=>item.id===proposal.attributes.pending_replaces && ['user_stated','user_confirmed'].includes(item.status));
    if(!original)continue;
    const box=document.createElement('div');box.className='persona-summary-group';
    const label=document.createElement('h5');label.textContent='Review a suggested change';
    const before=document.createElement('p');before.textContent='Currently saved: '+original.statement;
    const explain=document.createElement('p');explain.textContent='A conversation suggested this change. Check the wording and conditions before saving.';
    const form=document.createElement('form');form.className='persona-rule-form';
    const nextLabel=document.createElement('label');nextLabel.textContent='Suggested preference';const next=document.createElement('textarea');next.required=true;next.maxLength=420;next.rows=3;next.value=proposal.statement;nextLabel.append(next);
    const condLabel=document.createElement('label');condLabel.textContent='Conditions or exceptions, one per line';const cond=document.createElement('textarea');cond.rows=2;cond.value=(proposal.conditions||[]).join('\n');condLabel.append(cond);
    const permissionLabel=document.createElement('label');permissionLabel.textContent='Permission for this specific action';const permission=document.createElement('select');for(const [value,text] of [['unspecified','Not specified'],['ask_first','Ask me first'],['allowed','I explicitly allow it'],['prohibited','Do not do it']]){const option=document.createElement('option');option.value=value;option.textContent=text;permission.append(option);}permission.value=original.permission_policy||'unspecified';permissionLabel.append(permission);
    const save=document.createElement('button');save.type='submit';save.textContent='Confirm change';const discard=document.createElement('button');discard.type='button';discard.textContent='Discard suggestion';const feedback=document.createElement('p');feedback.setAttribute('role','status');
    form.addEventListener('submit',async event=>{event.preventDefault();const owner=cloudUserId,value=next.value.trim().replace(/\s+/g,' '),conditions=cond.value.split('\n').map(x=>x.trim()).filter(Boolean);
      if(!owner||!isUsefulStandalonePreference(value)||conditions.length>8||conditions.some(c=>c.length>180||SENSITIVE_MEMORY_PATTERN.test(c))){feedback.textContent='Enter a complete preference and up to eight short, non-sensitive conditions.';return;}
      if(proposal.attributes.pending_target_updated_at && original.updated_at!==proposal.attributes.pending_target_updated_at){feedback.textContent='This preference has changed since the suggestion was made. Review the current preference instead.';return;}
      save.disabled=discard.disabled=true;try{await updatePersonaMemoryRow(original.id,{statement:value,conditions,permission_policy:permission.value,search_keys:buildPersonaMemorySearchKeys(value,[],original.topic),status:'user_confirmed',confidence:0.98,reviewed_at:new Date().toISOString()});if(owner!==cloudUserId)return;await updatePersonaMemoryRow(proposal.id,{status:'archived',archived_at:new Date().toISOString()});if(owner===cloudUserId)renderScenarioJourney();}catch{feedback.textContent='The change could not be fully saved. Refresh and check the current preference.';save.disabled=discard.disabled=false;}});
    discard.addEventListener('click',async()=>{discard.disabled=true;try{await updatePersonaMemoryRow(proposal.id,{status:'archived',archived_at:new Date().toISOString()});renderScenarioJourney();}catch{feedback.textContent='The suggestion could not be discarded. Try again.';discard.disabled=false;}});
    form.append(nextLabel,condLabel,permissionLabel,save,discard,feedback);box.append(label,before,explain,form);section.append(box);
  }
  if(groups.length){const reflection=document.createElement('p');reflection.className='persona-reflection';reflection.textContent='You told me: “'+groups[0].rules[0].statement+'” You can review or change this above.';section.append(reflection);}
  const readiness=document.createElement('details');readiness.className='persona-readiness';const rs=document.createElement('summary');rs.textContent='Robot readiness';readiness.append(rs);
  const explanation=document.createElement('p');explanation.textContent='Compare your selected tasks with an imported robot specification. Declarations have not been independently verified, and no physical robot test is implied.';readiness.append(explanation);
  const plan=buildPexiCapabilityPlan({selectedFunctions:state.functions,targetRobotType:state.profile.robotType||'Humanoid robot',capabilityManifest:pexiCapabilityManifest});
  if(!plan.tasks.length){const p=document.createElement('p');p.textContent='Choose home interests in Settings to see a task comparison.';readiness.append(p);}
  for(const task of plan.tasks){const p=document.createElement('p');const result=simulationCapabilitySummary({functionId:task.function_id,manifest:pexiCapabilityManifest,robotType:state.profile.robotType});p.textContent=task.label+': '+result.text;readiness.append(p);}
  const settings=document.createElement('button');settings.type='button';settings.className='journey-task-button';settings.textContent='Manage robot specification';settings.addEventListener('click',()=>{openSettings();const button=document.querySelector('#viewPexiReadiness');if(button?.getAttribute('aria-expanded')!=='true')button?.click();button?.scrollIntoView({block:'center'});button?.focus();});readiness.append(settings);section.append(readiness);
  return section;
}
const PASSPORT_EXPORT_ENABLED = false;
function downloadPassportFile(filename,content,type){if (!PASSPORT_EXPORT_ENABLED) return;const blob=new Blob([content],{type});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function renderPersonaPassport() {
 const content=document.querySelector('#personaPassportContent');if(!content)return;content.replaceChildren();
 const intro=document.createElement('p');intro.textContent='Details you have shared with your robot, including conditions and boundaries. These guide future conversations; they do not connect or control a physical robot.';content.append(intro);
 const items=personaMemoryRecords.filter(item=>['user_stated','user_confirmed'].includes(item.status) && item.statement);
 if(!items.length){const empty=document.createElement('p');empty.textContent='Your saved preferences will appear here as you talk to your robot.';content.append(empty);return;}
 const list=document.createElement('ul');for(const item of items){const row=document.createElement('li');row.textContent=item.statement;list.append(row);}content.append(list);
}

document.querySelector('#personaPassport')?.addEventListener('toggle',event=>{if(event.currentTarget.open)renderPersonaPassport();});

function renderScenarioJourney() {
  if (typeof mssInterface !== "undefined") mssInterface?.render();
  renderLiveScenarioProgress();
  const target = document.querySelector("#scenarioJourneyContent");
  const counter = document.querySelector("#scenarioJourneyCount");
  const header = document.querySelector("#scenarioHeaderProgress");
  if (!target) return;
  const ready = Boolean(cloudUserId && profileComplete() && roomJourney && roomJourney.user_id === cloudUserId);
  const data = ready ? scenarioData() : {};
  const journeyTitle = document.querySelector("#scenarioJourneyTitle");
  if (journeyTitle) journeyTitle.textContent = progressOwnerLabel(state.profile.ownerName,"journey");
  const share = document.querySelector("#shareJourneyProgress");
  if (share) { share.disabled = !ready; share.setAttribute("aria-label", "Share " + progressOwnerLabel(state.profile.ownerName,"progress")); }
  const workspaceLabel = document.querySelector("#moreWorkspace > summary > span");
  if (workspaceLabel) workspaceLabel.textContent = progressOwnerLabel(state.profile.ownerName,"journey and preferences");
  const headerLabel = document.querySelector("#scenarioHeaderProgress > span");
  if (headerLabel) headerLabel.textContent = progressOwnerLabel(state.profile.ownerName,"progress");
  const done = completedScenarioIds(data.completed);
  const headerValue = document.querySelector("#scenarioHeaderValue");
  if (counter) counter.textContent = ready ? done.length + " / " + SCENARIOS.length + " COMPLETE" : "PROGRESS UNAVAILABLE";
  if (headerValue) headerValue.textContent = ready ? done.length + "/" + SCENARIOS.length : "—/" + SCENARIOS.length;
  if (header) header.setAttribute("aria-label", ready ? done.length + " of " + SCENARIOS.length + " scenarios completed" : "Scenario progress unavailable");
  target.replaceChildren();
  target.closest(".scenario-journey").dataset.journeyDisplay = journeyDisplay;
  // Passport owns the only progress chart and complete module grid.
  // Journey is the selected scenario detail view, not a second chart screen.
  const backRow = document.createElement("div"); backRow.className = "journey-view-tabs";
  const backToPassport = document.createElement("button");
  backToPassport.type = "button";
  backToPassport.textContent = "← Back to Passport";
  backToPassport.setAttribute("aria-label", "Back to Passport chart and training modules");
  backToPassport.addEventListener("click", () => selectAppView("passport"));
  backRow.append(backToPassport);
  target.append(backRow);
  if (!ready) {
    const unavailable = document.createElement("p"); unavailable.textContent = roomJourneyTableUnavailable ? "Your scenario progress could not connect to your account. Try again when account sync is available." : "Sign in and complete your profile to begin your journey.";
    target.append(unavailable);
    return;
  }
  const available = availableScenarioCount(done);
  const selected = SCENARIOS.findIndex((item) => item.id === selectedJourneyScenario);
  const activeIndex = SCENARIOS.findIndex(item => item.kind === "room" && item.roomId === roomJourney.active_room_id && !done.includes(item.id));
  const index = selected >= 0 && (selected < available || selected === activeIndex) ? selected : activeIndex >= 0 ? activeIndex : Math.min(available - 1, SCENARIOS.length - 1);
  const scenario = SCENARIOS[index];
  selectedJourneyScenario = scenario.id;
  const nav = document.createElement("details"); nav.className = "journey-scenario-picker";
  const toggle = document.createElement("summary"); toggle.id = "journeyScenarioSelect"; toggle.setAttribute("aria-haspopup", "listbox"); toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-controls", "journeyScenarioOptions");
  toggle.textContent = (index + 1) + ". " + scenario.title;
  const list = document.createElement("div"); list.id = "journeyScenarioOptions"; list.className = "journey-scenario-options"; list.setAttribute("role", "listbox"); list.setAttribute("aria-label", "Choose a scenario");
  SCENARIOS.forEach((item, i) => {
    const option = document.createElement("button"); option.type = "button"; option.setAttribute("role", "option"); option.setAttribute("aria-selected", String(item.id === scenario.id));
    option.disabled = i >= available && i !== activeIndex;
    option.textContent = (i + 1) + ". " + item.title;
    const status = document.createElement("span"); status.textContent = done.includes(item.id) ? "Complete" : option.disabled ? "Locked" : "Current"; option.append(status);
    option.addEventListener("click", () => { selectedJourneyScenario = item.id; renderScenarioJourney(); document.querySelector("#journeyScenarioSelect")?.focus(); }); list.append(option);
  });
  nav.append(toggle, list);
  nav.addEventListener("toggle", () => toggle.setAttribute("aria-expanded", String(nav.open)));
  nav.addEventListener("focusout", event => { if (!nav.contains(event.relatedTarget)) nav.open = false; });
  nav.addEventListener("keydown", event => {
    if (event.key === "Escape") { nav.open = false; toggle.focus(); event.preventDefault(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); nav.open = true;
    const options = [...list.querySelectorAll("button:not(:disabled)")];
    const current = options.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : current < 0 ? options.findIndex(button => button.getAttribute("aria-selected") === "true") : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[Math.max(0, next)]?.focus();
  });
  const navLabel = document.createElement("div"); navLabel.id = "journeyScenarioLabel"; navLabel.className = "journey-select-label"; navLabel.textContent = "Choose your scenario"; toggle.setAttribute("aria-labelledby", "journeyScenarioLabel journeyScenarioSelect");
  const title = document.createElement("h3"); title.textContent = scenario.title;
  const desc = document.createElement("p"); desc.textContent = scenario.description + " Allow around 30 minutes, depending on what matters to you. You can pause and return whenever you like.";
  const start = document.createElement("button"); start.type = "button"; start.className = "out-of-home-scenario-action";
  start.textContent = done.includes(scenario.id) ? "Revisit this scenario" : data.started === scenario.id ? "Continue conversation" : "Start conversation";
  start.addEventListener("click", () => void startJourneyScenario(scenario));
  target.append(navLabel, nav, title, desc, start);
  target.append(renderScenarioSummary(scenario));
  target.append(renderSituationPreview(scenario));
  const tasks = document.createElement("section"); tasks.className = "journey-tasks";
  const tasksHeading = document.createElement("h4"); tasksHeading.textContent = "Tasks to explore";
  tasks.append(tasksHeading);
  const room = ROOM_JOURNEY_ROOMS.find(item => item.id === scenario.roomId);
  const covered = room ? roomCompletedIds(room) : [];
  scenarioTasks(scenario).forEach((task, taskIndex) => {
    const card = document.createElement("article"); card.className = "journey-task-card";
    const heading = document.createElement("h5"); heading.textContent = task.title;
    const description = document.createElement("p"); description.textContent = task.description;
    const status = document.createElement("span"); status.className = "journey-task-status";
    const reviewedIds = done.includes(scenario.id) ? scenarioTasks(scenario).map(item => item.id) : data.reviewed?.[scenario.id] || [];
    const readyIds = selectedReviewArea === scenario.id + ":" + task.id ? [task.id] : [];
    const learning = areaLearningState(scenario.id, task.id, personaMemoryRecords, reviewedIds, readyIds);
    status.textContent = learning.status === "not_started" && data.started === scenario.id ? "No linked learning yet" : areaStatusLabel(learning.status);
    const button = document.createElement("button"); button.type = "button"; button.className = "journey-task-button"; button.textContent = learning.evidence.length ? "Continue" : "Explore";
    button.setAttribute("aria-label", button.textContent + " " + task.title);
    button.addEventListener("click", () => void startJourneyScenario(scenario, task));
    const copy = document.createElement("div"); copy.append(status, heading, description);
    const objectives = document.createElement("details"); objectives.className = "journey-area-objectives";
    const objectiveTitle = document.createElement("summary"); objectiveTitle.textContent = "What we can cover"; objectives.append(objectiveTitle);
    const objectiveList = document.createElement("ul");
    const objective = scenarioLearningObjectives(scenario).find(item => item.id === task.id);
    for (const text of objective?.decisions || []) { const item = document.createElement("li"); item.textContent = text; objectiveList.append(item); }
    objectives.append(objectiveList); copy.append(objectives);
    card.append(copy, button);
    if (learning.evidence.length) {
      const review = document.createElement("details"); review.className = "journey-area-review";
      review.open = readyIds.length > 0;
      const summary = document.createElement("summary"); summary.textContent = "Review what I learned"; review.append(summary);
      review.addEventListener("toggle", () => { selectedReviewArea = review.open ? scenario.id + ":" + task.id : null; status.textContent = areaStatusLabel(areaLearningState(scenario.id, task.id, personaMemoryRecords, reviewedIds, review.open ? [task.id] : []).status); });
      const list = document.createElement("ul");
      for (const memory of learning.evidence) { const item = document.createElement("li"); item.textContent = memory.statement + (memory.status === "conflicting" ? " (needs your decision)" : memory.status === "inferred_pending_confirmation" ? " (needs confirmation)" : ""); list.append(item); }
      review.append(list);
      const actions = document.createElement("div"); actions.className = "journey-area-actions";
      const confirm = document.createElement("button"); confirm.type = "button"; confirm.className = "journey-task-button"; confirm.textContent = "Looks right";
      confirm.disabled = learning.evidence.some(memory => ["conflicting", "inferred_pending_confirmation"].includes(memory.status));
      confirm.addEventListener("click", async () => {
        confirm.disabled = true;
        const userId = cloudUserId;
        const memoryIds = learning.evidence.map(memory => memory.id).filter(Boolean);
        if (!userId || memoryIds.length !== learning.evidence.length) { confirm.disabled = false; return; }
        const { data: confirmed, error } = await supabase.from("synqme_persona_memories")
          .update({ status: "user_confirmed", reviewed_at: new Date().toISOString(), relation: "confirms" })
          .eq("user_id", userId).in("id", memoryIds).in("status", ["user_stated", "user_confirmed"]).select("id");
        if (error || userId !== cloudUserId || confirmed?.length !== memoryIds.length) { confirm.disabled = false; alert("Your memories could not be confirmed. Refresh and try again."); return; }
        personaMemoryRecords = personaMemoryRecords.map(memory => memoryIds.includes(memory.id) ? { ...memory, status: "user_confirmed" } : memory);
        const current = scenarioData(); const ids = [...new Set([...(current.reviewed?.[scenario.id] || []), task.id])];
        const progress = { ...roomJourney.room_progress, [SCENARIO_PROGRESS_KEY]: { ...current, reviewed: { ...(current.reviewed || {}), [scenario.id]: ids } } };
        if (!(await persistRoomJourneyChanges({ room_progress: progress }))) { confirm.disabled = false; alert("Your review could not be saved. Please try again."); return; }
        selectedReviewArea = null; renderScenarioJourney();
      });
      const change = document.createElement("button"); change.type = "button"; change.className = "journey-task-button"; change.textContent = "Change something";
      change.addEventListener("click", async () => {
        selectedReviewArea = null;
        if (!(await startJourneyScenario(scenario, task))) return;
        elements.messageInput.value = "I would like to change what you learned about " + task.title.toLowerCase() + ". ";
        elements.messageInput.dispatchEvent(new Event("input", { bubbles: true })); elements.messageInput.focus();
      });
      const later = document.createElement("button"); later.type = "button"; later.className = "journey-task-button"; later.textContent = "Discuss later"; later.addEventListener("click", () => { review.open = false; });
      actions.append(confirm, change, later); review.append(actions);
      if (confirm.disabled) { const note = document.createElement("p"); note.textContent = "Some details need clarification before this area can be reviewed."; review.append(note); }
      card.append(review);
    }
    tasks.append(card);
  });
  target.append(tasks);
  if (done.includes(scenario.id)) {
    const notice = document.createElement("p"); notice.textContent = "Completed. You can revisit this conversation and update your preferences."; target.append(notice); return;
  }
  if (data.started !== scenario.id) return;
  const startedAt = Date.parse(data.startedAt || "");
  const responses = state.messages.filter((message) => message.role === "user" && Date.parse(message.timestamp || "") >= startedAt && !/^SYNQ\.ME TRAINING SCENARIO:/i.test(message.content || "") && !/^Let's explore .+\. Ask me one question at a time/i.test(message.content || "") && String(message.content || "").trim().length >= 3);
  if (!responses.length) {
    const reminder = document.createElement("p"); reminder.textContent = "Talk about this scenario first, then return here to review what you have covered."; target.append(reminder); return;
  }
  const checklist = document.createElement("fieldset");
  const legend = document.createElement("legend"); legend.textContent = "Ready to finish? Confirm what you have covered together:"; checklist.append(legend);
  scenarioTasks(scenario).forEach(task => {
    const label = document.createElement("label"); const input = document.createElement("input"); input.type = "checkbox"; input.dataset.reviewTask = task.id; input.checked = (data.reviewed?.[scenario.id] || []).includes(task.id);
    label.append(input, document.createTextNode("We have fully covered " + task.title.toLowerCase() + ", or agreed it is not relevant.")); checklist.append(label);
  });
  ["I have explained the behaviour or preferences that matter to me.", "We have discussed relevant boundaries, privacy or safety.", "I have covered when I want my companion to ask, wait or stop, or confirmed that this is not relevant."].forEach((text) => {
    const label = document.createElement("label"); const input = document.createElement("input"); input.type = "checkbox"; input.dataset.reviewSummary = "true";
    label.append(input, document.createTextNode(" " + text)); checklist.append(label);
  });
  const saveReview = document.createElement("button"); saveReview.type = "button"; saveReview.className = "out-of-home-scenario-action"; saveReview.textContent = "Save reviewed areas";
  saveReview.addEventListener("click", async () => {
    saveReview.disabled = true;
    const reviewedIds = [...checklist.querySelectorAll("input[data-review-task]:checked")].map(input => input.dataset.reviewTask);
    const current = scenarioData();
    const progress = { ...roomJourney.room_progress, [SCENARIO_PROGRESS_KEY]: { ...current, reviewed: { ...(current.reviewed || {}), [scenario.id]: reviewedIds } } };
    if (!(await persistRoomJourneyChanges({ room_progress: progress }))) { alert("Your reviewed areas could not be saved. Please try again."); saveReview.disabled = false; return; }
    renderScenarioJourney();
  });
  checklist.append(saveReview);
  const finish = document.createElement("button"); finish.type = "button"; finish.className = "out-of-home-scenario-action"; finish.textContent = "Complete scenario and unlock next"; finish.disabled = true;
  const needsClarification = scenarioTasks(scenario).some(task => areaLearningState(scenario.id, task.id, personaMemoryRecords, data.reviewed?.[scenario.id] || []).status === "needs_clarification");
  if (needsClarification) { const note = document.createElement("p"); note.textContent = "Resolve the areas marked Needs clarification before completing this scenario."; checklist.append(note); }
  checklist.addEventListener("change", () => { finish.disabled = needsClarification || [...checklist.querySelectorAll("input")].some((input) => !input.checked); });
  finish.addEventListener("click", async () => {
    finish.disabled = true;
    const reviewUserId = cloudUserId;
    const review = scenarioReviewRecord({ userId:reviewUserId,scenarioId:scenario.id,startedAt:data.startedAt,
      checks:[...checklist.querySelectorAll("input[data-review-summary]")].map((input) => input.checked),
      reviewedTaskIds:[...checklist.querySelectorAll("input[data-review-task]:checked")].map(input => input.dataset.reviewTask), userTurnCount:responses.length });
    if (!review || !supabase) { finish.disabled=false; return; }
    const { error:reviewError } = await supabase.from("synqme_evaluation_records").upsert(review,{onConflict:"user_id,evaluation_key",ignoreDuplicates:true});
    if (reviewUserId!==cloudUserId) return;
    if (reviewError) { finish.disabled=false; alert("Your scenario review could not be saved. Please try again."); return; }
    const current = scenarioData();
    const next = { ...current, completed: completedScenarioIds([...(current.completed || []), scenario.id]), started: null, reviewed: { ...(current.reviewed || {}), [scenario.id]: scenarioTasks(scenario).map(task => task.id) } };
    const progress = { ...roomJourney.room_progress, [SCENARIO_PROGRESS_KEY]: next };
    const saved = await persistRoomJourneyChanges({ room_progress: progress });
    if (!saved) { finish.disabled = false; alert("Your progress could not be saved. Please try again."); return; }
    selectedJourneyScenario = SCENARIOS.find((item) => !next.completed.includes(item.id))?.id || scenario.id;
    renderScenarioJourney();
  });
  target.append(checklist, finish);
}
function renderSituationPreview(scenario) {
  const section = document.createElement("section"); section.className = "situation-preview";
  const heading = document.createElement("h4"); heading.textContent = "Try a situation";
  const intro = document.createElement("p"); intro.textContent = "Explore how your companion might use what you have taught it. This is a hypothetical preview.";
  const areaLabel = document.createElement("label"); areaLabel.textContent = "Choose an area";
  const select = document.createElement("select"); select.setAttribute("aria-label", "Choose an area for the situation");
  const areas = scenarioTasks(scenario);
  for (const area of areas) { const option = document.createElement("option"); option.value = area.id; option.textContent = area.title; select.append(option); }
  if (simulationSession?.scenarioId === scenario.id && areas.some(area => area.id === simulationSession.areaId)) select.value = simulationSession.areaId;
  areaLabel.append(select);
  const start = document.createElement("button"); start.type = "button"; start.className = "journey-task-button"; start.textContent = "Create a situation";
  const output = document.createElement("div"); output.className = "situation-result"; output.setAttribute("aria-live", "polite");
  if (simulationSession?.scenarioId === scenario.id && simulationSession.loading) start.disabled = true;
  const capabilityLabel = document.createElement("label"); capabilityLabel.textContent = "Compare robot capabilities";
  const capability = document.createElement("select"); capability.setAttribute("aria-label", "Select a task to compare robot capabilities");
  const blank = document.createElement("option"); blank.value = ""; blank.textContent = "Choose a task"; capability.append(blank);
  for (const activity of ACTIVITIES) { const option = document.createElement("option"); option.value = activity.id; option.textContent = activity.label; capability.append(option); }
  const capabilityText = document.createElement("p"); capabilityText.className = "situation-capability";
  const updateCapability = () => { capabilityText.textContent = simulationCapabilitySummary({ functionId: capability.value, manifest: pexiCapabilityManifest, robotType: state.profile.robotType }).text; };
  capability.addEventListener("change", updateCapability); capabilityLabel.append(capability); updateCapability();

  function showResult() {
    output.replaceChildren();
    const current = simulationSession?.scenarioId === scenario.id && simulationSession?.areaId === select.value ? simulationSession : null;
    if (!current) return;
    if (current.loading) { const message = document.createElement("p"); message.textContent = "Preparing your situation…"; output.append(message); return; }
    if (current.error) { const message = document.createElement("p"); message.textContent = current.error; output.append(message); return; }
    if (!current.preview) return;
    const title = document.createElement("strong"); title.textContent = "Imagine this";
    const situation = document.createElement("p"); situation.textContent = current.preview.situation;
    const proposedTitle = document.createElement("strong"); proposedTitle.textContent = selectedCompanionDisplayName() + " might respond";
    const proposed = document.createElement("p"); proposed.textContent = current.preview.proposed_response;
    output.append(title, situation, proposedTitle, proposed);
    if (current.preview.follow_up_question) { const question = document.createElement("p"); question.textContent = current.preview.follow_up_question; output.append(question); }
    const why = document.createElement("details"); const whyTitle = document.createElement("summary"); whyTitle.textContent = "Tell me why"; why.append(whyTitle);
    if (current.preview.sources.length) {
      const explanation = document.createElement("p"); explanation.textContent = "These saved preferences were used for this proposed response:"; why.append(explanation);
      const list = document.createElement("ul");
      current.preview.sources.forEach(source => { const item = document.createElement("li"); item.textContent = source.statement + (source.status === "user_confirmed" ? " (reviewed)" : " (you stated)") + (source.owner_marked_general ? " · General guidance" : "") + (source.conditions?.length ? " · Conditions: " + source.conditions.join(", ") : "") + (source.permission_policy && source.permission_policy !== "unspecified" ? " · Permission: " + source.permission_policy.replaceAll("_", " ") : ""); list.append(item); });
      why.append(list);
    } else { const empty = document.createElement("p"); empty.textContent = "There is no linked saved preference that settles this situation yet."; why.append(empty); }
    output.append(why);
    const feedback = document.createElement("div"); feedback.className = "situation-actions";
    const right = document.createElement("button"); right.type = "button"; right.className = "journey-task-button"; right.textContent = "That's right"; right.disabled = Boolean(current.feedback);
    const different = document.createElement("button"); different.type = "button"; different.className = "journey-task-button"; different.textContent = "I would do it differently";
    const feedbackStatus = document.createElement("p"); feedbackStatus.setAttribute("role", "status");
    if (current.feedback === "agreed") feedbackStatus.textContent = "Your feedback on this situation is saved.";
    right.addEventListener("click", async () => {
      right.disabled = true;
      try { await saveSituationFeedback(current, "agreed"); current.feedback = "agreed"; feedbackStatus.textContent = "Your feedback on this situation is saved."; }
      catch { right.disabled = false; feedbackStatus.textContent = "Feedback could not be saved. Please try again."; }
    });
    different.addEventListener("click", async () => {
      different.disabled = true;
      try { await saveSituationFeedback(current, "different"); } catch { /* The user can still correct their preference in chat. */ }
      const area = areas.find(item => item.id === current.areaId);
      if (!(await startJourneyScenario(scenario, area))) { different.disabled = false; return; }
      elements.messageInput.value = "For the practice situation ‘" + current.preview.situation.slice(0, 550) + "’, I would prefer: ";
      elements.messageInput.dispatchEvent(new Event("input", { bubbles: true })); elements.messageInput.focus();
    });
    feedback.append(right, different); output.append(feedback, feedbackStatus);
  }
  select.addEventListener("change", showResult);
  start.addEventListener("click", async () => {
    const userId = cloudUserId, areaId = select.value;
    if (!userId) return;
    const run = { userId, scenarioId: scenario.id, areaId, loading: true, preview: null, feedback: null, runId: globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2) };
    simulationSession = run; start.disabled = true; showResult();
    try {
      const response = await fetch(API_BASE + "/api/simulation", { method: "POST", headers: await authenticatedApiHeaders(), body: JSON.stringify({ scenarioId: scenario.id, areaId, preferredLanguage: state.profile.preferredLanguage || "en" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The situation could not be prepared.");
      if (simulationSession !== run || cloudUserId !== userId) return;
      run.preview = result;
    } catch (error) { if (simulationSession === run && cloudUserId === userId) run.error = error.message || "The situation could not be prepared."; }
    finally { if (simulationSession === run) { run.loading = false; start.disabled = false; if (output.isConnected) showResult(); else renderScenarioJourney(); } }
  });
  const history = document.createElement("details"); history.className = "situation-history";
  const historyTitle = document.createElement("summary"); historyTitle.textContent = "Past situation feedback"; history.append(historyTitle);
  const historyItems = document.createElement("div"); history.append(historyItems);
  history.addEventListener("toggle", async () => {
    if (!history.open || !cloudUserId) return;
    const userId = cloudUserId; historyItems.textContent = "Loading…";
    try {
      const { data, error } = await supabase.from("synqme_evaluation_records").select("id,checks,created_at").eq("user_id", userId).eq("scope_key", scenario.id)
        .eq("evaluation_kind", "conversation_turn").contains("checks", { event: "hypothetical_situation_feedback" }).order("created_at", { ascending: false }).limit(10);
      if (error || userId !== cloudUserId) throw error || new Error("Account changed.");
      historyItems.replaceChildren();
      if (!data?.length) { const empty = document.createElement("p"); empty.textContent = "Your feedback will appear here after you review a situation."; historyItems.append(empty); return; }
      for (const entry of data) {
        const item = document.createElement("div"); item.className = "situation-history-item";
        const label = document.createElement("strong"); label.textContent = entry.checks?.user_feedback === "agreed" ? "You agreed with this response" : "You wanted a different response";
        const situation = document.createElement("p"); situation.textContent = String(entry.checks?.situation || "").slice(0, 700);
        const response = document.createElement("p"); response.textContent = String(entry.checks?.proposed_response || "").slice(0, 1000);
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "journey-task-button"; remove.textContent = "Remove feedback";
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          const { error } = await supabase.from("synqme_evaluation_records").delete().eq("user_id", userId).eq("id", entry.id);
          if (error || userId !== cloudUserId) { remove.disabled = false; return; }
          item.remove();
          if (!historyItems.children.length) historyItems.textContent = "No saved feedback yet.";
        });
        item.append(label, situation, response, remove); historyItems.append(item);
      }
    } catch { historyItems.textContent = "Past feedback could not be loaded. Try again."; }
  });
  section.append(heading, intro, areaLabel, start, output, capabilityLabel, capabilityText, history);
  showResult(); return section;
}

async function saveSituationFeedback(run, feedback) {
  if (!supabase || !cloudUserId || run.userId !== cloudUserId || !["agreed", "different"].includes(feedback)) throw new Error("Sign in to save feedback.");
  const { error } = await supabase.from("synqme_evaluation_records").upsert({
    user_id: run.userId, evaluation_key: "simulation-feedback:" + run.runId, scope_key: run.scenarioId,
    evaluation_kind: "conversation_turn", origin: "runtime_observation", outcome: "observed",
    checks: { event: "hypothetical_situation_feedback", user_feedback: feedback, area_id: run.areaId,
      situation: String(run.preview?.situation || "").slice(0, 700), proposed_response: String(run.preview?.proposed_response || "").slice(0, 1000),
      evidence_versions: (run.preview?.sources || []).map(source => ({ id: source.id, version: source.rule_version })).slice(0, 8) },
    source_refs: [{ scenario_id: run.scenarioId, area_id: run.areaId }], engine_version: "simulation-preview-v1"
  }, { onConflict: "user_id,evaluation_key", ignoreDuplicates: false });
  if (error) throw error;
}

async function startJourneyScenario(scenario, task = null) {
  if (!roomJourney || roomJourneySaveInFlight) return false;
  const done = completedScenarioIds(scenarioData().completed);
  const currentId = scenarioData().started || "room:" + roomJourney.active_room_id;
  if (currentId !== scenario.id && !done.includes(currentId)) {
    alert("Finish and review the current scenario in Journey before moving to another one. You can pause and return at any time."); return false;
  }
  // Commit the scenario and room focus together so a failed save cannot leave
  // AMÏA working on a different room from the one shown in the journey.
  const patch = buildScenarioStartPatch(scenario, roomJourney.room_progress);
  patch.room_progress[SCENARIO_PROGRESS_KEY].focusStartedAt = new Date().toISOString();
  if (scenario.kind === "room") patch.active_task_id = task?.id || (scenarioData().started === scenario.id ? roomJourney.active_task_id : null);
  if (!(await persistRoomJourneyChanges(patch))) { alert("Your scenario could not be saved. Please try again."); return false; }
  if (scenario.kind === "room") {
    activeOutOfHomeScenarioContext = null;
    state.pendingClarification = null;
    const room = ROOM_JOURNEY_ROOMS.find((item) => item.id === scenario.roomId);
    elements.messageInput.value = task?.prompt || "Let's explore " + room.name + ". Ask me one question at a time about my preferences, relevant boundaries, and when you should ask, wait or stop. This may be a place I visit, not necessarily a room in my home.";
  } else {
    const match = findOutOfHomeScenario(scenario.categoryId, scenario.scenarioId);
    activeOutOfHomeScenarioContext = { categoryId: scenario.categoryId, scenarioId: scenario.scenarioId };
    elements.messageInput.value = buildOutOfHomeScenarioPrompt(match.category, match.scenario) + (task ? "\n\n" + task.prompt : "");
  }
  elements.messageInput.dispatchEvent(new Event("input", { bubbles: true }));
  selectAppView("chat");
  if (elements.chatStage?.hidden) elements.welcomeAudioOffer?.scrollIntoView({ behavior: "smooth", block: "center" });
  else { elements.chatStage?.scrollIntoView({ behavior: "smooth", block: "center" }); elements.messageInput.focus({ preventScroll: true }); }
  renderScenarioJourney();
  return true;
}

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
let homeMemoryIndexUnavailable = false;
let homeMemoryIndexBackfilledUserId = null;
let homeMemoryIndexWarningShown = false;
const PERSONA_MEMORY_SELECT_COLUMNS = "id,user_id,memory_key,source_preference_id,topic,kind,scope_key,statement,status,relation,confidence,conditions,permission_policy,source_refs,rule_version,attributes,search_terms,search_keys,source_message,source_timestamp,source_conversation_key,conflict_group,supersedes_id,reviewed_at,last_used_at,archived_at,created_at,updated_at";
let personaMemoryRecords = [];
let personaMemoryTableUnavailable = false;
let personaMemoryWarningShown = false;
let personaMemoryWriteInFlight = false;
let showArchivedPersonaMemories = false;
let sharedKnowledgeUnavailable = false;
let sharedKnowledgeWarningShown = false;

function isMissingHomeMemoryIndexError(error) {
  const message = String(error?.message || error?.details || error?.code || "");
  return /PGRST205|schema cache|does not exist|could not find the table|permission denied|row-level security|not allowed/i.test(message);
}

async function syncHomeMemoryIndex(messages, { backfill = false } = {}) {
  if (!supabase || !cloudUserId || homeMemoryIndexUnavailable) return false;
  const userId = cloudUserId;
  const allRows = buildHomeMemoryIndexRows(messages, userId);
  if (!allRows.length) return true;

  try {
    let rowsToWrite = allRows.slice(-2);
    const shouldBackfill = backfill && homeMemoryIndexBackfilledUserId !== userId;
    if (shouldBackfill) {
      const existingKeys = new Set();
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase
          .from("synqme_memory_index")
          .select("source_key")
          .eq("user_id", userId)
          .range(offset, offset + 999);
        if (error) throw error;
        for (const row of data || []) {
          if (typeof row.source_key === "string") existingKeys.add(row.source_key);
        }
        if (!data || data.length < 1000) break;
      }
      rowsToWrite = allRows.filter((row) => !existingKeys.has(row.source_key));
    }

    for (let offset = 0; offset < rowsToWrite.length; offset += 100) {
      const { error } = await supabase
        .from("synqme_memory_index")
        .upsert(rowsToWrite.slice(offset, offset + 100), { onConflict: "user_id,source_key" });
      if (error) throw error;
    }
    if (shouldBackfill) homeMemoryIndexBackfilledUserId = userId;
    return true;
  } catch (error) {
    if (isMissingHomeMemoryIndexError(error)) homeMemoryIndexUnavailable = true;
    if (!homeMemoryIndexWarningShown) {
      console.info("SYNQ.ME searchable memory index is unavailable; local transcript search remains active.", error);
      homeMemoryIndexWarningShown = true;
    }
    return false;
  }
}

function activePersonaMemories() {
  return personaMemoryRecords.filter((item) => memoryIsActive(item) && isUsefulStandalonePreference(item.statement));
}

function renderPersonaMemoryLibrary() {
  if (!elements.personaMemoryList) return;
  const active = activePersonaMemories();
  const visible = showArchivedPersonaMemories
    ? personaMemoryRecords
    : active;
  if (elements.personaMemoryCount) {
    elements.personaMemoryCount.textContent = String(showArchivedPersonaMemories ? visible.length : active.length);
  }
  if (elements.toggleArchivedPersonaMemories) {
    elements.toggleArchivedPersonaMemories.innerHTML = showArchivedPersonaMemories
      ? 'Hide superseded and forgotten memories <span>↗</span>'
      : 'Show superseded and forgotten memories <span>↗</span>';
  }
  elements.personaMemoryList.replaceChildren();

  if (personaMemoryTableUnavailable) {
    const p = document.createElement("p");
    p.className = "persona-memory-empty";
    p.textContent = "The memory library needs the latest Supabase migration before structured memories can be saved. Your existing chat and preference storage remain available.";
    elements.personaMemoryList.append(p);
    if (elements.personaMemoryStatus) elements.personaMemoryStatus.textContent = "Memory library unavailable";
    return;
  }
  if (!visible.length) {
    const p = document.createElement("p");
    p.className = "persona-memory-empty";
    p.textContent = active.length
      ? "No superseded or forgotten memories to show."
      : "No structured memories yet. As you share durable preferences, routines and boundaries, AMÏA will save them here.";
    elements.personaMemoryList.append(p);
    if (elements.personaMemoryStatus) elements.personaMemoryStatus.textContent = cloudUserId ? "Private to your account" : "Sign in to manage your memories";
    return;
  }

  const labels = {
    user_stated: "From your words",
    user_confirmed: "Confirmed",
    inferred_pending_confirmation: "Needs confirmation",
    conflicting: "Needs your decision",
    superseded: "Superseded",
    archived: "Forgotten"
  };
  visible.slice(0, 100).forEach((memory) => {
    const entry = document.createElement("article");
    entry.className = "persona-memory-entry" +
      (memory.status === "conflicting" ? " is-conflicting" : "") +
      (memory.status === "inferred_pending_confirmation" ? " is-inferred" : "");
    entry.dataset.memoryId = memory.id;
    const meta = document.createElement("div");
    meta.className = "persona-memory-meta";
    const topic = document.createElement("span");
    topic.className = "persona-memory-topic";
    topic.textContent = String(memory.topic || "general_household").replace(/_/g, " ");
    const status = document.createElement("span");
    status.className = "persona-memory-state" +
      (memory.status === "conflicting" ? " state-conflicting" : "") +
      (memory.status === "user_confirmed" ? " state-confirmed" : "") +
      (memory.status === "inferred_pending_confirmation" ? " state-inferred" : "");
    status.textContent = labels[memory.status] || memory.status || "Saved";
    meta.append(topic, status);
    const statement = document.createElement("p");
    statement.className = "persona-memory-statement";
    statement.textContent = memory.statement;
    entry.append(meta, statement);

    const detail = document.createElement("details");
    detail.className = "persona-memory-detail";
    const summary = document.createElement("summary");
    summary.textContent = "Evidence and conditions";
    detail.append(summary);
    const source = document.createElement("p");
    source.textContent = "Extracted memory summary: " + String(memory.source_message || memory.statement).slice(0, 420);
    detail.append(source);
    if (Array.isArray(memory.conditions) && memory.conditions.length) {
      const heading = document.createElement("p");
      heading.textContent = "Unresolved details or conditions:";
      const list = document.createElement("ul");
      list.className = "persona-memory-conditions";
      memory.conditions.slice(0, 8).forEach((condition) => {
        const li = document.createElement("li");
        li.textContent = String(condition);
        list.append(li);
      });
      detail.append(heading, list);
    }
    if (memory.source_timestamp) {
      const date = document.createElement("p");
      const parsed = Date.parse(memory.source_timestamp);
      date.textContent = "Originated " + (Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString() : "in a previous conversation");
      detail.append(date);
    }
    if (memory.status === "conflicting") {
      const warning = document.createElement("p");
      warning.textContent = "AMÏA has kept this rule separate from another rule that may disagree. Choose the version to keep before treating either as settled.";
      detail.append(warning);
    }
    entry.append(detail);

    if (personaMemoryEditingId === memory.id) {
      const editor = document.createElement("textarea");
      editor.className = "persona-memory-editor";
      editor.maxLength = 420;
      editor.value = memory.statement;
      editor.setAttribute("aria-label", "Edit saved memory");
      entry.append(editor);
    }

    const actions = document.createElement("div");
    actions.className = "persona-memory-actions";
    if (personaMemoryEditingId === memory.id) {
      actions.append(
        createPersonaMemoryButton("save-edit", memory.id, "Save correction", "is-primary"),
        createPersonaMemoryButton("cancel-edit", memory.id, "Cancel")
      );
    } else if (memoryIsActive(memory)) {
      actions.append(createPersonaMemoryButton("edit", memory.id, "Edit memory"));
      if (memory.status === "conflicting") actions.append(createPersonaMemoryButton("keep", memory.id, "Keep this version", "is-primary"));
      actions.append(createPersonaMemoryButton("forget", memory.id, "Forget", "is-danger"));
    } else {
      actions.append(createPersonaMemoryButton("forget-forever", memory.id, "Delete permanently", "is-danger"));
    }
    entry.append(actions);
    elements.personaMemoryList.append(entry);
  });
  if (elements.personaMemoryStatus) {
    const activeCount = active.length;
    const conflictingCount = active.filter((item) => item.status === "conflicting").length;
    elements.personaMemoryStatus.textContent = activeCount + (activeCount === 1 ? " active memory" : " active memories") +
      (conflictingCount ? " · " + conflictingCount + (conflictingCount === 1 ? " needs" : " need") + " your decision" : "") +
      " · private to your account";
  }
}

let personaMemoryEditingId = null;

function createPersonaMemoryButton(action, id, label, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "persona-memory-action" + (extraClass ? " " + extraClass : "");
  button.dataset.memoryAction = action;
  button.dataset.memoryId = id;
  button.textContent = label;
  return button;
}

async function queryPersonaMemoryRecords() {
  if (!supabase || !cloudUserId || personaMemoryTableUnavailable) return [];
  const userId = cloudUserId, rows = [], pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from("synqme_persona_memories").select(PERSONA_MEMORY_SELECT_COLUMNS)
      .eq("user_id", userId).order("updated_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (userId !== cloudUserId) throw new Error("Memory account changed.");
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function backfillPersonaMemoriesFromPreferences() {
  if (!supabase || !cloudUserId || personaMemoryTableUnavailable) return false;
  const rows = activeLegacyPreferences()
    .map((preference) => preferenceToPersonaMemory(preference, cloudUserId))
    .filter(Boolean);
  if (!rows.length) return true;
  const knownSourceIds = new Set(personaMemoryRecords.map((item) => item.source_preference_id).filter(Boolean));
  const knownStatements = new Set(personaMemoryRecords.map((item) => String(item.statement || "").trim().toLowerCase()));
  const missing = rows.filter((row) =>
    (!row.source_preference_id || !knownSourceIds.has(row.source_preference_id)) &&
    !knownStatements.has(String(row.statement).trim().toLowerCase())
  );
  if (!missing.length) return true;
  const { error } = await supabase
    .from("synqme_persona_memories")
    .upsert(missing, { onConflict: "user_id,memory_key", ignoreDuplicates: true });
  if (error) throw error;
  return true;
}

async function loadPersonaMemories({ backfillPreferences = false } = {}) {
  if (!supabase || !cloudUserId || personaMemoryTableUnavailable) {
    renderPersonaMemoryLibrary();
    return false;
  }
  try {
    personaMemoryRecords = await queryPersonaMemoryRecords();
    if (backfillPreferences) {
      await backfillPersonaMemoriesFromPreferences();
      personaMemoryRecords = await queryPersonaMemoryRecords();
    }
    personaMemoryTableUnavailable = false;
    renderPersonaMemoryLibrary();
    return true;
  } catch (error) {
    if (isMissingHomeMemoryIndexError(error)) {
      personaMemoryTableUnavailable = true;
      if (!personaMemoryWarningShown) {
        console.info("SYNQ.ME structured persona memory table is unavailable; current preferences remain available.", error);
        personaMemoryWarningShown = true;
      }
    } else {
      if (elements.personaMemoryStatus) elements.personaMemoryStatus.textContent = "Could not refresh memories. Existing saved memories remain available in this session.";
      console.info("SYNQ.ME could not load structured persona memories.", error);
    }
    renderPersonaMemoryLibrary();
    return false;
  }
}

async function getRelevantPersonaMemories(query) {
  if (!query || personaMemoryTableUnavailable) return [];
  let candidates = personaMemoryRecords;
  if (supabase && cloudUserId && !personaMemoryTableUnavailable) {
    const keys = buildPersonaMemorySearchKeys(query, [], deriveMemoryTopic(query));
    if (keys.length) {
      try {
        const activeStatuses = ["user_stated", "user_confirmed", "inferred_pending_confirmation", "conflicting"];
        let keyRequest = supabase.from("synqme_persona_memories")
          .select(PERSONA_MEMORY_SELECT_COLUMNS).eq("user_id", cloudUserId)
          .overlaps("search_keys", keys).in("status", activeStatuses)
          .order("updated_at", { ascending: false }).limit(80);
        let textRequest = supabase.from("synqme_persona_memories")
          .select(PERSONA_MEMORY_SELECT_COLUMNS).eq("user_id", cloudUserId)
          .in("status", activeStatuses).textSearch("search_document", String(query).slice(0, 320), { type: "websearch", config: "simple" })
          .order("updated_at", { ascending: false }).limit(60);
        if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
          if (typeof keyRequest.abortSignal === "function") keyRequest = keyRequest.abortSignal(AbortSignal.timeout(1200));
          if (typeof textRequest.abortSignal === "function") textRequest = textRequest.abortSignal(AbortSignal.timeout(1200));
        }
        const [keyResult, textResult] = await Promise.allSettled([keyRequest, textRequest]);
        const keyData = keyResult.status === "fulfilled" && !keyResult.value.error && Array.isArray(keyResult.value.data) ? keyResult.value.data : [];
        const textData = textResult.status === "fulfilled" && !textResult.value.error && Array.isArray(textResult.value.data) ? textResult.value.data : [];
        if (!keyData.length && !textData.length && keyResult.status === "rejected" && textResult.status === "rejected") throw keyResult.reason;
        if ((keyResult.status === "rejected" || keyResult.value?.error || textResult.status === "rejected" || textResult.value?.error) && !personaMemoryWarningShown) {
          console.info("SYNQ.ME memory search used available account results.");
          personaMemoryWarningShown = true;
        }

        const byId = new Map();
        for (const item of [...personaMemoryRecords, ...(keyData || []), ...textData]) {
          if (!item || !item.id) continue;
          const previous = byId.get(item.id);
          byId.set(item.id, previous ? { ...previous, ...item } : item);
        }
        candidates = [...byId.values()];
      } catch (error) {
        if (isMissingHomeMemoryIndexError(error)) personaMemoryTableUnavailable = true;
        if (!personaMemoryWarningShown) {
          console.info("SYNQ.ME structured memory retrieval fell back to the local ranked set.", error);
          personaMemoryWarningShown = true;
        }
      }
    }
  }
  return rankPersonaMemories(query, candidates, { limit: 8 });
}

function findLinkedPreference(candidate, userMessage) {
  const possible = state.preferences.filter((item) => item.sourceMessage === userMessage);
  if (!possible.length) return null;
  const candidateWords = new Set(buildPersonaMemorySearchKeys(candidate.statement).filter((key) => key.startsWith("word:")));
  let best = null;
  let bestScore = 0;
  for (const preference of possible) {
    const preferenceWords = new Set(buildPersonaMemorySearchKeys(preference.text).filter((key) => key.startsWith("word:")));
    if (!candidateWords.size || !preferenceWords.size) continue;
    const overlap = [...candidateWords].filter((key) => preferenceWords.has(key)).length;
    const score = overlap / Math.max(1, Math.min(candidateWords.size, preferenceWords.size));
    if (score > bestScore) {
      best = preference;
      bestScore = score;
    }
  }
  return bestScore >= 0.2 ? best : null;
}

async function updatePersonaMemoryRow(id, patch) {
  if (!supabase || !cloudUserId || personaMemoryTableUnavailable) throw new Error("Your saved memory library is not available.");
  const { data, error } = await supabase
    .from("synqme_persona_memories")
    .update({ ...patch, user_id: cloudUserId })
    .eq("user_id", cloudUserId)
    .eq("id", id)
    .select(PERSONA_MEMORY_SELECT_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("That memory could not be updated. Refresh the library and try again.");
  personaMemoryRecords = personaMemoryRecords.map((item) => item.id === id ? data : item);
  renderPersonaMemoryLibrary();
  return data;
}

async function setLinkedPreferenceStatus(preferenceId, status) {
  if (!preferenceId) return;
  let changed = false;
  state.preferences = state.preferences.map((item) => {
    if (String(item.id) !== String(preferenceId)) return item;
    changed = true;
    return { ...item, status, preference_status: status };
  });
  if (!changed) return;
  persist();
  const saved = await flushCloudSave();
  renderAll();
  if (!saved) throw new Error("The associated preference status could not be confirmed as saved.");
}

let memoryQueueRunner = null;
let memoryQueueTimer = null;
let memoryQueueFlushing = false;
const volatileMemoryJobs = new Map();
const memoryQueueLocalKey = (userId, revision) => "synqme-memory-pending:" + userId + ":" + revision;

function pendingMemoryJobs(userId, revision) {
  const key = memoryQueueLocalKey(userId, revision);
  let stored = [];
  try { const value = JSON.parse(localStorage.getItem(key) || "[]"); if (Array.isArray(value)) stored = value; } catch {}
  return [...new Map([...stored, ...(volatileMemoryJobs.get(key) || [])].map(job => [job.source_key, job])).values()];
}
function writePendingMemoryJobs(userId, revision, jobs) {
  const key = memoryQueueLocalKey(userId, revision);
  if (jobs.length) volatileMemoryJobs.set(key, jobs); else volatileMemoryJobs.delete(key);
  try { if (jobs.length) localStorage.setItem(key, JSON.stringify(jobs)); else localStorage.removeItem(key); }
  catch { if (elements.personaMemoryStatus) elements.personaMemoryStatus.textContent = "Memory updates are waiting to sync. Keep this page open until connected."; }
}
function queueStructuredMemoryTurn(userMessage, userTimestamp) {
  if (voiceModeActive && voiceBreakTracker.awaiting() && breakResponse(userMessage) !== 'other') return;
  if (todoCommandForMessage(userMessage)) return;
  const userId = cloudUserId, revision = trainingRevision;
  if (!userId || !supabase || !API_BASE || !userTimestamp || !String(userMessage || "").trim() ||
      SENSITIVE_MEMORY_PATTERN.test(userMessage) || /^SYNQ\.ME TRAINING SCENARIO:/i.test(userMessage) ||
      !["answer", "correction"].includes(conversationIntent(userMessage))) return;
  const index = state.messages.findLastIndex(item => item.role === "user" && item.timestamp === userTimestamp);
  if (index < 0) return;
  const recent = state.messages.slice(Math.max(0, index - 7), index + 1).map((item, itemIndex, items) => ({ role: item.role, content: SENSITIVE_MEMORY_PATTERN.test(String(item.content || "")) ? "[Sensitive content omitted]" : String(item.content || "").slice(0, itemIndex === items.length - 1 ? 12000 : 1200) }));
  const scenarioId = state.messages[index].scenario_id || scenarioData().started || (roomJourney?.active_room_id ? "room:" + roomJourney.active_room_id : null);
  const job = { user_id: userId, source_timestamp: userTimestamp, source_key: memoryJobKey(userTimestamp, userMessage), user_message: userMessage.slice(0, 1600), messages: recent, scenario_id: scenarioForId(scenarioId) ? scenarioId : null };
  try {
    const jobs = pendingMemoryJobs(userId, revision);
    if (!jobs.some(item => item.source_key === job.source_key)) jobs.push(job);
    writePendingMemoryJobs(userId, revision, jobs);
  } catch (error) {
    if (elements.personaMemoryStatus) elements.personaMemoryStatus.textContent = "Memory update is waiting for a connection. Your conversation remains available.";
  }
  void flushMemoryQueue(userId, revision);
}
async function flushMemoryQueue(userId = cloudUserId, revision = trainingRevision) {
  if (!userId || userId !== cloudUserId || revision !== trainingRevision || !supabase || memoryQueueFlushing) return;
  memoryQueueFlushing = true;
  try {
    for (const job of pendingMemoryJobs(userId, revision)) {
      if (userId !== cloudUserId || revision !== trainingRevision) return;
      const { error } = await supabase.from("synqme_memory_jobs").upsert(job, { onConflict: "user_id,source_key", ignoreDuplicates: true });
      if (error) throw error;
      // Re-read so another message queued during the request is not lost.
      writePendingMemoryJobs(userId, revision, pendingMemoryJobs(userId, revision).filter(item => item.source_key !== job.source_key));
    }
    if (userId === cloudUserId && revision === trainingRevision) {
      if (!memoryQueueRunner) memoryQueueRunner = createMemoryJobRunner({
        claim: async () => {
          if (userId !== cloudUserId || revision !== trainingRevision) return null;
          const { data, error } = await supabase.rpc("synqme_claim_memory_job");
          if (error) throw error;
          return Array.isArray(data) ? data[0] || null : data || null;
        },
        process: async job => processStructuredMemoryJob(job),
        complete: async job => {
          const { data, error } = await supabase.from("synqme_memory_jobs").update({ status: "done", messages: [], user_message: "", lease_until: null, lease_token: null, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", job.id).eq("lease_token", job.lease_token).select("id").maybeSingle();
          if (error || !data) throw error || new Error("Memory job lease expired.");
        },
        retry: async job => {
          if (userId !== cloudUserId || revision !== trainingRevision) return;
          const { error } = await supabase.from("synqme_memory_jobs").update({ status: "pending", available_at: new Date(Date.now() + memoryRetryDelaySeconds(job.attempts) * 1000).toISOString(), lease_until: null, lease_token: null, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", job.id).eq("lease_token", job.lease_token);
          if (error) throw error;
        }
      });
      await memoryQueueRunner.drain();
    }
  } catch (error) {
    console.info("SYNQ.ME memory queue will retry.", String(error?.code || error?.message || "storage unavailable").slice(0, 120));
    if (elements.personaMemoryStatus) elements.personaMemoryStatus.textContent = "Memory updates are waiting to sync and will retry automatically.";
  } finally { memoryQueueFlushing = false; }
}
function startMemoryQueue() {
  // A reset invalidates old local pending copies; the database kept only jobs
  // whose source turn survived that reset.
  const prefix = "synqme-memory-pending:" + cloudUserId + ":";
  const currentKey = memoryQueueLocalKey(cloudUserId, trainingRevision);
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const key = localStorage.key(i); if (key?.startsWith(prefix) && key !== currentKey) localStorage.removeItem(key); } } catch {}
  for (const key of volatileMemoryJobs.keys()) if (key.startsWith(prefix) && key !== currentKey) volatileMemoryJobs.delete(key);
  if (memoryQueueTimer) clearInterval(memoryQueueTimer);
  memoryQueueRunner = null;
  void flushMemoryQueue();
  memoryQueueTimer = setInterval(() => { if (document.visibilityState === "visible") void flushMemoryQueue(); }, 15000);
}

async function processStructuredMemoryJob(job) {
  const memoryUserId = job.user_id;
  const userMessage = job.messages?.at(-1)?.role === "user" ? job.messages.at(-1).content : job.user_message;
  const userTimestamp = job.source_timestamp;
  if (!memoryUserId || memoryUserId !== cloudUserId) throw new Error("Memory account changed.");
  personaMemoryWriteInFlight = true;
  if (elements.personaMemoryStatus) elements.personaMemoryStatus.textContent = "Updating your personal memory…";
  try {
    // Recover a queued turn if the originating device closed before its cloud
    // conversation save completed. Do not clear the job until that save succeeds.
    if (!state.messages.some(item => item.role === "user" && Date.parse(item.timestamp || "") === Date.parse(userTimestamp) && item.content === userMessage)) {
      state.messages.push({ role: "user", content: userMessage, timestamp: new Date(userTimestamp).toISOString(), ...(scenarioForId(job.scenario_id) ? { scenario_id: job.scenario_id } : {}) });
      persist(); renderAll();
    }
    if (!(await flushCloudSave())) throw new Error("Conversation has not synced yet.");
    if (memoryUserId !== cloudUserId) throw new Error("Memory account changed.");
    const recent = job.messages;
    if (!Array.isArray(recent) || !recent.length || recent[recent.length - 1].role !== "user") throw new Error("Memory source is unavailable.");
    const existingMemories = activePersonaMemories().slice(0, 20).map((item) => ({
      memory_key: item.memory_key,
      topic: item.topic,
      kind: item.kind,
      scope_key: item.scope_key,
      statement: item.statement,
      status: item.status,
      conditions: item.conditions
    }));
    const response = await fetch(API_BASE + "/api/memory/extract", {
      method: "POST",
      headers: await authenticatedApiHeaders(),
      body: JSON.stringify({ messages: recent, existingMemories, scenarioId: job.scenario_id })
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (memoryUserId !== cloudUserId) throw new Error("Memory account changed.");
    if (!response.ok || String(data.provider || "").toLowerCase() !== "deepseek") {
      throw new Error(String(data.error || "DeepSeek memory extraction did not complete."));
    }
    const candidates = (Array.isArray(data.memories) ? data.memories : [])
      .map(cleanPersonaMemoryCandidate).filter(Boolean).slice(0, 8);
    for (const candidate of candidates) {
      if (memoryUserId !== cloudUserId) throw new Error("Memory account changed.");
      const target = personaMemoryRecords.find((item) =>
        (candidate.target_memory_key && item.memory_key === candidate.target_memory_key) ||
        (candidate.scope_key && item.scope_key === candidate.scope_key && memoryIsActive(item) && !item.attributes?.pending_replaces)
      );
      if (candidate.relation === "no_change") continue;
      if (candidate.relation === "confirms" && target) {
        await updatePersonaMemoryRow(target.id, {
          status: "user_confirmed",
          confidence: Math.max(Number(target.confidence) || 0, candidate.confidence),
          reviewed_at: new Date().toISOString(),
          relation: "confirms",
          source_refs: ruleSourceReferences(target.source_refs,userTimestamp)
        });
        continue;
      }
      if (candidate.relation === "withdraws") {
        if (target) {
          await updatePersonaMemoryRow(target.id, {
            status: "archived",
            archived_at: new Date().toISOString(),
            reviewed_at: new Date().toISOString(),
            relation: "withdraws"
          });
          // Keep the user from having a withdrawn rule silently reappear through
          // the legacy-preference backfill path at their next sign-in.
          await setLinkedPreferenceStatus(target.source_preference_id, "rejected");
        }
        continue;
      }
      let status = candidate.status;
      let supersedesId = null;
      if (target && candidate.relation === "updates") {
        // A conversational correction is a proposal until the owner reviews it.
        const row = {
          user_id: memoryUserId, memory_key: makePersonaMemoryKey('revision ' + target.id + ' ' + candidate.statement),
          source_preference_id: null, topic: target.topic, kind: target.kind, scope_key: target.scope_key,
          statement: candidate.statement, status: 'inferred_pending_confirmation', relation: 'updates',
          confidence: candidate.confidence, conditions: [...new Set([...(target.conditions || []), ...(candidate.conditions || [])])].slice(0, 8),
          permission_policy: 'unspecified', source_refs: ruleSourceReferences([], userTimestamp),
          attributes: { ...(target.attributes || {}), pending_replaces: target.id, pending_target_updated_at: target.updated_at || null },
          search_terms: candidate.search_terms, search_keys: buildPersonaMemorySearchKeys(candidate.statement, candidate.search_terms, target.topic),
          source_message: candidate.statement, source_timestamp: userTimestamp || new Date().toISOString(), source_conversation_key: 'main'
        };
        const { error } = await supabase.from('synqme_persona_memories').upsert(row, { onConflict: 'user_id,memory_key', ignoreDuplicates: true });
        if (error) throw error;
        continue;
      } else if (target && candidate.relation === "conflicts") {
        await updatePersonaMemoryRow(target.id, {
          status: "conflicting",
          conflict_group: candidate.scope_key,
          relation: "conflicts"
        });
        status = "conflicting";
      }
      const linkedPreference = findLinkedPreference(candidate, userMessage);
      const memoryKey = linkedPreference
        ? "preference-" + String(linkedPreference.id)
        : makePersonaMemoryKey(candidate.statement);
      const sameRecord = personaMemoryRecords.find((item) =>
        item.memory_key === memoryKey ||
        (item.statement?.trim().toLowerCase() === candidate.statement.trim().toLowerCase() && item.scope_key === candidate.scope_key && memoryIsActive(item))
      );
      if (sameRecord?.status === "user_confirmed" && candidate.relation === "new" && sameRecord.statement?.trim().toLowerCase() === candidate.statement.trim().toLowerCase()) status = "user_confirmed";
      const row = {
        user_id: memoryUserId,
        memory_key: sameRecord?.memory_key || memoryKey,
        source_preference_id: linkedPreference ? String(linkedPreference.id) : sameRecord?.source_preference_id || null,
        topic: candidate.topic,
        kind: candidate.kind,
        scope_key: candidate.scope_key,
        statement: candidate.statement,
        status,
        relation: candidate.relation,
        confidence: candidate.confidence,
        conditions: candidate.conditions,
        permission_policy: candidate.permission_policy,
        source_refs: ruleSourceReferences(sameRecord?.source_refs,userTimestamp),
        attributes: { ...(candidate.attributes || {}), scenario_id: job.scenario_id || null },
        search_terms: candidate.search_terms,
        search_keys: buildPersonaMemorySearchKeys(candidate.statement, candidate.search_terms, candidate.topic),
        source_message: candidate.statement,
        source_timestamp: userTimestamp || new Date().toISOString(),
        source_conversation_key: "main",
        conflict_group: status === "conflicting" ? candidate.scope_key : null,
        supersedes_id: supersedesId,
        archived_at: null,
        reviewed_at: status === "user_confirmed" ? new Date().toISOString() : null
      };
      const { error } = await supabase
        .from("synqme_persona_memories")
        .upsert(row, { onConflict: "user_id,memory_key" });
      if (error) throw error;
    }

    if (memoryUserId !== cloudUserId) throw new Error("Memory account changed.");
    personaMemoryRecords = await queryPersonaMemoryRecords();
    await backfillPersonaMemoriesFromPreferences();
    const refreshedMemories = await queryPersonaMemoryRecords();
    if (memoryUserId !== cloudUserId) throw new Error("Memory account changed.");
    personaMemoryRecords = refreshedMemories;
    renderPersonaMemoryLibrary();
    renderScenarioJourney();
    if (candidates.length && elements.personaMemoryStatus) {
      elements.personaMemoryStatus.textContent = "Saved " + candidates.length + (candidates.length === 1 ? " memory." : " memories.") + " You can edit or forget them here.";
    }
  } catch (error) {
    console.info("SYNQ.ME could not update structured persona memory this turn.", error);
    if (elements.personaMemoryStatus) elements.personaMemoryStatus.textContent = "Memory updates will retry automatically when connected.";
    throw error;
  } finally {
    personaMemoryWriteInFlight = false;
  }
}

async function handlePersonaMemoryAction(event) {
  const button = event.target.closest("button[data-memory-action]");
  if (!button || !elements.personaMemoryList) return;
  const action = button.dataset.memoryAction;
  const id = button.dataset.memoryId;
  const memory = personaMemoryRecords.find((item) => item.id === id);
  if (!memory) return;

  if (action === "edit") {
    personaMemoryEditingId = id;
    renderPersonaMemoryLibrary();
    elements.personaMemoryList.querySelector("textarea.persona-memory-editor")?.focus();
    return;
  }
  if (action === "cancel-edit") {
    personaMemoryEditingId = null;
    renderPersonaMemoryLibrary();
    return;
  }
  if (action === "save-edit") {
    const editor = elements.personaMemoryList.querySelector('[data-memory-id="' + CSS.escape(id) + '"] textarea.persona-memory-editor');
    const statement = String(editor?.value || "").trim().replace(/\s+/g, " ").slice(0, 420);
    if (statement.length < 8) {
      if (elements.personaMemoryStatus) elements.personaMemoryStatus.textContent = "Please enter a little more detail before saving.";
      return;
    }
    button.disabled = true;
    try {
      const topic = deriveMemoryTopic(statement);
      const kind = deriveMemoryKind(statement);
      await updatePersonaMemoryRow(id, {
        statement,
        topic,
        kind,
        scope_key: deriveMemoryScopeKey(statement, topic, kind),
        search_terms: [],
        search_keys: buildPersonaMemorySearchKeys(statement, [], topic),
        status: memory.status === "conflicting" ? "conflicting" : "user_confirmed",
        confidence: memory.status === "conflicting" ? memory.confidence : 0.98,
        reviewed_at: new Date().toISOString()
      });
      if (memory.source_preference_id) {
        const { error } = await supabase.from("synqme_preferences").update({ preference_text: statement, normalised_text: statement.toLowerCase().slice(0,240) }).eq("user_id",cloudUserId).eq("id",memory.source_preference_id);
        if (error) throw error;
        state.preferences = state.preferences.map((item) => String(item.id) === String(memory.source_preference_id)
          ? { ...item, text: statement, normalised: statement.toLowerCase(), status: "user_confirmed" }
          : item);
        persist();
        void flushCloudSave();
      }
      personaMemoryEditingId = null;
      renderAll();
      if (elements.personaMemoryStatus) elements.personaMemoryStatus.textContent = "Memory updated and confirmed.";
    } catch (error) {
      if (elements.personaMemoryStatus) elements.personaMemoryStatus.textContent = String(error?.message || "Could not update that memory.");
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (action === "keep") {
    button.disabled = true;
    try {
      const group = memory.conflict_group || memory.scope_key;
      const siblingIds = personaMemoryRecords.filter((item) => item.id !== id &&
        item.status === "conflicting" && (item.conflict_group === group || item.scope_key === memory.scope_key)).map((item) => item.id);
      for (const siblingId of siblingIds) {
        const sibling = personaMemoryRecords.find((item) => item.id === siblingId);
        await updatePersonaMemoryRow(siblingId, {
          status: "superseded",
          archived_at: new Date().toISOString(),
          reviewed_at: new Date().toISOString()
        });
        await setLinkedPreferenceStatus(sibling?.source_preference_id, "superseded");
      }
      await updatePersonaMemoryRow(id, {
        status: "user_confirmed",
        relation: "confirms",
        confidence: 0.98,
        conflict_group: null,
        reviewed_at: new Date().toISOString(),
        archived_at: null
      });
      await setLinkedPreferenceStatus(memory.source_preference_id, "user_confirmed");
      if (elements.personaMemoryStatus) elements.personaMemoryStatus.textContent = "Preference confirmed. Conflicting alternatives have been moved to the archived section.";
    } catch (error) {
      if (elements.personaMemoryStatus) elements.personaMemoryStatus.textContent = String(error?.message || "Could not resolve that conflict.");
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (action === "forget") {
    if (!window.confirm("Forget this saved memory? It will stop being used as a structured preference. The original conversation remains in your chat history.")) return;
    button.disabled = true;
    try {
      await updatePersonaMemoryRow(id, {
        status: "archived",
        archived_at: new Date().toISOString(),
        reviewed_at: new Date().toISOString()
      });
      if (memory.source_preference_id) {
        state.preferences = state.preferences.filter((item) => String(item.id) !== String(memory.source_preference_id));
        const { error } = await supabase.from("synqme_preferences").delete()
          .eq("user_id", cloudUserId).eq("id", memory.source_preference_id);
        if (error) throw error;
        persist();
        void flushCloudSave();
      }
      renderAll();
      if (elements.personaMemoryStatus) elements.personaMemoryStatus.textContent = "Forgotten. This memory is excluded from structured memory retrieval; the original chat remains in history.";
    } catch (error) {
      if (elements.personaMemoryStatus) elements.personaMemoryStatus.textContent = String(error?.message || "Could not forget that memory.");
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (action === "forget-forever") {
    if (!window.confirm("Permanently delete this archived memory record? This cannot be undone.")) return;
    button.disabled = true;
    try {
      const { error } = await supabase.from("synqme_persona_memories").delete()
        .eq("user_id", cloudUserId).eq("id", id);
      if (error) throw error;
      personaMemoryRecords = personaMemoryRecords.filter((item) => item.id !== id);
      renderPersonaMemoryLibrary();
      if (elements.personaMemoryStatus) elements.personaMemoryStatus.textContent = "Archived memory record deleted.";
    } catch (error) {
      if (elements.personaMemoryStatus) elements.personaMemoryStatus.textContent = String(error?.message || "Could not delete that record.");
    } finally {
      button.disabled = false;
    }
  }
}

async function getHomeMemoryReferences(query) {
  const historicalMessages = state.messages.slice(0, -1);
  const localMatches = rankHomeMemoryCandidates(query, historicalMessages, { limit: 6 });
  if (!supabase || !cloudUserId || homeMemoryIndexUnavailable) return localMatches;
  const searchKeys = extractHomeMemoryKeys(query);
  if (!searchKeys.length) return localMatches;

  try {
    let request = supabase
      .from("synqme_memory_index")
      .select("role,content,message_timestamp,topics,search_keys")
      .eq("user_id", cloudUserId)
      .overlaps("search_keys", searchKeys)
      .order("message_timestamp", { ascending: false, nullsFirst: false })
      .limit(60);
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      request = request.abortSignal(AbortSignal.timeout(1200));
    }
    const { data, error } = await request;
    if (error) throw error;
    if (!Array.isArray(data) || !data.length) return localMatches;
    homeMemoryIndexUnavailable = false;
    const retrieved = rankHomeMemoryCandidates(query, data.map((row) => ({
      role: row.role,
      content: row.content,
      timestamp: row.message_timestamp,
      topics: row.topics,
      search_keys: row.search_keys
    })), { limit: 6 });
    return rankHomeMemoryCandidates(query, [...retrieved, ...localMatches], { limit: 6 });
  } catch (error) {
    if (isMissingHomeMemoryIndexError(error)) homeMemoryIndexUnavailable = true;
    if (!homeMemoryIndexWarningShown) {
      console.info("SYNQ.ME could not query the home memory index; using the local conversation index.", error);
      homeMemoryIndexWarningShown = true;
    }
    return localMatches;
  }
}



const SHARED_KNOWLEDGE_COLUMNS = "id,category,prompt_pattern,answer_pattern,general_principle,context_tags,key_terms,applicability,limitations,quality_score,evidence_count";

async function getSharedKnowledgeReferences(query) {
  if (!supabase || !cloudUserId || sharedKnowledgeUnavailable) return [];
  const tags = extractHomeMemoryTopics(query).slice(0, 12);
  const terms = extractHomeMemoryKeys(query)
    .filter((key) => key.startsWith("word:"))
    .map((key) => key.slice(5))
    .slice(0, 24);
  if (!tags.length && !terms.length) return [];

  try {
    const requests = [];
    if (tags.length) {
      requests.push(supabase
        .from("synqme_shared_knowledge")
        .select(SHARED_KNOWLEDGE_COLUMNS)
        .eq("status", "approved")
        .overlaps("context_tags", tags)
        .order("quality_score", { ascending: false })
        .limit(8));
    }
    if (terms.length) {
      requests.push(supabase
        .from("synqme_shared_knowledge")
        .select(SHARED_KNOWLEDGE_COLUMNS)
        .eq("status", "approved")
        .overlaps("key_terms", terms)
        .order("quality_score", { ascending: false })
        .limit(8));
    }

    const results = await Promise.all(requests);
    const byId = new Map();
    for (const result of results) {
      if (result.error) throw result.error;
      for (const item of result.data || []) {
        if (!byId.has(item.id)) byId.set(item.id, item);
      }
    }
    const scored = [...byId.values()].map((item) => {
      const itemTags = Array.isArray(item.context_tags) ? item.context_tags : [];
      const itemTerms = Array.isArray(item.key_terms) ? item.key_terms : [];
      const tagHits = tags.filter((tag) => itemTags.includes(tag)).length;
      const termHits = terms.filter((term) => itemTerms.includes(term)).length;
      return {
        item,
        score: tagHits * 5 + termHits + Number(item.quality_score || 0) * 2 + Math.min(Number(item.evidence_count || 0), 10) * 0.1
      };
    }).sort((a, b) => b.score - a.score);

    return scored.slice(0, 6).map(({ item }) => ({
      category: item.category,
      prompt_pattern: item.prompt_pattern,
      answer_pattern: item.answer_pattern,
      general_principle: item.general_principle,
      context_tags: (item.context_tags || []).slice(0, 8),
      applicability: item.applicability || {},
      limitations: (item.limitations || []).slice(0, 5),
      quality_score: Number(item.quality_score || 0),
      evidence_count: Number(item.evidence_count || 0)
    }));
  } catch (error) {
    if (isMissingHomeMemoryIndexError(error)) sharedKnowledgeUnavailable = true;
    if (!sharedKnowledgeWarningShown) {
      console.info("SYNQ.ME shared knowledge lookup is unavailable; continuing with private persona memory.", String(error?.code || error?.message || "unknown error").slice(0, 120));
      sharedKnowledgeWarningShown = true;
    }
    return [];
  }
}

async function contributeSharedKnowledgeFromTurn() {
  if (
    !supabase ||
    !cloudUserId ||
    cloudMode !== "cloud" ||
    !API_BASE ||
    state.profile.shareAnonymizedLearning !== true ||
    !state.profile.shareLearningConsentAt
  ) return false;

  const messages = state.messages.slice(-6)
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .map((item) => ({ role: item.role, content: item.content.slice(0, 1000) }));
  if (!messages.some((item) => item.role === "user") || messages[messages.length - 1]?.role !== "assistant") return false;

  try {
    const response = await fetch(API_BASE + "/api/knowledge/extract", {
      method: "POST",
      headers: await authenticatedApiHeaders(),
      body: JSON.stringify({ messages, scenario_id: scenarioData().started || (roomJourney?.active_room_id ? "room:" + roomJourney.active_room_id : null) })
    });
    if (!response.ok) return false;
    const payload = await response.json();
    const candidate = payload?.candidate;
    if (!candidate || candidate.eligible !== true || !candidate.fingerprint) return false;

    const { error } = await supabase.from("synqme_knowledge_candidates").insert({
      user_id: cloudUserId,
      scenario_id: candidate.scenario_id, candidate_kind: candidate.candidate_kind,
      category: candidate.category,
      prompt_pattern: candidate.prompt_pattern,
      answer_pattern: candidate.answer_pattern,
      general_principle: candidate.general_principle,
      context_tags: candidate.context_tags,
      key_terms: candidate.key_terms,
      applicability: candidate.applicability,
      limitations: candidate.limitations,
      fingerprint: candidate.fingerprint,
      redaction_version: "v1",
      consent_at: state.profile.shareLearningConsentAt,
      status: "pending_review"
    });
    if (error && error.code !== "23505") throw error;
    return true;
  } catch (error) {
    // Never log the extracted text or raw conversation in the client console.
    console.info("SYNQ.ME shared learning contribution was not saved.", String(error?.code || error?.message || "unknown error").slice(0, 120));
    return false;
  }
}

async function deletePendingSharedKnowledgeCandidates() {
  if (!supabase || !cloudUserId) return false;
  try {
    const { error } = await supabase
      .from("synqme_knowledge_candidates")
      .delete()
      .eq("user_id", cloudUserId)
      .eq("status", "pending_review");
    if (error) throw error;
    return true;
  } catch (error) {
    console.info("SYNQ.ME could not remove pending shared-learning contributions.", String(error?.code || error?.message || "unknown error").slice(0, 120));
    return false;
  }
}

function persist(syncCloud = true) {
  const scope = scenarioData().started || (roomJourney?.active_room_id ? "room:" + roomJourney.active_room_id : null);
  if (scope) state.messages = state.messages.map(message => !message.scenario_id && Date.parse(message.timestamp || "") >= trainingSessionStartedAt ? { ...message, scenario_id: scope } : message);
  let localSaved = false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      messages: state.messages.filter(item=>item.transcript_final!==false).slice(-5000),
      preferences: state.preferences,
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

async function loadAllCloudPreferences(userId) {
  const data = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await supabase.from("synqme_preferences").select("id,category,preference_text,normalised_text,preference_status,explicit_facets,unresolved_fields,source_message,created_at,schema_version,clarifications").eq("user_id", userId).order("created_at", { ascending: false }).order("id").range(offset, offset + 999);
    if (result.error) return { data: null, error: result.error };
    data.push(...(result.data || []));
    if ((result.data || []).length < 1000) return { data, error: null };
  }
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

  const avatarRevisionAtSave = ownerAvatarRevision;
  const avatarDataAtSave = ownerAvatarData;
  const includeAvatarSync = ownerAvatarNeedsCloudSync;
  const profileRecord = {
    user_id: cloudUserId,
    owner_name: snapshot.profile.ownerName,
    future_robot_name: snapshot.profile.robotName,
    future_robot_type: snapshot.profile.robotType,
    future_robot_voice: normaliseVoicePreference(snapshot.profile.robotVoice),
    preferred_language: snapshot.profile.preferredLanguage || "en",
    confirm_actions: snapshot.profile.confirmActions,
    share_anonymized_learning: snapshot.profile.shareAnonymizedLearning === true,
    share_learning_consent_at: snapshot.profile.shareLearningConsentAt || null,
    domestic_functions: snapshot.functions,
    updated_at: new Date().toISOString()
  };
  if (includeAvatarSync) {
    profileRecord.owner_avatar_data = avatarDataAtSave || null;
    profileRecord.owner_avatar_synced = true;
  }
  const { error: profileError } = await supabase.from("synqme_profiles").upsert(
    profileRecord,
    { onConflict: "user_id" }
  );
  if (profileError) throw profileError;
  if (includeAvatarSync && avatarRevisionAtSave === ownerAvatarRevision) {
    ownerAvatarNeedsCloudSync = false;
  } else if (includeAvatarSync) {
    scheduleCloudSave(0);
  }

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

  // Missing entries in a local snapshot are not deletion requests. Explicit
  // edit/forget/reset actions update their own account-scoped rows.

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
    state.messages = [...mergedMessages,...state.messages.filter(item=>item.transcript_final===false)];
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
  // The transcript row is the active thread; this separate archive keeps messages
  // searchable even when the active transcript later rolls past its retention cap.
  await syncHomeMemoryIndex(mergedMessages.slice(-2));

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
    voiceModeActive ||
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
      loadAllCloudPreferences(userIdAtStart)
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
      if (remoteProfile.owner_avatar_synced) {
        const remoteAvatar = typeof remoteProfile.owner_avatar_data === "string" ? remoteProfile.owner_avatar_data : "";
        if (remoteAvatar !== ownerAvatarData) {
          ownerAvatarData = remoteAvatar;
          saveOwnerAvatar();
          renderOwnerAvatarPreview();
          renderMessages();
          profileChanged = true;
        }
        ownerAvatarNeedsCloudSync = false;
      } else if (ownerAvatarData) {
        ownerAvatarNeedsCloudSync = true;
      }
      const nextProfile = {
        ownerName: remoteProfile.owner_name || "",
        robotName: remoteProfile.future_robot_name || "",
        robotType: remoteProfile.future_robot_type || "Humanoid robot",
        robotVoice: normaliseVoicePreference(remoteProfile.future_robot_voice),
        preferredLanguage: remoteProfile.preferred_language || "en",
        confirmActions: Boolean(remoteProfile.confirm_actions),
        shareAnonymizedLearning: Boolean(remoteProfile.share_anonymized_learning),
        shareLearningConsentAt: remoteProfile.share_learning_consent_at || null
      };
      languageChanged = nextProfile.preferredLanguage !== state.profile.preferredLanguage;
      profileChanged = profileChanged || JSON.stringify(nextProfile) !== JSON.stringify(state.profile);
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
    messages: state.messages.filter(item=>item.transcript_final!==false).slice(-5000),
    preferences: state.preferences.map((item) => ({ ...item })),
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
  base.messages = messages.length ? messages : [{ role: "assistant", content: WELCOME, timestamp: new Date().toISOString() }];
  base.preferences = Array.isArray(snapshot.preferences)
    ? snapshot.preferences.map((item) => typeof item === "string" ? cleanPreference(item) : cleanPreference(item?.text, item)).filter(Boolean)
    : [];
  base.profile = { ...defaultProfile(), ...(snapshot.profile && typeof snapshot.profile === "object" ? snapshot.profile : {}) };
  base.messages = personaliseWelcomeMessages(base.messages, base.profile);
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
  const key = (item) => item.role + "\n" + (item.voice_turn_id || item.timestamp || item.content);
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
  const fillMissingTimestamps = (target, source, targetStart, sourceStart, count) => {
    for (let offset = 0; offset < count; offset++) {
      const targetIndex = targetStart + offset;
      const sourceIndex = sourceStart + offset;
      if (target[targetIndex] && source[sourceIndex] && key(target[targetIndex]) === key(source[sourceIndex])) target[targetIndex] = preferTranscriptTurn(target[targetIndex],source[sourceIndex]);
      if (target[targetIndex] && source[sourceIndex] && key(target[targetIndex]) === key(source[sourceIndex]) &&
          !target[targetIndex].scenario_id && SCENARIOS.some(scenario => scenario.id === source[sourceIndex].scenario_id)) {
        target[targetIndex] = { ...target[targetIndex], scenario_id: source[sourceIndex].scenario_id };
      }
      if (
        target[targetIndex] &&
        source[sourceIndex] &&
        key(target[targetIndex]) === key(source[sourceIndex]) &&
        !target[targetIndex].timestamp &&
        source[sourceIndex].timestamp
      ) {
        target[targetIndex] = { ...target[targetIndex], timestamp: source[sourceIndex].timestamp };
      }
    }
  };

  for (const group of groups) {
    const incoming = coalesceTranscriptTurns(Array.isArray(group) ? group : [])
      .map(sanitiseConversationMessage)
      .filter((item) => item && item.content.trim())
      .map((item) => ({ ...item, role: item.role, content: item.content.trim(), timestamp: normaliseMessageTimestamp(item), ...(SCENARIOS.some(scenario => scenario.id === item.scenario_id) ? { scenario_id: item.scenario_id } : {}) }));
    if (!incoming.length) continue;
    if (!messages.length) {
      messages = incoming;
      continue;
    }

    // If one complete snapshot is contained in the other, keep the superset.
    const incomingInMessages = sequenceIndex(messages, incoming);
    if (incomingInMessages >= 0) {
      fillMissingTimestamps(messages, incoming, incomingInMessages, 0, incoming.length);
      continue;
    }
    const messagesInIncoming = sequenceIndex(incoming, messages);
    if (messagesInIncoming >= 0) {
      fillMissingTimestamps(incoming, messages, messagesInIncoming, 0, messages.length);
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
      fillMissingTimestamps(messages, incoming, 0, 0, commonPrefix);
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
      fillMissingTimestamps(messages, incoming, messages.length - overlap, 0, overlap);
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
      fillMissingTimestamps(messages, incoming, 0, incoming.length - prefixOverlap, prefixOverlap);
      messages = [...incoming.slice(0, incoming.length - prefixOverlap), ...messages];
      continue;
    }

    messages.push(...incoming);
  }
  return coalesceTranscriptTurns(messages.length ? messages : [{ role: "assistant", content: WELCOME, timestamp: new Date().toISOString() }]).slice(-5000);
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
  return [...unique.values()];
}

function setAuthGateVisible(visible) {
  if (elements.authGate) elements.authGate.hidden = !visible;
  document.body.classList.toggle("auth-required", Boolean(visible));
  if (visible) window.setTimeout(() => elements.authEmail?.focus(), 0);
}

const authTurnstile = Capacitor.isNativePlatform()
  ? createMobileAuthTurnstile({ container: document.querySelector("#authTurnstile") })
  : createAuthTurnstile({
      siteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
      container: document.querySelector("#authTurnstile")
    });
authTurnstile.setMode("signin");

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
  if (elements.authEmail) {
    elements.authEmail.hidden = isRecovery;
    elements.authEmail.required = !isRecovery;
  }
  if (elements.authEmailLabel) elements.authEmailLabel.hidden = isRecovery;
  if (elements.authPasswordLabel) elements.authPasswordLabel.textContent = isRecovery ? "New password" : "Password";
  if (elements.authPassword) {
    elements.authPassword.type = "password";
    if (elements.authPasswordToggle) {
      elements.authPasswordToggle.setAttribute("aria-pressed", "false");
      elements.authPasswordToggle.setAttribute("aria-label", "Show password");
    }
    elements.authPassword.autocomplete = isSignup || isRecovery ? "new-password" : "current-password";
    elements.authPassword.minLength = 8;
  }
  if (elements.authStatus) elements.authStatus.textContent = message;
  authTurnstile.setMode(mode);
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
  const revisionResult = await supabase.from("synqme_training_revisions").select("revision").eq("user_id", user.id).maybeSingle();
  if (revisionResult.error) throw revisionResult.error;
  trainingRevision = Number(revisionResult.data?.revision || 0);
  const draft = migrateDraft && trainingRevision === 0 ? readMatchingAccountDraft(email) : null;
  const draftState = draft?.state ? stateFromSnapshot(draft.state) : null;
  const fallbackProfile = draftState?.profile || defaultProfile();
  const fallbackFunctions = draftState?.functions || [];
  cloudUserId = user.id;
  cloudUserEmail = user.email;
  profileCreatedAt = null;
  roomJourney = null;
  welcomeBackPending = false;
  chatReturnSummary = "";
  selectedJourneyScenario = null;
  simulationSession = null;
  todoItems = []; todoLoadedUserId = null; todoEditingId = null; todoAwaitingTitle = false; renderTodoReminders();
  renderScenarioJourney();
  roomJourneyTableUnavailable = false;
  roomJourneyWarningShown = false;
  personaMemoryRecords = [];
  preferenceReviewDrafts.clear(); passportSelection.clear(); renderPersonaPassport();
  personaMemoryTableUnavailable = false;
  personaMemoryWarningShown = false;
  personaMemoryWriteInFlight = false;
  if (memoryQueueTimer) clearInterval(memoryQueueTimer);
  memoryQueueTimer = null; memoryQueueRunner = null;
  showArchivedPersonaMemories = false;
  homeMemoryIndexUnavailable = false;
  homeMemoryIndexBackfilledUserId = null;
  homeMemoryIndexWarningShown = false;
  sharedKnowledgeUnavailable = false;
  sharedKnowledgeWarningShown = false;

  const [profileResult, preferencesResult, conversationResult] = await Promise.all([
    supabase.from("synqme_profiles").select("*").eq("user_id", cloudUserId).maybeSingle(),
    loadAllCloudPreferences(cloudUserId),
    supabase.from("synqme_conversations").select("messages,pending_clarification,updated_at").eq("user_id", cloudUserId).maybeSingle()
  ]);
  if (profileResult.error) throw profileResult.error;
  if (preferencesResult.error) throw preferencesResult.error;
  if (conversationResult.error) throw conversationResult.error;

  const remoteProfile = profileResult.data;
  profileCreatedAt = remoteProfile?.created_at || null;
  if (remoteProfile?.owner_avatar_synced) {
    ownerAvatarData = typeof remoteProfile.owner_avatar_data === "string" ? remoteProfile.owner_avatar_data : "";
    ownerAvatarNeedsCloudSync = false;
    saveOwnerAvatar();
  } else if (typeof remoteProfile?.owner_avatar_data === "string" && remoteProfile.owner_avatar_data.startsWith("data:image/")) {
    ownerAvatarData = remoteProfile.owner_avatar_data;
    ownerAvatarNeedsCloudSync = true;
    saveOwnerAvatar();
  } else {
    // Before the first cloud sync, do not erase a photo that already exists in this browser.
    ownerAvatarNeedsCloudSync = Boolean(ownerAvatarData);
  }
  renderOwnerAvatarPreview();
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
      robotVoice: normaliseVoicePreference(remoteProfile.future_robot_voice || fallbackProfile.robotVoice),
      preferredLanguage: remoteProfile.preferred_language || fallbackProfile.preferredLanguage || "en",
      confirmActions: Boolean(remoteProfile.confirm_actions),
      shareAnonymizedLearning: Boolean(remoteProfile.share_anonymized_learning),
      shareLearningConsentAt: remoteProfile.share_learning_consent_at || fallbackProfile.shareLearningConsentAt || null
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
  activeOutOfHomeScenarioContext = findOutOfHomeScenarioContext(state.messages);
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
  // Backfill the retained transcript once per account session; subsequent turns
  // write only their newest two messages, while the archive preserves older rows.
  await syncHomeMemoryIndex(state.messages, { backfill: true });
  await loadPersonaMemories({ backfillPreferences: true });
  await ensureRoomJourney();
  await refreshRoomJourneyProgress();
  await loadTodoReminders();
  if (draft) {
    try { localStorage.removeItem(ACCOUNT_DRAFT_KEY); } catch {}
  }
  setAuthGateVisible(false);
  renderAccountStatus();
  renderAll();
  selectAppView("home");
  prepareWelcomeAudioOffer();
  if (!profileComplete()) openSettings();
  else updateSettingsMode();
  startCloudConversationSync();
  startMemoryQueue();
  if (googlePlayCheckout.enabled) void googlePlayCheckout.syncOnSignIn();
  // Phonic provides spoken output; do not download the legacy Kokoro voice model.
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
elements.openSettings?.addEventListener("click", () => selectAppView("profile"));
elements.openPersonaFromSummary?.addEventListener("click", openSettings);
elements.personaMemoryList?.addEventListener("click", (event) => {
  void handlePersonaMemoryAction(event);
});
elements.toggleArchivedPersonaMemories?.addEventListener("click", () => {
  showArchivedPersonaMemories = !showArchivedPersonaMemories;
  renderPersonaMemoryLibrary();
});
elements.settingsBackdrop?.addEventListener("click", closeSettings);
elements.closeSettings?.addEventListener("click", closeSettings);
elements.cancelSettings?.addEventListener("click", closeSettings);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.settingsDialog && !elements.settingsDialog.hidden) closeSettings();
});

function populateSettingsForm() {
  elements.ownerName.value = state.profile.ownerName || "";
  elements.robotName.value = state.profile.robotName || "";
  elements.robotName.placeholder = normaliseVoicePreference(state.profile.robotVoice) === "male" ? "Andy" : "Vikki";
  elements.robotType.value = state.profile.robotType || "Humanoid robot";
  const voiceField = document.querySelector("#robotVoice");
  if (voiceField) voiceField.value = normaliseVoicePreference(state.profile.robotVoice);
  if (elements.preferredLanguage) elements.preferredLanguage.value = state.profile.preferredLanguage || "en";
  elements.confirmActions.checked = Boolean(state.profile.confirmActions);
  if (elements.shareAnonymizedLearning) {
    elements.shareAnonymizedLearning.checked = state.profile.shareAnonymizedLearning === true;
  }
  elements.functionGrid.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = state.functions.includes(checkbox.value);
  });
}
elements.settingsForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const wasSharingAnonymizedLearning = state.profile.shareAnonymizedLearning === true;
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
    robotVoice: normaliseVoicePreference(document.querySelector("#robotVoice")?.value),
    preferredLanguage: elements.preferredLanguage?.value || "en",
    confirmActions: Boolean(elements.confirmActions.checked),
    shareAnonymizedLearning: Boolean(elements.shareAnonymizedLearning?.checked),
    shareLearningConsentAt: elements.shareAnonymizedLearning?.checked
      ? (state.profile.shareAnonymizedLearning
          ? state.profile.shareLearningConsentAt
          : new Date().toISOString())
      : state.profile.shareLearningConsentAt || null
  };
  localizeWelcomeMessage(state.profile.preferredLanguage);
  persist();
  renderAll();
  const savedToAccount = await flushCloudSave();
  if (profileComplete()) await ensureRoomJourney();
  if (wasSharingAnonymizedLearning && state.profile.shareAnonymizedLearning !== true) {
    await deletePendingSharedKnowledgeCandidates();
  }
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
  return companionNameForProfile(state.profile);
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
        ownerAvatarNeedsCloudSync = true;
        ownerAvatarRevision += 1;
        saveOwnerAvatar();
        renderOwnerAvatarPreview();
        renderMessages();
        persist(false);
        scheduleCloudSave(0);
        if (elements.voiceStatus) {
          elements.voiceStatus.textContent = cloudUserId
            ? "Photo selected · synchronising across devices…"
            : "Photo saved in this browser. Sign in to sync it across devices.";
        }
        if (cloudUserId) {
          void flushCloudSave().then((saved) => {
            if (elements.voiceStatus) elements.voiceStatus.textContent = saved
              ? "Photo synced across devices."
              : "Photo saved here; cloud sync needs attention.";
          });
        }
      } catch {
        window.alert("The profile image could not be processed. Try a smaller image.");
      }
    };
    image.src = String(reader.result || "");
  };
  reader.readAsDataURL(file);
}

function formatMessageTimestamp(value) {
  if (!value) return "Date and time not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date and time not recorded";
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("month")}/${part("day")}/${part("year")} ${part("hour")}:${part("minute")}${part("dayPeriod").toUpperCase()}`;
}

function appendMessage(role, content, timestamp = null, messageScenarioId = null) {
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
    const image = document.createElement("img");
    image.className = "message-robot-image"; image.src = COMPANION_HEAD_IMAGE; image.alt = "";
    avatar.append(image);
  }
  const body = document.createElement("div");
  body.className = "message-body";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = role === "user"
    ? (state.profile.ownerName.trim().toUpperCase() || "YOU")
    : selectedCompanionDisplayName();
  const paragraph = document.createElement("p");
  paragraph.textContent = content;
  const timestampLabel = document.createElement("time");
  timestampLabel.className = "message-timestamp";
  const safeTimestamp = normaliseMessageTimestamp({ timestamp });
  if (safeTimestamp) timestampLabel.dateTime = safeTimestamp;
  else timestampLabel.classList.add("timestamp-unavailable");
  timestampLabel.textContent = formatMessageTimestamp(safeTimestamp);
  body.append(meta, paragraph, timestampLabel);
  if (role === "assistant" && /(?:try|explore|open|offer).{0,70}(?:practice |hypothetical )?situation/i.test(content)) {
    const scenarioId = messageScenarioId || scenarioData().started || (roomJourney?.active_room_id ? "room:" + roomJourney.active_room_id : null);
    if (scenarioForId(scenarioId)) {
      const practice = document.createElement("button"); practice.type = "button";
      practice.className = "out-of-home-scenario-action"; practice.textContent = "Try a situation";
      practice.addEventListener("click", () => {
        selectAppView("journey"); selectedJourneyScenario = scenarioId; journeyDisplay = "scenarios";
        renderScenarioJourney(); document.querySelector(".situation-preview")?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      body.append(practice);
    }
  }
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
  if (typeof mssInterface !== "undefined") mssInterface?.renderTranscript();
  elements.chatMessages.replaceChildren();
  // Render in conversation order so newer turns naturally appear at the bottom.
  state.messages.slice(-50).forEach((message) => appendMessage(message.role, message.content, message.timestamp, message.scenario_id));
  if (chatReturnSummary) appendMessage("assistant", chatReturnSummary);
  syncRobotSpeaking(document, elements.voiceOrb?.dataset.state === "speaking");
  window.requestAnimationFrame(() => {
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    updateChatScrollbar();
  });
}

elements.chatMessages?.addEventListener("scroll", updateChatScrollbar, { passive: true });
elements.roomJourneyPanel?.addEventListener("click", handleRoomJourneyClick);
document.querySelector("#scenarioHeaderProgress")?.addEventListener("click", (event) => {
  event.preventDefault();
  selectAppView("journey");
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && cloudUserId && profileComplete()) {
    void ensureRoomJourney();
    if(document.body.dataset.appView === "profile") void voiceBalance.refresh();
  }
});
window.addEventListener("resize", updateChatScrollbar);


function roomSchedule() {
  if (!roomJourney?.journey_started_at) return null;
  try { return { unlockedRooms: ROOM_JOURNEY_ROOMS, unlockedCount: ROOM_JOURNEY_ROOMS.length, nextUnlockAt: null, completedReleaseSchedule: true }; }
  catch (error) { console.info("Room journey schedule unavailable.", error); return null; }
}

function buildCurrentRoomJourneyContext() {
  const schedule = roomSchedule();
  if (!schedule || !roomJourney) return null;
  const room = schedule.unlockedRooms.find((item) => item.id === roomJourney.active_room_id) || schedule.unlockedRooms[0];
  if (!room) return null;
  return {
    activeRoomId: room.id,
    activeTaskId: room.id === roomJourney.active_room_id ? roomJourney.active_task_id || null : null,
    completedTaskIds: roomCompletedIds(room),
    reviewedTaskIds: scenarioData().reviewed?.["room:" + room.id] || [],
    completionConfirmed: completedScenarioIds(scenarioData().completed).includes("room:" + room.id),
    unlockedRoomCount: schedule.unlockedCount
  };
}

function roomCompletedIds(room) {
  const ids = roomJourney?.room_progress?.[room.id]?.completed_task_ids;
  return Array.isArray(ids) ? ids : [];
}

function roomText(className, text) {
  const node = document.createElement("div");
  node.className = className;
  node.textContent = text;
  return node;
}

function renderRoomJourney() {
  const featureTarget = elements.roomJourneyFeature;
  const gridTarget = elements.roomJourneyRoomGrid;
  if (!featureTarget || !gridTarget || elements.roomJourneyPanel?.hidden) return;
  featureTarget.replaceChildren();
  gridTarget.replaceChildren();

  const message = (intro, status, body) => {
    if (elements.roomJourneyIntro) elements.roomJourneyIntro.textContent = intro;
    if (elements.roomJourneyNextUnlock) elements.roomJourneyNextUnlock.textContent = status;
    featureTarget.append(roomText("room-journey-empty", body));
  };

  if (!cloudUserId || !profileComplete()) {
    message("Complete your profile to begin your personal room-by-room journey.", "STARTS WITH KITCHEN", "Your Kitchen journey begins as soon as your profile is ready.");
    return;
  }
  if (roomJourneyTableUnavailable) {
    message("Your scenario journey could not connect to account storage.", "ACCOUNT SYNC NEEDED", "Your conversations are still available. Room progress needs its private account storage before it can be saved.");
    return;
  }
  if (!roomJourney) {
    message("Preparing your personal room-by-room journey…", "STARTING WITH KITCHEN", "Your 25-scenario journey is being prepared.");
    return;
  }

  const schedule = roomSchedule();
  if (!schedule?.unlockedRooms.length) {
    message("Your personal room schedule is being prepared.", "STARTING WITH KITCHEN", "Your first room is being prepared.");
    return;
  }
  const unlockedIds = new Set(schedule.unlockedRooms.map((room) => room.id));
  const activeRoom = ROOM_JOURNEY_ROOMS.find((room) => room.id === roomJourney.active_room_id && unlockedIds.has(room.id)) || schedule.unlockedRooms[0];
  const activeIndex = ROOM_JOURNEY_ROOMS.findIndex((room) => room.id === activeRoom.id);
  const done = roomCompletedIds(activeRoom);
  const taskStates = getRoomTaskStates(activeRoom, done, roomJourney.active_task_id);
  const currentTask = taskStates.find((task) => task.status === "current") || null;
  const pendingTaskCount = taskStates.filter((task) => task.status === "pending").length;
  const doneCount = taskStates.filter((task) => task.status === "completed").length;
  const percent = Math.round(doneCount / activeRoom.tasks.length * 100);
  const allDone = schedule.unlockedRooms.reduce((total, room) => total + room.tasks.filter((task) => roomCompletedIds(room).includes(task.id)).length, 0);
  const allTasks = schedule.unlockedRooms.reduce((total, room) => total + room.tasks.length, 0);

  if (elements.roomJourneyIntro) elements.roomJourneyIntro.textContent = "Rooms form part of your 25-scenario journey. Complete and review the current scenario to unlock the next.";
  if (elements.roomJourneyNextUnlock) {
    elements.roomJourneyNextUnlock.textContent = schedule.nextUnlockAt
      ? "NEXT ROOM · " + schedule.nextUnlockAt.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
      : "ALL RELEASED ROOMS UNLOCKED";
  }

  const feature = document.createElement("div");
  feature.className = "room-feature";
  const top = document.createElement("div");
  top.className = "room-feature-top";
  const identity = document.createElement("div");
  identity.className = "room-feature-identity";
  identity.append(roomText("room-feature-icon", activeRoom.icon));
  const labels = document.createElement("div");
  labels.className = "room-feature-labels";
  labels.append(roomText("room-feature-month", "HOME AREA " + (activeIndex + 1) + " OF " + ROOM_JOURNEY_ROOMS.length + " · PART OF YOUR 25-SCENARIO JOURNEY"));
  const name = document.createElement("h3");
  name.textContent = activeRoom.name;
  labels.append(name);
  identity.append(labels);
  top.append(identity, roomText("room-feature-count", doneCount + " / " + activeRoom.tasks.length + " LEARNED"));
  const summary = roomText("room-feature-summary", activeRoom.summary);
  const meta = document.createElement("div");
  meta.className = "room-progress-meta";
  meta.append(roomText("", doneCount === activeRoom.tasks.length ? "Learning tasks covered" : "Learning progress"), roomText("", percent + "%"));
  const track = document.createElement("div");
  track.className = "room-progress-track";
  const fill = document.createElement("span");
  fill.style.width = percent + "%";
  track.append(fill);
  const taskOverview = document.createElement("div");
  taskOverview.className = "room-task-overview";
  const addTaskStat = (label, value, stateClass) => {
    const stat = document.createElement("div");
    stat.className = "room-task-stat " + stateClass;
    stat.append(roomText("room-task-stat-value", String(value)), roomText("room-task-stat-label", label));
    taskOverview.append(stat);
  };
  addTaskStat("COMPLETED", doneCount, "is-complete");
  addTaskStat("CURRENT TASK", currentTask ? 1 : 0, "is-current");
  addTaskStat("PENDING", pendingTaskCount, "is-pending");

  const currentBanner = document.createElement("div");
  currentBanner.className = "room-current-task-banner" + (currentTask ? "" : " is-empty");
  currentBanner.append(roomText("room-current-task-kicker", currentTask ? "YOU ARE WORKING ON" : "NO TASK IN PROGRESS"));
  currentBanner.append(roomText("room-current-task-title", currentTask ? currentTask.title : "Choose a pending task to make it your current task."));
  if (currentTask) {
    currentBanner.append(roomText("room-current-task-help", "This is your active focus. Select Continue to pick up the conversation where you left off."));
  } else {
    currentBanner.append(roomText("room-current-task-help", "Every unfinished item is marked Pending. Select Start on the task you want to work on first."));
  }

  const taskList = document.createElement("div");
  taskList.className = "room-task-list";

  for (let week = 1; week <= 4; week += 1) {
    const tasks = taskStates.filter((task) => task.week === week);
    if (!tasks.length) continue;
    const group = document.createElement("section");
    group.className = "room-task-week";
    group.append(roomText("room-task-week-title", "WEEK " + week));
    for (const task of tasks) {
      const complete = task.status === "completed";
      const current = task.status === "current";
      const row = document.createElement("article");
      row.className = "room-task-row" + (complete ? " is-complete" : current ? " is-current" : " is-pending");
      if (current) row.setAttribute("aria-current", "step");
      const copy = document.createElement("div");
      copy.className = "room-task-copy";
      const heading = document.createElement("div");
      heading.className = "room-task-heading";
      const taskTitle = document.createElement("strong");
      taskTitle.textContent = task.title;
      const state = roomText("room-task-state", complete ? "COMPLETED" : current ? "CURRENT TASK" : "PENDING");
      heading.append(taskTitle, state);
      const description = document.createElement("p");
      description.textContent = task.description;
      copy.append(heading, description);
      const action = document.createElement("button");
      action.type = "button";
      action.className = "room-task-action" + (current ? " is-current" : complete ? " is-complete" : "");
      action.dataset.roomTaskId = task.id;
      action.dataset.roomTaskPrompt = task.prompt;
      action.textContent = complete ? "Review" : current ? "Continue" : "Start";
      row.append(roomText("room-task-mark", complete ? "✓" : current ? "●" : "○"), copy, action);
      group.append(row);
    }
    taskList.append(group);
  }
  feature.append(top, summary, meta, track, taskOverview, currentBanner, taskList,
    roomText("room-progress-foot", allDone + " of " + allTasks + " tasks covered across your " + schedule.unlockedCount + (schedule.unlockedCount === 1 ? " released room." : " released rooms.")));
  featureTarget.append(feature);

  ROOM_JOURNEY_ROOMS.forEach((room, index) => {
    const unlocked = unlockedIds.has(room.id);
    const selected = activeRoom.id === room.id;
    const completed = room.tasks.filter((task) => roomCompletedIds(room).includes(task.id)).length;
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "room-tile" + (selected ? " is-active" : "") + (unlocked ? " is-unlocked" : " is-locked");
    tile.disabled = !unlocked;
    tile.dataset.roomSelect = room.id;
    const tileTop = document.createElement("span");
    tileTop.className = "room-tile-top";
    tileTop.append(roomText("room-tile-icon", room.icon), roomText("room-tile-number", String(index + 1).padStart(2, "0")));
    tile.append(tileTop, roomText("room-tile-name", room.name));
    tile.append(roomText("room-tile-status", !unlocked
      ? "UNLOCKS " + addMonthsAnchored(roomJourney.journey_started_at, index).toLocaleDateString(undefined, { day: "numeric", month: "short" })
      : selected && currentTask ? "TASK IN PROGRESS" : selected ? "CURRENT FOCUS" : completed === room.tasks.length ? "LEARNING COMPLETE" : "AVAILABLE"));
    tile.append(roomText("room-tile-progress", unlocked ? completed + " / " + room.tasks.length + " tasks" : "Not yet available"));
    gridTarget.append(tile);
  });
}

async function persistRoomJourneyChanges(patch) {
  if (!supabase || !cloudUserId || !roomJourney || !patch || roomJourneySaveInFlight) return false;
  const userId = cloudUserId;
  roomJourneySaveInFlight = true;
  try {
    const { data, error } = await supabase.from("synqme_room_journeys")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("user_id", userId).select("*").maybeSingle();
    if (error) throw error;
    if (userId !== cloudUserId) return false;
    if (!data) throw new Error("Account progress update returned no row.");
    roomJourney = data;
    renderRoomJourney();
    renderScenarioJourney();
    return true;
  } catch (error) {
    console.info("SYNQ.ME could not save room journey progress.", error);
    return false;
  } finally {
    roomJourneySaveInFlight = false;
  }
}

async function refreshRoomJourneyProgress() {
  // Scenario completion is explicitly confirmed by the owner. Legacy room
  // keyword matches must not silently mark tasks complete or overwrite the
  // scenario state while a conversation is being saved.
  renderRoomJourney();
  renderScenarioJourney();
  return false;
}

async function ensureRoomJourney() {
  if (!supabase || !cloudUserId || !profileComplete() || roomJourneyLoadInFlight) return false;
  if (roomJourney?.user_id === cloudUserId) {
    await refreshRoomJourneyProgress();
    return true;
  }
  roomJourneyLoadInFlight = true;
  const userId = cloudUserId;
  try {
    if (!profileCreatedAt) {
      const profileResult = await supabase.from("synqme_profiles").select("created_at").eq("user_id", userId).maybeSingle();
      if (profileResult.error) throw profileResult.error;
      profileCreatedAt = profileResult.data?.created_at || new Date().toISOString();
    }
    let result = await supabase.from("synqme_room_journeys").select("*").eq("user_id", userId).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) {
      const inserted = await supabase.from("synqme_room_journeys").insert({
        user_id: userId,
        journey_started_at: profileCreatedAt || new Date().toISOString(),
        active_room_id: "kitchen",
        room_progress: {}
      });
      if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
      result = await supabase.from("synqme_room_journeys").select("*").eq("user_id", userId).maybeSingle();
      if (result.error) throw result.error;
    }
    if (userId !== cloudUserId) return false;
    if (!result.data) throw new Error("The room journey could not be created for this account.");
    roomJourney = {
      ...result.data,
      room_progress: result.data.room_progress && typeof result.data.room_progress === "object" && !Array.isArray(result.data.room_progress)
        ? result.data.room_progress : {}
    };
    roomJourneyTableUnavailable = false;
    const schedule = roomSchedule();
    if (!schedule.unlockedRooms.some((room) => room.id === roomJourney.active_room_id)) {
      roomJourney.active_room_id = schedule.unlockedRooms[0]?.id || "kitchen";
      await persistRoomJourneyChanges({ active_room_id: roomJourney.active_room_id });
    }
    await refreshRoomJourneyProgress();
    renderRoomJourney();
    renderScenarioJourney();
    return true;
  } catch (error) {
    const missing = error?.code === "42P01" || /synqme_room_journeys.*does not exist|could not find the table.*synqme_room_journeys/i.test(String(error?.message || ""));
    if (missing) {
      roomJourneyTableUnavailable = true;
      if (!roomJourneyWarningShown) {
        console.info("SYNQ.ME room journey storage is unavailable. Apply the room journey migration.", error);
        roomJourneyWarningShown = true;
      }
    } else {
      console.info("SYNQ.ME could not load this account's room journey.", error);
    }
    renderRoomJourney();
    return false;
  } finally {
    roomJourneyLoadInFlight = false;
  }
}

async function setRoomJourneyFocus(roomId) {
  const schedule = roomSchedule();
  if (!schedule?.unlockedRooms.some((room) => room.id === roomId)) return;
  if (!roomJourney || roomJourney.active_room_id === roomId) return;
  roomJourney.active_room_id = roomId;
  roomJourney.active_task_id = null;
  renderRoomJourney();
  await persistRoomJourneyChanges({ active_room_id: roomId, active_task_id: null });
}

async function setRoomJourneyTask(taskId) {
  const schedule = roomSchedule();
  const activeRoom = ROOM_JOURNEY_ROOMS.find((room) => room.id === roomJourney?.active_room_id);
  if (!schedule?.unlockedRooms.some((room) => room.id === activeRoom?.id)) return;
  const task = activeRoom.tasks.find((item) => item.id === taskId);
  if (!task || roomCompletedIds(activeRoom).includes(task.id) || roomJourney.active_task_id === task.id) return;
  roomJourney.active_task_id = task.id;
  renderRoomJourney();
  await persistRoomJourneyChanges({ active_task_id: task.id });
}

function handleRoomJourneyClick(event) {
  const task = event.target.closest("[data-room-task-prompt]");
  if (task && elements.messageInput) {
    activeOutOfHomeScenarioContext = null;
    const taskId = task.dataset.roomTaskId;
    if (taskId) void setRoomJourneyTask(taskId);
    elements.messageInput.value = task.dataset.roomTaskPrompt || "";
    elements.messageInput.focus();
    elements.messageInput.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  const room = event.target.closest("[data-room-select]");
  if (room && !room.disabled) {
    activeOutOfHomeScenarioContext = null;
    void setRoomJourneyFocus(room.dataset.roomSelect);
  }
}

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
  if (voiceModeActive && voiceBreakTracker.awaiting() && breakResponse(message) !== 'other') return;
  if (todoCommandForMessage(message)) return;
  if (!["answer", "correction"].includes(conversationIntent(message))) return;
  const statements = splitPreferenceStatements(message);
  for (const statement of statements) {
    const preference = cleanPreference(statement);
    if (!preference || !isUsefulStandalonePreference(statement)) continue;
    const extracted = extractExplicitPreferenceFacets(statement);
    preference.explicitFacets = extracted.explicitFacets;
    preference.unresolvedFields = extracted.unresolvedFields;
    preference.sourceMessage = message;
    preference.clarifications = [];
    const exists = activeLegacyPreferences().some((item) => (item.normalised || item.text.toLowerCase()) === preference.normalised);
    if (exists) continue;
    state.preferences.unshift(preference);
  }
  void refreshRoomJourneyProgress();
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

const preferenceReviewDrafts = new Map();
let preferenceReviewOpenKey = null;
function renderPreferenceReview() {
  const panel=document.querySelector('#preferenceReview'), list=document.querySelector('#preferenceReviewList'), counter=document.querySelector('#preferenceReviewCount');
  if(!panel || !list) return;
  const items=collectReviewableFragments(personaMemoryRecords,state.preferences,state.messages);
  panel.hidden=!items.length;
  if(counter) counter.textContent='('+items.length+')';
  list.replaceChildren();
  for(const item of items) {
    const key=item.kind+':'+item.id, draft=preferenceReviewDrafts.get(key) || {value:'',status:''};
    preferenceReviewDrafts.set(key,draft);
    const card=document.createElement('details'); card.className='preference-review-item'; card.open=preferenceReviewOpenKey===key;
    card.addEventListener('toggle',()=>{if(card.open)preferenceReviewOpenKey=key;else if(preferenceReviewOpenKey===key)preferenceReviewOpenKey=null;});
    const heading=document.createElement('summary'); heading.textContent=item.text; card.append(heading);
    const source=document.createElement('p');
    source.textContent=item.source ? 'Original question: '+item.source.question : 'The original question could not be matched with certainty. Enter a complete preference below.';
    card.append(source);
    if(item.source) {
      const answer=document.createElement('p'); answer.textContent='Your answer: '+item.source.answer; card.append(answer);
      const suggest=document.createElement('button'); suggest.type='button'; suggest.textContent='Suggest wording';
      suggest.addEventListener('click',async()=>{
        const owner=cloudUserId;if(!owner)return; suggest.disabled=true;draft.status='Preparing a suggestion…'; status.textContent=draft.status;
        try {
          const response=await fetch(API_BASE+'/api/memory/extract',{method:'POST',headers:await authenticatedApiHeaders(),body:JSON.stringify({messages:[{role:'assistant',content:item.source.question},{role:'user',content:item.source.answer}],existingMemories:[],scenarioId:item.source.scenarioId})});
          const result=await response.json();if(!response.ok)throw Error('Suggestion unavailable. You can write the preference yourself.');
          if(owner!==cloudUserId)return;
          const candidates=(Array.isArray(result.memories)?result.memories:[]).map(cleanPersonaMemoryCandidate).filter(value=>value && ['user_stated','user_confirmed'].includes(value.status));
          if(!candidates.length) throw Error('There is not enough context for a reliable suggestion. Please write the preference yourself.');
          const suggestion=candidates.map(candidate=>candidate.statement + (candidate.conditions?.length ? ' (Conditions: '+candidate.conditions.join('; ')+')' : '')).join(' ');
          if(candidates.length>3 || suggestion.length>420) throw Error('The exchange may contain several preferences. Please write the one you want to save.');
          draft.value=suggestion; input.value=draft.value;draft.status='Suggested wording - check and edit it before saving.';
        } catch(error) {draft.status=error.message || 'Suggestion unavailable. Please write the preference yourself.';}
        finally { if(owner===cloudUserId){suggest.disabled=false;status.textContent=draft.status;if(card.isConnected === false)renderPreferenceReview();} }
      });card.append(suggest);
    }
    const form=document.createElement('form'); form.className='preference-review-form';
    const label=document.createElement('label'); label.textContent='Complete preference';
    const input=document.createElement('textarea'); input.value=draft.value;input.maxLength=420;input.rows=3;input.required=true;input.placeholder='Describe the situation and what you prefer';
    input.addEventListener('input',()=>{draft.value=input.value;});label.append(input);
    const save=document.createElement('button');save.type='submit';save.textContent='Save preference';
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent=draft.status;
    form.addEventListener('submit',async event=>{
      event.preventDefault();const owner=cloudUserId, statement=String(input.value||'').trim().replace(/\s+/g,' ');
      if(!owner || !supabase){status.textContent='Sign in to save your preference.';return;}
      if(statement.length<8 || !isUsefulStandalonePreference(statement)){status.textContent='Please include what the preference refers to and what you want to happen.';return;}
      save.disabled=true;
      try {
        if(item.kind==='memory') {
          const original=personaMemoryRecords.find(row=>String(row.id)===String(item.id));
          if(!original || !memoryIsActive(original))throw Error('This memory is no longer available.');
          const topic=deriveMemoryTopic(statement), kind=deriveMemoryKind(statement);
          const attributes={...(original.attributes || {})};
          if(!attributes.scenario_id && item.source?.scenarioId && scenarioForId(item.source.scenarioId)) attributes.scenario_id=item.source.scenarioId;
          await updatePersonaMemoryRow(original.id,{statement,topic,kind,attributes,scope_key:deriveMemoryScopeKey(statement,topic,kind),search_terms:[],search_keys:buildPersonaMemorySearchKeys(statement,[],topic),status:'user_confirmed',confidence:0.98,reviewed_at:new Date().toISOString()});
        } else {
          const original=state.preferences.find(row=>String(row.id)===String(item.id));
          if(!original)throw Error('This preference is no longer available.');
          const row=preferenceToPersonaMemory({...original,text:statement,status:'user_confirmed'},owner);
          if(!row)throw Error('Please write a complete preference without sensitive personal information.');
          if(item.source?.scenarioId && scenarioForId(item.source.scenarioId))row.attributes={...row.attributes,scenario_id:item.source.scenarioId};
          const {data,error}=await supabase.from('synqme_persona_memories').insert(row).select(PERSONA_MEMORY_SELECT_COLUMNS).single();
          if(error || !data)throw error || Error('Could not save this preference.');
          if(owner!==cloudUserId)return;
          personaMemoryRecords=[data,...personaMemoryRecords];
        }
        if(owner!==cloudUserId)return;
        preferenceReviewDrafts.delete(key);preferenceReviewOpenKey=null;renderAll();
        const foot=document.querySelector('#memoryFootnote');if(foot)foot.textContent='Preference saved and confirmed.';
      } catch(error) {draft.status=error.message || 'Could not save the preference. Please try again.';status.textContent=draft.status;}
      finally {save.disabled=false;}
    });
    form.append(label,save,status);card.append(form);list.append(card);
  }
}

function activeLegacyPreferences() {
  return state.preferences.filter((item) =>
    !["superseded", "rejected"].includes(String(item.status || item.preference_status || "").toLowerCase()) && isUsefulStandalonePreference(item.text)
  );
}

function curatedPreferences() {
  const results = [], seen = new Set();
  const linkedPreferenceIds = new Set(activePersonaMemories().map(memory => String(memory.source_preference_id || "")).filter(Boolean));
  for (const memory of activePersonaMemories()) {
    if (!["user_stated", "user_confirmed"].includes(memory.status)) continue;
    const key = preferenceIdentity(memory.statement, memory.conditions, memory.permission_policy);
    if (!key || seen.has(key)) continue;
    seen.add(key); results.push({ text: memory.statement, category: preferenceDisplayLabel(memory, SCENARIOS, scenarioTasks), conditions: memory.conditions || [] });
  }
  for (const preference of activeLegacyPreferences()) {
    if (linkedPreferenceIds.has(String(preference.id))) continue;
    const key = preferenceIdentity(preference.text, preference.unresolvedFields);
    if (!key || seen.has(key)) continue;
    seen.add(key); results.push({ ...preference, category: "Scenario not linked · " + (preference.category || "Personal preference") });
  }
  return results;
}

function renderPreferences() {
  const activePreferences = curatedPreferences();
  const count = activePreferences.length;
  elements.memoryCount.textContent = count + (count === 1 ? " MEMORY" : " MEMORIES");
  elements.preferenceCount.textContent = String(count);
  const scenarioSummary = scenarioProgressSummary(scenarioData().completed);
  elements.personaProgress.style.width = scenarioSummary.percent + "%";
  elements.foundationValue.textContent = scenarioSummary.completed + " of " + scenarioSummary.total + " scenarios reviewed";
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
    activePreferences.forEach((preference, index) => {
      const item = document.createElement("div");
      item.className = "preference-item";
      addElement(item, "preference-number", String(index + 1).padStart(2, "0"));
      const copy = document.createElement("div");
      copy.className = "preference-copy";
      addElement(copy, "preference-category", preference.category || classifyPreference(preference.text));
      addElement(copy, "preference-text", preference.text);
      if (Array.isArray(preference.conditions) && preference.conditions.length) addElement(copy, "preference-conditions", "Conditions: " + preference.conditions.join("; "));
      item.append(copy);
      elements.preferenceList.append(item);
    });
  }

  renderPreferenceReview();
  if (elements.settingsPreferenceCount) elements.settingsPreferenceCount.textContent = String(count);
  if (elements.settingsPreferenceList) {
    elements.settingsPreferenceList.replaceChildren();
    if (!count) {
      const p = document.createElement("p");
      p.className = "settings-empty";
      p.textContent = "As you chat with ELO, your preferences will appear here.";
      elements.settingsPreferenceList.append(p);
    } else {
      activePreferences.slice(0, 8).forEach((preference) => {
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
  return Boolean(milestone.unlocked({ ...state, preferences: curatedPreferences() }));
}

function formatPexiCapabilityLabel(value) {
  return String(value || "").replace(/_/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderPexiCapabilityDetails(plan) {
  const container = elements.pexiCapabilityPlanList;
  if (!container) return;
  container.replaceChildren();
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  container.hidden = tasks.length === 0;
  const statusLabels = {
    not_mapped: "NEEDS TASK MAPPING",
    unverified: "AWAITING ROBOT SPECIFICATION",
    partially_verified: "SPECIFICATION INCOMPLETE",
    missing_capabilities: "DECLARED CAPABILITY GAP",
    capability_match_safety_review_required: "SAFETY REVIEW REQUIRED"
  };
  for (const task of tasks) {
    const card = document.createElement("article");
    card.className = "pexi-capability-task";
    const heading = document.createElement("div");
    heading.className = "pexi-capability-task-head";
    const title = document.createElement("strong");
    title.textContent = task.label || formatPexiCapabilityLabel(task.function_id);
    const state = document.createElement("span");
    state.textContent = statusLabels[task.capability_status] || "REVIEW REQUIRED";
    heading.append(title, state);
    card.appendChild(heading);

    const requirements = document.createElement("p");
    requirements.textContent = "Required capabilities: " +
      (task.required_capabilities || []).map(formatPexiCapabilityLabel).join(", ");
    card.appendChild(requirements);

    const evidence = document.createElement("p");
    if (task.capability_status === "unverified") {
      evidence.textContent = "No target-robot specification supplied. Every requirement remains unverified.";
    } else if (task.missing_capabilities?.length) {
      evidence.textContent = "Declared missing: " + task.missing_capabilities.map(formatPexiCapabilityLabel).join(", ");
    } else if (task.unverified_capabilities?.length) {
      evidence.textContent = "Declared so far: " + (task.supported_capabilities || []).map(formatPexiCapabilityLabel).join(", ") +
        ". Still unverified: " + task.unverified_capabilities.map(formatPexiCapabilityLabel).join(", ");
    } else {
      evidence.textContent = "The supplied specification declares all required capabilities. This is not an independently verified capability match.";
    }
    card.appendChild(evidence);

    const safety = document.createElement("p");
    safety.textContent = "Safety gates requiring independent validation: " +
      (task.unverified_safety_gates || []).map(formatPexiCapabilityLabel).join(", ");
    card.appendChild(safety);

    if (task.persona_preferences?.length) {
      const prefs = document.createElement("p");
      prefs.textContent = "Relevant persona details: " + task.persona_preferences.length;
      card.appendChild(prefs);
    }
    container.appendChild(card);
  }
}

function downloadPexiManifestTemplate() {
  const template = {
    schema: "app.mysecondself.pexi-capability-manifest",
    schema_version: "1.0.0",
    manufacturer: "REPLACE_WITH_MANUFACTURER",
    model: "REPLACE_WITH_MODEL",
    source: "REPLACE_WITH_MANUFACTURER_SPECIFICATION_URL",
    completeness: "partial",
    capabilities: [],
    declared_safety_gates: []
  };
  const blob = new Blob([JSON.stringify(template, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "pexi-capability-manifest-template.json";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderPexiManifestStatus(kind = "") {
  if (elements.pexiManifestStatus) {
    elements.pexiManifestStatus.dataset.kind = kind;
    elements.pexiManifestStatus.textContent = pexiCapabilityManifest
      ? "Loaded " + pexiCapabilityManifest.manufacturer + " " + pexiCapabilityManifest.model +
        " (" + pexiCapabilityManifest.completeness + " declaration). Source: " + pexiCapabilityManifest.source +
        ". Supplier declarations are not independently verified."
      : "No robot specification loaded. Import a manufacturer/model capability manifest in JSON format.";
  }
  if (elements.removePexiManifest) elements.removePexiManifest.hidden = !pexiCapabilityManifest;
}

function initialisePexiManifestControls() {
  elements.downloadPexiManifestTemplate?.addEventListener("click", downloadPexiManifestTemplate);
  elements.pexiManifestInput?.addEventListener("change", async () => {
    const file = elements.pexiManifestInput.files?.[0];
    elements.pexiManifestInput.value = "";
    if (!file) return;
    if (file.size > 128 * 1024) {
      renderPexiManifestStatus("error");
      if (elements.pexiManifestStatus) elements.pexiManifestStatus.textContent = "The capability manifest must be smaller than 128 KB.";
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      const cleaned = cleanPexiCapabilityManifest(parsed);
      if (!cleaned) throw new Error("The file does not match the PEXI capability manifest schema.");
      pexiCapabilityManifest = cleaned;
      try { localStorage.setItem(PEXI_CAPABILITY_MANIFEST_KEY, JSON.stringify(cleaned)); } catch {}
      renderPexiManifestStatus("success");
      renderPexiReadiness();
    } catch (error) {
      renderPexiManifestStatus("error");
      if (elements.pexiManifestStatus) elements.pexiManifestStatus.textContent =
        String(error?.message || "This capability manifest could not be read.").slice(0, 220);
    }
  });
  elements.removePexiManifest?.addEventListener("click", () => {
    pexiCapabilityManifest = null;
    try { localStorage.removeItem(PEXI_CAPABILITY_MANIFEST_KEY); } catch {}
    renderPexiManifestStatus();
    renderPexiReadiness();
  });
  renderPexiManifestStatus();
}

function renderPexiReadiness() {
  const activePreferences = activeLegacyPreferences();
  const unresolved = activePreferences.reduce((sum, item) => sum + preferenceExtraction(item).unresolvedFields.length, 0);
  const plan = buildPexiCapabilityPlan({
    selectedFunctions: state.functions,
    preferences: activePreferences.map((item) => ({
      text: item.text,
      category: item.category,
      status: item.status,
      unresolvedFields: preferenceExtraction(item).unresolvedFields
    })),
    targetRobotType: state.profile.robotType || "Humanoid robot",
    capabilityManifest: pexiCapabilityManifest
  });
  const labels = {
    persona_details_open: "DETAILS TO COMPLETE",
    tasks_need_mapping: "TASKS NEED MAPPING",
    awaiting_robot_specification: "AWAITING ROBOT SPEC",
    required_capabilities_missing: "CAPABILITY GAPS",
    capabilities_not_fully_declared: "SPECIFICATION INCOMPLETE",
    safety_gates_to_confirm: "SAFETY GATES TO CONFIRM",
    safety_validation_required: "SAFETY VALIDATION"
  };
  if (elements.pexiReadinessStatus) {
    elements.pexiReadinessStatus.textContent = !state.functions.length && !activePreferences.length
      ? "NOT STARTED"
      : labels[plan.status] || "AWAITING MAPPING";
  }
  if (elements.pexiReadinessSummary) {
    const parts = [];
    if (plan.task_count) parts.push(plan.task_count + (plan.task_count === 1 ? " selected task" : " selected tasks") + " translated into a capability brief");
    if (activePreferences.length) parts.push(activePreferences.length + (activePreferences.length === 1 ? " saved preference" : " saved preferences"));
    if (unresolved) parts.push(unresolved + (unresolved === 1 ? " preference detail still needs" : " preference details still need") + " clarification");
    if (plan.target_robot.capability_manifest_status === "not_supplied") {
      parts.push("No manufacturer/model capability manifest has been supplied, so robot compatibility is unverified.");
    } else {
      parts.push("The imported manufacturer/model declarations have not been independently verified.");
      if (plan.totals.missing_capabilities) {
        parts.push(plan.totals.missing_capabilities + " required capability declarations are missing.");
      } else if (plan.totals.unverified_capabilities) {
        parts.push(plan.totals.unverified_capabilities + " capabilities remain unverified.");
      } else if (plan.totals.undocumented_safety_gates) {
        parts.push(plan.totals.undocumented_safety_gates + " safety gates still need source documentation.");
      } else {
        parts.push("Declared capabilities and safety gates still require independent validation.");
      }
    }
    parts.push("No physical robot is connected and no task can be executed from this package.");
    if (!parts.length) parts.push("Choose the household tasks you want your SecondSelf to understand. PEXI will translate them into capability requirements without assuming compatibility.");
    if (!plan.task_count && !activePreferences.length) {
      elements.pexiReadinessSummary.textContent = "Choose the household tasks you want your SecondSelf to understand. PEXI will translate them into capability requirements without assuming compatibility.";
    } else {
      elements.pexiReadinessSummary.textContent = parts.join(" ");
    }
  }
  renderPexiCapabilityDetails(plan);
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
  const summaryTitle = document.querySelector("#decisionTitle");
  if (summaryTitle) summaryTitle.textContent = progressOwnerLabel(state.profile.ownerName,"learning summary");
  const preferences = curatedPreferences();
  if (!preferences.length && !state.functions.length) {
    elements.decisionSummary.textContent = "Your scenario journey gives you one clear focus at a time. Start with the Kitchen and build your SecondSelf through natural conversation.";
    elements.amyaState.textContent = "Getting started";
    elements.pexiState.textContent = "Not connected";
    elements.amyaState.classList.remove("ready");
    elements.pexiState.classList.remove("ready");
    return;
  }
  const journeyProgress = scenarioProgressSummary(scenarioData().completed);
  elements.decisionSummary.textContent = journeyProgress.completed + " of " + journeyProgress.total + " scenarios confirmed complete. " + preferences.length + (preferences.length === 1 ? " saved preference" : " saved preferences") + " captured so far. Preferences are individual learnings, not completed scenarios.";
  elements.amyaState.textContent = "Building context";
  elements.pexiState.textContent = "Future use";
  elements.amyaState.classList.add("ready");
  elements.pexiState.classList.remove("ready");
}

const googlePlayCheckout = createGooglePlayCheckout({
  apiBase: PHONIC_API_BASE_URL,
  getHeaders: authenticatedApiHeaders,
  getUserId: () => cloudUserId
});
const voiceBalance = createVoiceBalance({apiBase:API_BASE,getUserId:()=>cloudUserId,getHeaders:authenticatedApiHeaders,onChange:()=>mssInterface?.render()});

mssInterface = createMssInterface({
  refreshBalance:()=>voiceBalance.refresh(),
  openBilling: googlePlayCheckout.enabled ? () => googlePlayCheckout.open() : undefined,
  getSnapshot() {
    const ready = Boolean(cloudUserId && roomJourney && roomJourney.user_id === cloudUserId);
    const data = ready ? scenarioData() : {};
    const taskCounts = {}, reviewedCounts = {};
    for (const scenario of SCENARIOS) {
      const tasks = scenarioTasks(scenario);
      taskCounts[scenario.id] = tasks.length;
      reviewedCounts[scenario.id] = tasks.filter(task => (data.reviewed?.[scenario.id] || []).includes(task.id)).length;
    }
    const model = buildInterfaceModel({ scenarios: SCENARIOS, data, ready, activeRoomId: roomJourney?.active_room_id, taskCounts, reviewedCounts });
    const pending = conversationCheckpoint(state.messages, model.active?.id);
    return { owner: state.profile.ownerName.trim(), companion: selectedCompanionDisplayName(),
      voice: normaliseVoicePreference(state.profile.robotVoice), avatar: ownerAvatarData,
      billing:voiceBalance.snapshot(), preferences: curatedPreferences(), messages: state.messages, pendingQuestion: pending?.question || "", model };
  },
  navigate: selectAppView,
  async shareProgress() {
    if (!cloudUserId || !roomJourney || roomJourney.user_id !== cloudUserId) throw new Error("Your saved progress is not available yet.");
    return shareProgressImage(scenarioProgressSummary(scenarioData().completed), state.profile.ownerName);
  },
  editSettings(field) {
    openSettings();
    window.requestAnimationFrame(() => {
      const control = document.getElementById(field);
      for (let parent = control?.parentElement; parent; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
      control?.scrollIntoView({ block: "center" }); control?.focus({ preventScroll: true });
    });
  },
  openScenario(id) {
    selectAppView("journey"); selectedJourneyScenario = id; journeyDisplay = "scenarios";
    renderScenarioJourney();
  },
  openWorkspace(id) {
    selectAppView("journey");
    const target = document.getElementById(id); if (target) target.open = true;
    if (id === "personaPassport") renderPersonaPassport();
    window.requestAnimationFrame(() => target?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }
});

function renderAll() {
  if (typeof mssInterface !== "undefined") mssInterface?.render();
  renderMessages();
  renderOwnerAvatarPreview();
  renderPreferences();
  renderPersonaMemoryLibrary();
  if (document.querySelector("#personaPassport")?.open) renderPersonaPassport();
  updateDecisionSummary();
  renderSettingsDetails();
  renderPexiReadiness();
  renderRoomJourney();
  renderScenarioJourney();

  const name = state.profile.ownerName.trim();
  const robotName = state.profile.robotName.trim();
  const companionName = robotName || "your companion";
  if (elements.companionName) elements.companionName.textContent = companionName;
  if (elements.messageInput) {
    elements.messageInput.placeholder = "Message " + selectedCompanionDisplayName();
  }
  if (elements.mobileOwnerTitle) elements.mobileOwnerTitle.textContent = name ? name + "’s SecondSelf" : "Your SecondSelf";
  const count = curatedPreferences().length;
  const functionsCount = state.functions.length;
  if (elements.mobileJourneyText) {
    const activeRoom = ROOM_JOURNEY_ROOMS.find((room) => room.id === roomJourney?.active_room_id);
    elements.mobileJourneyText.textContent = activeRoom
      ? activeRoom.name + " · your scenario journey"
      : count
        ? count + (count === 1 ? " preference captured" : " preferences captured") + " · your SecondSelf is growing"
        : "Your Kitchen journey starts here";
  }
  const achieved = MILESTONES.filter(milestoneUnlocked).length;
  const progress = Math.round((achieved / MILESTONES.length) * 100);
  if (elements.mobileProgressValue) elements.mobileProgressValue.textContent = progress + "%";
  document.title = name ? "SYNQ.ME | " + name + "’s SecondSelf" : "SYNQ.ME | Build Your SecondSelf";
  const intro = $(".conversation-intro p");
  if (intro) intro.textContent = robotName
    ? "Tell me what matters to you. I’ll help shape your digital persona, one preference at a time. Your future robot name is " + robotName + "."
    : "Tell me what matters to you. I’ll help shape your digital persona, one preference at a time.";
}
renderAll();
void checkAIBackend();

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
    '<g class="robot-eyes">' + eyes + '</g>' +
    '<path class="robot-mouth-rest" d="M52 68q8 5 16 0" fill="none" stroke="#dce6f2" stroke-width="2" stroke-linecap="round"/>' +
    '<g class="robot-mouth-speaking"><ellipse cx="60" cy="69" rx="7" ry="4" fill="#dce6f2"/><ellipse cx="60" cy="71" rx="3.5" ry="1.5" fill="' + accent + '"/></g>' +
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
  const clear = document.createElement("button");
  clear.type = "button"; clear.className = "robot-picker-item robot-picker-none";
  clear.textContent = "No image";
  clear.setAttribute("aria-label", "Clear companion image");
  clear.setAttribute("aria-pressed", String(robotAppearance.robotId === "none" && !robotAppearance.customImageData));
  clear.classList.toggle("is-selected", robotAppearance.robotId === "none" && !robotAppearance.customImageData);
  clear.addEventListener("click", () => {
    robotAppearance = { robotId: "none", customImageData: "" };
    saveRobotAppearance(); renderRobotPicker(); applyRobotAppearance();
  });
  elements.robotPicker.append(clear);
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
      if (robotAppearance.robotId !== "none") elements.voiceOrbCore.innerHTML = robotSvgMarkup(option.id);
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
    if (robotAppearance.robotId === "none") elements.selectedRobotArt.textContent = "No image";
    else elements.selectedRobotArt.innerHTML = robotSvgMarkup(option.id);
    if (elements.selectedRobotName) elements.selectedRobotName.textContent = robotAppearance.robotId === "none" ? "No image" : option.name;
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
  if (mode !== "speech-pause" && voiceAudioPauseTimer !== null) { window.clearTimeout(voiceAudioPauseTimer); voiceAudioPauseTimer = null; }
  if (elements.voiceOrb) elements.voiceOrb.dataset.state = mode || "idle";
  if (typeof mssInterface !== "undefined") mssInterface?.renderVoiceState();
  syncRobotSpeaking(document, mode === "speaking");
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

function buildPhonicConfig() {
  const language = state.profile.preferredLanguage || "en";
  const languageName = CONVERSATION_LANGUAGE_NAMES[language] || "English";
  const companion = selectedCompanionDisplayName();
  const voicePreference = normaliseVoicePreference(state.profile.robotVoice);
  const voiceId = phonicVoiceIdForPreference(voicePreference);
  const systemPrompt = [
    "You are " + companion + ", the user's future home robot persona, speaking through SYNQ.ME while they build their SecondSelf. You are not a physical robot connected to the home yet.",
    "Do not introduce yourself again at the start of each voice session. If explicitly asked who you are, say: I am your future robot, " + companion + ". Occasional named asides are allowed only when they are part of AMÏA's authoritative response.",
    "Speak about your own future capabilities, limitations and behaviour in first person: I/me/my. Never describe yourself as 'the robot' or 'your robot'. AMÏA may occasionally include your selected name in a short personal aside; speak it exactly as supplied. Never add your own name, extra asides or introductions to the authoritative response. The voice system handles speech; the conversation engine supplies your decisions, answers and questions.",
    "MANDATORY TURN FLOW: After each completed user utterance, call amia_next_turn exactly once before speaking. Do not independently answer, acknowledge, or ask a follow-up while waiting. The tool calls SYNQ.ME's AMÏA conversation engine with the current transcript, saved preferences, relevant home memories, profile and selected household interests.",
    "PRONUNCIATION: SYNQ.ME is pronounced sink me. Always say sink me when speaking this brand name.",
    "AUTHORITATIVE RESPONSE: Speak only the tool's assistant_text, verbatim, in " + languageName + ". Do not paraphrase, add greetings, ask an extra question, or continue after that response. Never mention tools or internal decision logic.",
    "FIRST-PERSON COMPANION RULE — NON-NEGOTIABLE: When discussing tasks you may eventually do, always speak as the user's SecondSelf using I/me. Ask, for example, “What would you like me to do?” or “How would you like me to handle that?” Never ask what the user wants their robot to do, what the robot should do, or any equivalent third-person task question. Apply this perspective naturally in the selected language.",
    "NATURAL PACING: Pause briefly at each sentence ending. Make a clear, relaxed pause before moving from an acknowledgement into a new question, and a slightly longer pause at blank lines. Do not rush the question into the preceding statement. Keep all words verbatim. Use a warm, unhurried conversational delivery.",
    "VOICE SELECTION — NON-NEGOTIABLE: The user selected the " + voicePreference + " voice. Use the configured voice consistently and do not substitute, alternate, or randomise it.",
    "Never claim a robot is physically connected or that a household task has happened. This conversation prepares a personal digital persona for a future compatible robot."
  ].join("\n\n");
  return {
    type: "config",
    system_prompt: systemPrompt,
    voice_id: voiceId,
    audio_speed: 1,
    // The app enforces 30 seconds while listening for the user. The provider
    // gets a longer fallback so it does not end a session while AMÏA is replying.
    no_input_end_conversation_sec: 60,
    websocket_timeout_sec: 90,
    default_language: language,
    additional_languages: [],
    multilingual_mode: "request",
    input_format: "pcm_44100",
    output_format: "pcm_44100",
    tools: [{
      type: "custom_websocket",
      tool_schema: {
        type: "function",
        function: {
          name: "amia_next_turn",
          description: "Call this once after every completed user utterance. AMÏA decides the reply and next useful question using the full SYNQ.ME context. Do not answer or ask a follow-up yourself.",
          parameters: {
            type: "object",
            properties: {
              latest_user_message: {
                type: "string",
                description: "The latest user utterance, transcribed accurately."
              }
            },
            required: ["latest_user_message"],
            additionalProperties: false
          },
          strict: true
        }
      },
      execution_mode: "sync",
      tool_call_output_timeout_ms: 150000,
      require_speech_before_tool_call: false,
      wait_for_speech_before_tool_call: false,
      allow_tool_chaining: false
    }]
  };
}

function normalisePhonicText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

let phonicTranscriptRenderPending = false;
function syncPhonicTranscriptItems(items, {finalize=false} = {}) {
  let changed=false,userAdded=false,finalized=false;
  for(const item of items||[]){
    const textValue=typeof item?.text==='string'?item.text.trim():'';
    if(!textValue || item.role !== "user")continue;
    const key=String(item.itemIdx);
    let id=phonicItemMap.get(key);
    let previous=id ? state.messages.find(message=>message.role==='user' && message.voice_turn_id===id) : null;
    if(previous?.transcript_final)continue;
    if(!previous){
      const timestamp=new Date().toISOString();id=globalThis.crypto?.randomUUID?.() || timestamp+'-'+key;
      previous={role:'user',content:textValue,timestamp,voice_turn_id:id,transcript_final:false};
      state.messages.push(previous);phonicItemMap.set(key,id);userAdded=true;
    }
    if(previous.content!==textValue){previous.content=textValue;changed=true;}
    if(finalize){
      previous.transcript_final=true;finalized=true;
      const before=new Set(state.preferences.map(preference=>String(preference.id)));
      const clarified=todoCommandForMessage(textValue)||(voiceBreakTracker.awaiting()&&breakResponse(textValue)!=='other')?false:resolvePendingClarification(textValue);
      if(!clarified&&!isClarificationRequest(textValue))savePreference(textValue);
      const added=state.preferences.some(preference=>!before.has(String(preference.id)));
      phonicTurnMetadata.set(key,{timestamp:previous.timestamp,text:textValue,shouldExtractStructuredMemory:shouldExtractPersonaMemory(textValue,added)||Boolean(clarified&&textValue.length>=4)});
    }
  }
  if(finalized){persist();renderAll();}
  else if((changed||userAdded)&&!phonicTranscriptRenderPending){
    phonicTranscriptRenderPending=true;window.requestAnimationFrame(()=>{phonicTranscriptRenderPending=false;renderMessages();});
  }
  return {changed:changed||userAdded,userAdded:finalized,finalized};
}

async function submitPhonicUsage() {
  if (!phonicUsageSession || phonicUsageSubmitted) return;
  phonicUsageSubmitted = true;
  const endedAt = Date.now();
  if (phonicUserSpeechStartedAt) {
    phonicUserSpeechMs += Math.max(0, endedAt - phonicUserSpeechStartedAt);
    phonicUserSpeechStartedAt = 0;
  }
  if (phonicAssistantSpeechStartedAt) {
    phonicAssistantSpeechMs += Math.max(0, endedAt - phonicAssistantSpeechStartedAt);
    phonicAssistantSpeechStartedAt = 0;
  }
  const startedAt = Date.parse(phonicUsageSession.startedAt) || phonicUsageStartedAt;
  const voiceDurationMs = Math.max(0, Math.min(4 * 60 * 60 * 1000, endedAt - startedAt));
  const usageSession = phonicUsageSession;
  phonicUsageSession = null;
  if (voiceDurationMs < 1000) return;
  try {
    const response = await fetch(PHONIC_API_BASE_URL + "/api/phonic/usage", {
      method: "POST",
      headers: await authenticatedApiHeaders(),
      body: JSON.stringify({
        usageSession,
        voiceDurationMs,
        userSpeechMs: Math.min(voiceDurationMs, phonicUserSpeechMs),
        assistantSpeechMs: Math.min(voiceDurationMs, phonicAssistantSpeechMs)
      })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(String(payload.error || "Phonic usage could not be recorded."));
    }
  } catch (error) {
    console.info("SYNQ.ME could not record Phonic session usage.", String(error?.message || "usage event failed").slice(0, 140));
  } finally {
    phonicUsageStartedAt = 0;
    phonicUserSpeechMs = 0;
    phonicAssistantSpeechMs = 0;
  }
}

function showVoiceAudioPause() {
  const wasSpeaking = assistantIsSpeaking || elements.voiceOrb?.dataset.state === "speech-pause";
  assistantIsSpeaking = false;
  if (!wasSpeaking) {
    updateVoiceExperience("thinking", companionThinkingMessage(selectedCompanionDisplayName()));
    if (elements.conversationStatus) elements.conversationStatus.textContent = companionThinkingMessage(selectedCompanionDisplayName());
    return;
  }
  // Preserve the turn label across packet/sentence gaps, but stop the face
  // immediately. A genuine stall can still show a thinking state.
  updateVoiceExperience("speech-pause");
  if (voiceAudioPauseTimer !== null) window.clearTimeout(voiceAudioPauseTimer);
  voiceAudioPauseTimer = window.setTimeout(() => {
    voiceAudioPauseTimer = null;
    if (!voiceModeActive || elements.voiceOrb?.dataset.state !== "speech-pause") return;
    updateVoiceExperience("thinking", companionThinkingMessage(selectedCompanionDisplayName()));
    if (elements.conversationStatus) elements.conversationStatus.textContent = companionThinkingMessage(selectedCompanionDisplayName());
  }, 1200);
}

function showVoiceWaitingForUser() {
  armVoiceIdle();
  if (phonicAssistantSpeechStartedAt) {
    phonicAssistantSpeechMs += Math.max(0, Date.now() - phonicAssistantSpeechStartedAt);
    phonicAssistantSpeechStartedAt = 0;
  }
  assistantIsSpeaking = false;
  const owner = String(state.profile.ownerName || "").trim();
  const message = owner ? "Waiting on " + owner + "." : "Waiting on you.";
  updateVoiceExperience(voiceInputMuted ? "muted" : "listening", voiceInputMuted ? "Microphone muted. Turn it on when you are ready." : message);
  if (elements.voiceStatus) elements.voiceStatus.textContent = voiceInputMuted ? "Microphone muted" : message;
  if (elements.conversationStatus) elements.conversationStatus.textContent = voiceInputMuted ? "Microphone muted" : message;
}

function handlePhonicVoiceEvent(event) {
  const companion = selectedCompanionDisplayName();
  switch (event.type) {
    case "open":
      updateVoiceExperience("connecting", "Getting your voice connection ready…");
      if (elements.voiceStatus) elements.voiceStatus.textContent = "Connecting your voice…";
      if (elements.conversationStatus) elements.conversationStatus.textContent = "Getting ready to listen";
      break;
    case "ready":
      voiceBreakTracker.start();
      armVoiceIdle();
      updateVoiceExperience("listening", companion + " is listening. Speak naturally.");
      if (elements.voiceStatus) {
        elements.voiceStatus.dataset.error = "";
        elements.voiceStatus.textContent = "Voice ready · " + normaliseVoicePreference(state.profile.robotVoice) + " voice";
      }
      if (elements.conversationStatus) elements.conversationStatus.textContent = companion + " is listening";
      break;
    case "user_started_speaking":
      lastVoiceWasTodo = false;
      lastVoiceWasBreak = false;
      voicePauseAfterReply = false;
      clearVoiceIdle();
      if (phonicAssistantSpeechStartedAt) {
        phonicAssistantSpeechMs += Math.max(0, Date.now() - phonicAssistantSpeechStartedAt);
        phonicAssistantSpeechStartedAt = 0;
      }
      assistantIsSpeaking = false;
      if (!phonicUserSpeechStartedAt) phonicUserSpeechStartedAt = Date.now();
      updateVoiceExperience("user-speaking", "Listening to you…");
      if (elements.conversationStatus) elements.conversationStatus.textContent = "Listening";
      break;
    case "user_finished_speaking":
      clearVoiceIdle();
      if (phonicUserSpeechStartedAt) {
        phonicUserSpeechMs += Math.max(0, Date.now() - phonicUserSpeechStartedAt);
        phonicUserSpeechStartedAt = 0;
      }
      updateVoiceExperience("thinking", companionThinkingMessage(companion));
      if (elements.conversationStatus) elements.conversationStatus.textContent = companionThinkingMessage(companion);
      break;
    case "input_cancelled":
      showVoiceWaitingForUser();
      break;
    case "input_text": {
      // Save the user's live speech transcription immediately, not only when
      // the subsequent assistant tool call arrives.
      const synced = syncPhonicTranscriptItems(event.items);
      if (synced.userAdded) void flushCloudSave();
      if (!assistantIsSpeaking && elements.voiceOrb?.dataset.state !== "speech-pause" && elements.conversationStatus) elements.conversationStatus.textContent = companionThinkingMessage(companion);
      break;
    }
    case "assistant_waiting_for_audio":
      clearVoiceIdle();
      if (phonicAssistantSpeechStartedAt) {
        phonicAssistantSpeechMs += Math.max(0, Date.now() - phonicAssistantSpeechStartedAt);
        phonicAssistantSpeechStartedAt = 0;
      }
      showVoiceAudioPause();
      break;
    case "assistant_awaiting_user":
      showVoiceWaitingForUser();
      break;
    case "assistant_started_speaking":
      clearVoiceIdle();
      if (!phonicAssistantSpeechStartedAt) phonicAssistantSpeechStartedAt = Date.now();
      assistantIsSpeaking = true;
      updateVoiceExperience("speaking", companionThinkingMessage(companion));
      if (elements.conversationStatus) elements.conversationStatus.textContent = companionThinkingMessage(companion);
      break;
    case "audio_chunk": {
      const synced = syncPhonicTranscriptItems(event.items);
      if (synced.userAdded) void flushCloudSave();
      break;
    }
    case "assistant_finished_speaking": {
      armVoiceIdle();
      if (phonicAssistantSpeechStartedAt) {
        phonicAssistantSpeechMs += Math.max(0, Date.now() - phonicAssistantSpeechStartedAt);
        phonicAssistantSpeechStartedAt = 0;
      }
      assistantIsSpeaking = false;
      const synced = syncPhonicTranscriptItems(event.items);
      if (synced.userAdded) void flushCloudSave();
      const latestUser = [...state.messages].reverse().find((message) => message.role === "user")?.content || "";
      const latestAssistant = state.messages[state.messages.length - 1]?.role === "assistant"
        ? state.messages[state.messages.length - 1].content
        : "";
      if (!lastVoiceWasTodo && !lastVoiceWasBreak && latestUser && latestAssistant) state.pendingClarification = detectPendingClarification(latestUser, latestAssistant);
      persist();
      renderAll();
      void flushCloudSave();
      if (voicePauseAfterReply) {
        voicePauseAfterReply = false;
        stopVoiceConversation("Paused. Press Start to continue.");
        break;
      }
      showVoiceWaitingForUser();
      break;
    }
    case "error": {
      const detail = voiceFailureMessage(event.error);
      stopVoiceConversation(detail);
      if (elements.voiceStatus) {
        elements.voiceStatus.dataset.error = "true";
        elements.voiceStatus.textContent = detail;
      }
      updateVoiceExperience("idle", detail);
      break;
    }
    case "close":
      assistantIsSpeaking = false;
      if (voiceModeActive) stopVoiceConversation("Your voice session has ended.");
      break;
    default:
      break;
  }
}

async function translatedVoiceBreakQuestion(language, kind = "offer") {
  const standard = standardBreakPhrase(language, kind);
  if (standard) return standard;
  try {
    const response = await fetch(API_BASE + "/api/voice/break-offer", { method:"POST", headers:await authenticatedApiHeaders(), body:JSON.stringify({language,kind}), signal:AbortSignal.timeout(15000) });
    const result = await response.json();
    return response.ok && typeof result?.question === "string" && result.question.length <= 350 ? result.question : null;
  } catch { return null; }
}

async function handlePhonicAmiaToolCall({ name, parameters = {}, items = [] } = {}) {
  const language = state.profile.preferredLanguage || "en";
  const unavailable = localizedAIUnavailable(language);
  if (name !== "amia_next_turn") return { status: "error", assistant_text: unavailable };

  const latestItem = [...(items || [])].reverse().find(item=>item?.role==='user' && typeof item.text==='string' && item.text.trim());
  const latestUserText = bestUserTranscript(latestItem?.text, parameters.latest_user_message);
  const finalItems = items.map(item=>item===latestItem?{...item,text:latestUserText}:item);
  const synced = syncPhonicTranscriptItems(finalItems,{finalize:true});
  if (synced.userAdded) void flushCloudSave();
  if (!latestUserText) return { status: "error", assistant_text: unavailable };
  const answeringBreak = voiceBreakTracker.awaiting();
  const breakChoice = answeringBreak ? breakResponse(latestUserText) : null;
  lastVoiceWasTodo = Boolean(todoCommandForMessage(latestUserText));
  voicePauseAfterReply = conversationIntent(latestUserText) === "pause" || breakResponse(latestUserText) === "pause";
  if (isOutOfHomeTopicChange(latestUserText)) activeOutOfHomeScenarioContext = null;

  const latestKey = latestItem ? String(latestItem.itemIdx) : "";
  const mappedId = latestKey ? phonicItemMap.get(latestKey) : undefined;
  const mappedMessage = mappedId ? state.messages.find(item=>item.role==='user' && item.voice_turn_id===mappedId) : null;
  if (!mappedMessage || mappedMessage.role !== "user" || mappedMessage.content !== latestUserText) {
    const timestamp = new Date().toISOString();
    state.messages.push({ role: "user", content: latestUserText, timestamp });
    if (latestKey) { state.messages.at(-1).voice_turn_id = globalThis.crypto?.randomUUID?.() || timestamp; state.messages.at(-1).transcript_final = true; phonicItemMap.set(latestKey, state.messages.at(-1).voice_turn_id); }
    const preferenceIdsBeforeTurn = new Set(state.preferences.map((preference) => String(preference.id)));
    const clarificationRequest = isClarificationRequest(latestUserText);
    const answeredPendingClarification = lastVoiceWasTodo || answeringBreak ? false : resolvePendingClarification(latestUserText);
    if (!answeredPendingClarification && !clarificationRequest) savePreference(latestUserText);
    const preferenceWasAdded = state.preferences.some((preference) => !preferenceIdsBeforeTurn.has(String(preference.id)));
    phonicTurnMetadata.set(latestKey || "fallback", {
      timestamp,
      shouldExtractStructuredMemory: shouldExtractPersonaMemory(latestUserText, preferenceWasAdded) ||
        Boolean(answeredPendingClarification && latestUserText.length >= 4),
      text: latestUserText
    });
    persist();
    renderAll();
    void flushCloudSave();
  }

  const metadata = phonicTurnMetadata.get(latestKey || "fallback") || {
    timestamp: new Date().toISOString(),
    shouldExtractStructuredMemory: shouldExtractPersonaMemory(latestUserText, true),
    text: latestUserText
  };

  queueStructuredMemoryTurn(latestUserText, metadata.timestamp);
  try {
    if (answeringBreak && breakChoice !== "clarify") voiceBreakTracker.resume();
    voiceBreakOfferDue = !answeringBreak && !lastVoiceWasTodo && !voicePauseAfterReply && voiceBreakTracker.due();
    let reply = answeringBreak && ["pause", "clarify"].includes(breakChoice)
      ? await translatedVoiceBreakQuestion(language, breakChoice) || unavailable
      : await requestAIReply();
    const replyNeedsRepair = (value) => !value ||
      value === "__SYNQME_UNHELPFUL_AI_RESPONSE__" ||
      responseRepeatsUser(value, latestUserText) ||
      responseRepeatsRecentAssistant(value);
    if (!answeringBreak && replyNeedsRepair(reply) && state.apiConnected && !lastAIReplyUsedFallback) {
      const retriedReply = await requestAIReply(true);
      if (retriedReply && retriedReply !== "__SYNQME_UNHELPFUL_AI_RESPONSE__" && !replyNeedsRepair(retriedReply)) {
        reply = retriedReply;
      }
    }
    if (!reply || reply === "__SYNQME_UNHELPFUL_AI_RESPONSE__") {
      // Keep internal API diagnostics out of speech; they remain visible in the UI.
      reply = unavailable;
    }

    if (voiceBreakOfferDue && voiceModeActive) {
      const question = await translatedVoiceBreakQuestion(language);
      if (question && voiceModeActive && voiceBreakTracker.due()) {
        reply = [responseBeforeBreak(reply), question].filter(Boolean).join("\n\n");
        voiceBreakTracker.offered();
      }
    }
    lastVoiceWasBreak = answeringBreak && breakChoice !== "other" || voiceBreakTracker.awaiting();
    voiceBreakOfferDue = false;
    const spokenReply = spokenSentenceBreaks(enforceFirstPersonTaskQuestions(
      reply.trim() || unavailable,
      selectedCompanionDisplayName()
    ));
    if (!lastVoiceWasTodo && !answeringBreak && !voiceBreakTracker.awaiting()) state.pendingClarification = detectPendingClarification(latestUserText, spokenReply);
    void refreshRoomJourneyProgress();
    phonicTurnMetadata.delete(latestKey || "fallback");
    if (state.profile.shareAnonymizedLearning === true) void contributeSharedKnowledgeFromTurn();

    // Save the exact text that Phonic is about to speak. Assistant audio
    // transcript fragments are intentionally ignored by the chat synchroniser.
    const latestMessage = state.messages[state.messages.length - 1];
    if (!isServiceErrorText(spokenReply) && !(latestMessage?.role === "assistant" &&
          normalisePhonicText(latestMessage.content) === normalisePhonicText(spokenReply))) {
      state.messages.push({ role: "assistant", content: spokenReply, timestamp: new Date().toISOString() });
    }
    persist();
    renderAll();
    void flushCloudSave();
    return { status: "ok", decision_owner: "AMÏA", assistant_text: spokenReply.replace(/\bSYNQ\.ME\b/gi, "sink me") };
  } catch (error) {
    console.info("SYNQ.ME AMÏA voice decision failed.", error);
    return { status: "error", assistant_text: state.apiErrorDetail || unavailable };
  }
}

async function openVoiceExperience({ activate = false } = {}) {
  welcomeBackPending ||= shouldWelcomeBack(state.messages);
  if (!elements.voiceExperience) return;
  if (!cloudUserId) {
    setAuthGateVisible(true);
    setAuthMode("signin", "Sign in or create an account before continuing. Your conversation history is saved to your account.");
    return;
  }
  if (!profileComplete()) {
    openSettings();
    if (elements.conversationStatus) elements.conversationStatus.textContent = "Complete your profile to begin";
    return;
  }
  if (voiceModeActive) return;

  elements.voiceExperience.hidden = false;
  const appNav = document.querySelector("#appBottomNav");
  if (appNav) elements.voiceExperience.append(appNav);
  document.body.classList.add("voice-experience-open");
  if (!activate) {
    updateVoiceCompanionLabels();
    updateVoiceExperience("idle", "Press Start when you are ready to talk.");
    updateVoiceModeButton();
    return;
  }
  voiceInputMuted = false;
  voiceModeActive = true;
  void requestVoiceWakeLock();
  assistantIsSpeaking = false;
  phonicUsageSession = null;
  phonicUsageStartedAt = 0;
  phonicUserSpeechStartedAt = 0;
  phonicAssistantSpeechStartedAt = 0;
  phonicUserSpeechMs = 0;
  phonicAssistantSpeechMs = 0;
  phonicUsageSubmitted = false;
  phonicItemMap.clear();
  phonicTurnMetadata.clear();
  updateVoiceCompanionLabels();
  updateVoiceModeButton();
  if (elements.voiceStatus) {
    elements.voiceStatus.dataset.error = "";
    elements.voiceStatus.textContent = "Connecting your voice…";
  }
  updateVoiceExperience("connecting", "Requesting microphone access and preparing your voice…");
  if (elements.conversationStatus) elements.conversationStatus.textContent = "Connecting your voice";

  let startingConversation = null;
  try {
    void checkAIBackend();
    startingConversation = createPhonicVoiceConversation({
      getSession: async () => {
        const response = await fetch(PHONIC_API_BASE_URL + "/api/phonic/session", {
          method: "POST",
          headers: await authenticatedApiHeaders({
            ...(googlePlayCheckout.enabled ? { "X-MSS-Billing-Client": "android-1.7" } : {})
          }),
          body: JSON.stringify({})
        });
        let payload = {};
        try { payload = await response.json(); } catch {}
        if (!response.ok) throw new Error(payload.error || "Voice session could not be created (HTTP " + response.status + ").");
        phonicUsageSession = payload.usageSession || null;
        phonicUsageStartedAt = Date.parse(phonicUsageSession?.startedAt || "") || Date.now();
        return payload;
      },
      getConfig: () => buildPhonicConfig(),
      onEvent: handlePhonicVoiceEvent,
      onToolCall: handlePhonicAmiaToolCall
    });
    phonicVoiceConversation = startingConversation;
    await startingConversation.start();
  } catch (error) {
    // Closing the screen while permission or connection is pending is an
    // intentional cancellation. Do not replace its status with an error.
    if (!voiceModeActive || phonicVoiceConversation !== startingConversation) return;
    const detail = voiceFailureMessage(error);
    stopVoiceConversation(detail);
    if (elements.voiceStatus) {
      elements.voiceStatus.dataset.error = "true";
      elements.voiceStatus.textContent = detail;
    }
    updateVoiceExperience("idle", detail);
    if (elements.conversationStatus) elements.conversationStatus.textContent = "Voice unavailable · text chat remains available";
  }
}

function closeVoiceExperience(statusMessage) {
  stopVoiceConversation(statusMessage || "Voice conversation stopped.");
  voiceInputMuted = false;
  if (elements.voiceExperience) elements.voiceExperience.hidden = true;
  document.body.classList.remove("voice-experience-open");
  const appNav = document.querySelector("#appBottomNav");
  if (appNav) document.body.append(appNav);
  syncAppNavigation();
}

function toggleVoiceInputMute() {
  if (!voiceModeActive) return;
  voiceInputMuted = !voiceInputMuted;
  if (phonicVoiceConversation) phonicVoiceConversation.setMuted(voiceInputMuted);
  if (assistantIsSpeaking) {
    updateVoiceExperience("speaking", companionThinkingMessage(selectedCompanionDisplayName()) + (voiceInputMuted ? " Microphone muted." : ""));
  } else if (voiceInputMuted) {
    updateVoiceExperience("muted", "Microphone muted. Turn it on when you are ready.");
  } else {
    updateVoiceExperience("listening", "Microphone on. Speak whenever you are ready.");
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
    ownerAvatarNeedsCloudSync = true;
    ownerAvatarRevision += 1;
    saveOwnerAvatar();
    renderOwnerAvatarPreview();
    renderMessages();
    persist(false);
    scheduleCloudSave(0);
    if (elements.voiceStatus) {
      elements.voiceStatus.textContent = cloudUserId
        ? "Photo removal · synchronising across devices…"
        : "Photo removed from this browser. Sign in to sync the change.";
    }
    if (cloudUserId) {
      void flushCloudSave().then((saved) => {
        if (elements.voiceStatus) elements.voiceStatus.textContent = saved
          ? "Photo removal synced across devices."
          : "Photo removed here; cloud sync needs attention.";
      });
    }
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
  elements.voiceEndButton?.addEventListener("click", () => {
    if (voiceModeActive) stopVoiceConversation("Paused. Press Start to continue.");
    else void openVoiceExperience({ activate: true });
  });
  elements.voiceChatButton?.addEventListener("click", () => closeVoiceExperience("Returned to text chat."));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && elements.voiceExperience && !elements.voiceExperience.hidden) {
      closeVoiceExperience("Returned to text chat.");
    }
  });
}

function updateVoiceModeButton() {
  syncAppNavigation();
  const control = elements.voiceEndButton;
  if (control) {
    control.setAttribute("aria-label", voiceModeActive ? "Pause voice conversation" : "Start voice conversation");
    const label = control.querySelector("[data-voice-session-label]");
    if (label) label.textContent = voiceModeActive ? "Pause" : "Start";
    const icon = control.querySelector("svg");
    if (icon) icon.innerHTML = voiceModeActive ? '<path d="M8 5v14M16 5v14"/>' : '<path d="m9 5 10 7-10 7Z"/>';
  }
  for (const button of [elements.voiceMuteButton, elements.voiceMuteControlButton]) if (button) button.disabled = !voiceModeActive;
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
  voiceBreakTracker.stop(); voiceBreakOfferDue = false;
  voicePauseAfterReply = false;
  clearVoiceIdle();
  if (voiceWakeLock) { void voiceWakeLock.release().catch(() => {}); voiceWakeLock = null; }
  void submitPhonicUsage();
  voiceModeActive = false;
  voiceInputMuted = false;
  assistantIsSpeaking = false;
  const activePhonic = phonicVoiceConversation;
  phonicVoiceConversation = null;
  if (activePhonic) void activePhonic.stop();
  updateVoiceExperience("idle", statusMessage);
  if (elements.voiceStatus) {
    elements.voiceStatus.dataset.error = statusMessage === "Voice conversation stopped." ? "" : "true";
    elements.voiceStatus.textContent = statusMessage;
  }
  updateVoiceModeButton();
  if (elements.conversationStatus) elements.conversationStatus.textContent = "Ready to talk";
}

elements.voiceModeButton?.addEventListener("click", () => {
  if (voiceModeActive && elements.voiceExperience && !elements.voiceExperience.hidden) {
    closeVoiceExperience("Voice conversation stopped.");
    return;
  }
  openVoiceExperience();
});

initialiseRobotAndVoiceControls();
initialisePexiManifestControls();

function syncAppNavigation() {
  const view = document.body.dataset.appView || "home";
  const selected = elements.voiceExperience && !elements.voiceExperience.hidden ? "talk" : view === "journey" ? "passport" : view;
  document.querySelectorAll("[data-app-tab]").forEach((button) => {
    if (button.dataset.appTab === selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function selectAppView(view) {
  if(view === "profile") void voiceBalance.refresh();
  closeSettings();
  if (elements.taskResult) elements.taskResult.hidden = true;
  if (view === "chat" && document.body.dataset.appView !== "chat" && cloudUserId && roomJourney && state.messages.some(item=>item.role==='user')) {
    welcomeBackPending = true;
    const scope = activeOutOfHomeScenarioContext ? "outside:" + activeOutOfHomeScenarioContext.categoryId + ":" + activeOutOfHomeScenarioContext.scenarioId : "room:" + roomJourney.active_room_id;
    const checkpoint = conversationCheckpoint(state.messages,scope);
    chatReturnSummary = (state.profile.preferredLanguage || "en") === "en" ? (checkpoint ? englishResumeReply(checkpoint,state.profile.ownerName) : "Welcome back, " + state.profile.ownerName.trim().split(/\s+/)[0] + ". We were working on " + (scenarioForId(scope)?.title || roomJourney.active_room_id.replaceAll('_',' ')) + ". Your saved conversation is above.") : "";
  }
  if (elements.voiceExperience && !elements.voiceExperience.hidden) closeVoiceExperience("Returned to your conversation.");
  document.body.dataset.appView = ["home", "passport", "profile", "journey"].includes(view) ? view : "chat";
  const workspace = document.querySelector("#moreWorkspace");
  if (workspace) workspace.open = view === "journey";
  if (view === "journey") { journeyDisplay = "scenarios"; renderScenarioJourney(); }
  else if (view === "chat") { prepareWelcomeAudioOffer(); renderMessages(); }
  if (typeof mssInterface !== "undefined") mssInterface?.render();
  syncAppNavigation();
  window.requestAnimationFrame(updateChatScrollbar);
  window.scrollTo({top:0,behavior:"smooth"});
}

document.querySelectorAll("[data-app-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.appTab;
    if (view === "talk") {
      if (elements.voiceExperience && !elements.voiceExperience.hidden) return;
      selectAppView("chat");
      void openVoiceExperience();
    } else selectAppView(view);
  });
});
syncAppNavigation();



function introAudioStorageKey() {
  return INTRO_AUDIO_DISMISSED_KEY + ":" + String(cloudUserId || "unknown");
}

function prepareWelcomeAudioOffer() {
  if (!cloudUserId || !elements.welcomeAudioOffer || !elements.chatStage) return;
  let dismissed = false;
  try { dismissed = localStorage.getItem(introAudioStorageKey()) === "true"; } catch {}
  // An existing conversation always opens directly, including on a new device.
  dismissed ||= state.messages.some(message => message.role === "user" && message.content?.trim());
  elements.welcomeAudioOffer.hidden = dismissed;
  elements.chatStage.hidden = !dismissed;
  if (elements.introAudioReplay) elements.introAudioReplay.hidden = !dismissed;
  if (elements.welcomeAudioPlayer && !dismissed) {
    elements.welcomeAudioPlayer.pause();
    try { elements.welcomeAudioPlayer.currentTime = 0; } catch {}
  }
}

function finishWelcomeAudioOffer() {
  if (!cloudUserId) {
    setAuthGateVisible(true);
    setAuthMode("signin", "Sign in before starting your SecondSelf conversation.");
    return;
  }
  try { localStorage.setItem(introAudioStorageKey(), "true"); } catch {}
  if (elements.welcomeAudioPlayer) {
    elements.welcomeAudioPlayer.pause();
    try { elements.welcomeAudioPlayer.currentTime = 0; } catch {}
  }
  if (elements.welcomeAudioOffer) elements.welcomeAudioOffer.hidden = true;
  if (elements.chatStage) elements.chatStage.hidden = false;
  if (elements.introAudioReplay) elements.introAudioReplay.hidden = false;
  elements.messageInput?.focus({ preventScroll: true });
}

function openWelcomeAudioOffer() {
  closeSettings();
  selectAppView("chat");
  if (!cloudUserId) {
    setAuthGateVisible(true);
    setAuthMode("signin", "Sign in before starting your SecondSelf conversation.");
    return;
  }
  if (elements.welcomeAudioPlayer) {
    elements.welcomeAudioPlayer.pause();
    try { elements.welcomeAudioPlayer.currentTime = 0; } catch {}
  }
  if (elements.welcomeAudioOffer) elements.welcomeAudioOffer.hidden = false;
  if (elements.chatStage) elements.chatStage.hidden = true;
  if (elements.introAudioReplay) elements.introAudioReplay.hidden = true;
  elements.welcomeAudioOffer?.scrollIntoView({ behavior: "smooth", block: "center" });
}

elements.welcomeAudioContinue?.addEventListener("click", finishWelcomeAudioOffer);
elements.welcomeAudioSkip?.addEventListener("click", finishWelcomeAudioOffer);
elements.introAudioReplay?.addEventListener("click", openWelcomeAudioOffer);

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
  if (/what matters most to you when getting that right/i.test(String(reply || ""))) return true;
  return assistantReplyRepeatsRecentAssistant(reply, state.messages);
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

async function saveApplianceRecord(appliance) {
  if (!supabase || !cloudUserId || !appliance || typeof appliance !== "object") return false;
  const type = String(appliance.type || "").trim().slice(0, 80);
  const brand = String(appliance.brand || "").trim().slice(0, 80);
  const model = String(appliance.model || "").trim().slice(0, 80);
  if (!type || !brand || !model) return false;
  const key = makePersonaMemoryKey("appliance " + type + " " + brand + " " + model);
  const existing = personaMemoryRecords.find((item) => item.memory_key === key);
  const record = { type, brand, model, manual_url: appliance.manual_status === "matched" ? String(appliance.manual_url || "").slice(0, 2048) : existing?.attributes?.appliance_v1?.manual_url || null,
    manual_status: appliance.manual_status || "unverified", verified_at: appliance.verified_at || existing?.attributes?.appliance_v1?.verified_at || null, checked_at: new Date().toISOString() };
  const statement = "My " + type + " is " + brand + " model " + model + ".";
  const userId = cloudUserId;
  try {
    const { data, error } = await supabase.from("synqme_persona_memories").upsert({ user_id: userId, memory_key: key, topic: "general_household", kind: "fact", scope_key: "appliance." + key,
      statement, status: "user_stated", relation: "new", confidence: 1, conditions: [], attributes: { appliance_v1: record }, search_terms: [type, brand, model],
      search_keys: buildPersonaMemorySearchKeys(statement, [type, brand, model], "general_household"), source_message: statement, source_conversation_key: "main", archived_at: null
    }, { onConflict: "user_id,memory_key" }).select(PERSONA_MEMORY_SELECT_COLUMNS).single();
    if (error) throw error;
    if (userId !== cloudUserId) return false;
    personaMemoryRecords = [...personaMemoryRecords.filter((item) => item.memory_key !== key), data];
    return true;
  } catch (error) { console.info("Appliance details could not be saved.", error?.code || "storage error"); return false; }
}

async function requestAIReply(repairMode = false) {
  const latestReminderText = [...state.messages].reverse().find(item => item.role === "user")?.content || "";
  const reminderCommand = todoCommandForMessage(latestReminderText);
  if (reminderCommand) {
    const reminderReply = await handleTodoCommand(reminderCommand);
    const reply = welcomeBackPending ? welcomeBackReply(reminderReply, state.profile.ownerName, state.profile.preferredLanguage || "en") : reminderReply;
    welcomeBackPending = false; lastAIReplyUsedFallback = true; return reply;
  }
  const deferredInfo = applianceReminderTurn(state.messages);
  if (deferredInfo?.reply && (state.profile.preferredLanguage || "en") === "en") { lastAIReplyUsedFallback = true; return deferredInfo.reply; }
  const requestUserId = cloudUserId;
  if (roomJourney) {
    const currentUser = [...state.messages].reverse().find(item => item.role === "user");
    const maySwitch = completedScenarioIds(scenarioData().completed).includes("room:" + roomJourney.active_room_id);
    const focusId = maySwitch ? resolveConversationRoomId(currentUser ? [currentUser] : [], roomJourney.active_room_id) : roomJourney.active_room_id;
    if (focusId !== roomJourney.active_room_id) {
      activeOutOfHomeScenarioContext = null;
      state.pendingClarification = null;
      await persistRoomJourneyChanges({ active_room_id: focusId, active_task_id: null, room_progress: { ...roomJourney.room_progress, [SCENARIO_PROGRESS_KEY]: { ...scenarioData(), focusStartedAt: new Date().toISOString() } } });
      renderAll();
    }
  }
  if (!API_BASE) return null;
  if (!state.apiProvider) await checkAIBackend();
  if (state.apiProvider !== "deepseek") {
    state.apiConnected = false;
    state.apiError = "deepseek-only policy";
    state.apiErrorDetail = state.apiProvider
      ? "AMÏA could not verify the AI service connection. Please try again shortly."
      : "AMÏA could not establish a verified AI service connection. Please try again shortly.";
    return null;
  }
  if (!repairMode) lastAIReplyUsedFallback = false;
  state.apiErrorDetail = "";
  try {
    const preferences = activeLegacyPreferences().map((preference) => {
      const extracted = preferenceExtraction(preference);
      return {
        category: preference.category || classifyPreference(preference.text),
        text: preference.text,
        epistemicStatus: preference.status || "user_stated",
        explicitFields: extracted.explicitFields,
        unresolvedFields: extracted.unresolvedFields,
        clarifications: Array.isArray(preference.clarifications) ? preference.clarifications : []
      };
    });
    const domesticFunctions = state.functions
      .map((id) => ACTIVITIES.find((activity) => activity.id === id)?.label)
      .filter(Boolean);
    const conversationMessages = state.messages.slice(-20).map((message) => ({
      role: message.role,
      content: message.content,
      scenario_id: message.scenario_id
    }));
    const currentUserText = state.messages[state.messages.length - 1]?.content || "";
    const activeRoomName = ROOM_JOURNEY_ROOMS.find(room => room.id === roomJourney?.active_room_id)?.name || "";
    const retrievalQuery = currentUserText + (activeOutOfHomeScenarioContext ? "" : " " + activeRoomName);
    const [memoryReferences, sharedKnowledgeReferences, relevantPersonaMemories, requestHeaders] = await Promise.all([
      getHomeMemoryReferences(retrievalQuery),
      Promise.resolve([]),
      getRelevantPersonaMemories(retrievalQuery),
      authenticatedApiHeaders()
    ]);
    if (!requestUserId || requestUserId !== cloudUserId) return null;
    if (requestUserId !== cloudUserId) return null;
    const response = await fetch(API_BASE + "/api/chat", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        messages: conversationMessages,
        sourceMessageTimestamp: state.messages[state.messages.length - 1]?.timestamp || null,
        conversationCheckpoint: conversationCheckpoint(state.messages.slice(0,-1), activeOutOfHomeScenarioContext ? "outside:" + activeOutOfHomeScenarioContext.categoryId + ":" + activeOutOfHomeScenarioContext.scenarioId : "room:" + (roomJourney?.active_room_id || "kitchen")),
        areaLearningStatus: (() => {
          const id = activeOutOfHomeScenarioContext ? "outside:" + activeOutOfHomeScenarioContext.categoryId + ":" + activeOutOfHomeScenarioContext.scenarioId : "room:" + (roomJourney?.active_room_id || "kitchen");
          const scenario = scenarioForId(id);
          return scenario ? scenarioTasks(scenario).map(task => ({ id: task.id, status: areaLearningState(id, task.id, personaMemoryRecords, scenarioData().reviewed?.[id] || []).status })) : [];
        })(),
        conversationContinuity: buildConversationContinuity(state.messages, activeOutOfHomeScenarioContext ? "outside:" + activeOutOfHomeScenarioContext.categoryId + ":" + activeOutOfHomeScenarioContext.scenarioId : "room:" + (roomJourney?.active_room_id || "kitchen")),
        preferences,
        profile: {
          ownerName: state.profile.ownerName,
          robotName: state.profile.robotName,
          companionName: selectedCompanionDisplayName(),
          robotType: state.profile.robotType,
          robotVoice: normaliseVoicePreference(state.profile.robotVoice),
          preferredLanguage: state.profile.preferredLanguage || "en",
          askBeforeActions: state.profile.confirmActions
        },
        domesticFunctions,
        applianceRecords: activePersonaMemories().filter((item) => item.attributes?.appliance_v1 && item.status !== "conflicting").slice(0, 20).map((item) => item.attributes.appliance_v1),
        roomJourney: buildCurrentRoomJourneyContext(),
        outOfHomeScenarioContext: activeOutOfHomeScenarioContext,
        pendingClarification: state.pendingClarification,
        memoryReferences: memoryReferences.map(({ role, content, timestamp, topics }) => ({ role, content, timestamp, topics })),
        personaMemories: relevantPersonaMemories.map(({ memory_key, topic, kind, scope_key, statement, status, confidence, conditions, source_message, source_timestamp, conflict_group }) => ({
          memory_key, topic, kind, scope_key, statement, status, confidence, conditions, source_message, source_timestamp, conflict_group
        })),
        sharedKnowledgeReferences,
        repairMode, voiceBreakDue: voiceModeActive && voiceBreakOfferDue, welcomeBack: welcomeBackPending
      })
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (requestUserId !== cloudUserId) return null;
    const responseProvider = typeof data.provider === "string" ? data.provider.toLowerCase() : state.apiProvider;
    if (responseProvider && responseProvider !== "deepseek") {
      throw new Error("The AI service connection did not pass its configuration check.");
    }
    if (data.provider) state.apiProvider = responseProvider;
    if (data.model) state.apiModel = String(data.model);
    if (!response.ok) {
      state.apiConfigured = true;
      const errorMessage = String(data.error || ("AI endpoint returned " + response.status));
      const apiError = new Error(errorMessage);
      apiError.apiStatus = response.status;
      apiError.upstreamStatus = Number.isInteger(data.upstreamStatus) ? data.upstreamStatus : null;
      apiError.errorCode = typeof data.errorCode === "string" ? data.errorCode : "";
      throw apiError;
    }
    const reply = typeof data.reply === "string" ? data.reply : typeof data.message === "string" ? data.message : "";
    if (!reply.trim()) throw new Error("AI endpoint returned no reply text");
    if (data.appliance && cloudUserId === requestUserId) {
      if (data.amiaPersistence?.appliance_saved) void loadPersonaMemories();
      else await saveApplianceRecord(data.appliance);
    }
    if (data.amiaPersistence?.status === "unavailable" && elements.personaMemoryStatus) {
      elements.personaMemoryStatus.textContent = "Your reply is available, but decision tracking could not be saved this turn.";
    }
    state.apiConnected = true;
    state.apiConfigured = true;
    state.apiError = "";
    state.apiErrorDetail = "";

    // The backend can mark an output for review; don't initiate a second request
    // for a turn that already used its own fallback or repair strategy.
    lastAIReplyUsedFallback = Boolean(data.usedFallback || data.responseNeedsReview || data.resumed);
    if (data.responseNeedsReview) return "__SYNQME_UNHELPFUL_AI_RESPONSE__";
    const returningReply = welcomeBackPending ? welcomeBackReply(reply.trim(), state.profile.ownerName, state.profile.preferredLanguage || "en") : reply.trim();
    const personalised = addressByNameReply(returningReply, state.profile.ownerName, state.messages);
    welcomeBackPending = false;
  chatReturnSummary = "";
    return personalised;
  } catch (error) {
    console.info("SYNQ.ME AI request failed; no scripted question will be substituted.", error);
    state.apiConnected = false;
    state.apiError = responseErrorLabel(error);
    // Keep provider and model diagnostics in developer logs, not in the user interface.
    state.apiErrorDetail = "AMÏA is temporarily unavailable. Please try again shortly.";
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

async function checkAIBackend() {
  if (!API_BASE) return;
  try {
    const response = await fetch(API_BASE + "/health", { cache: "no-store" });
    if (!response.ok) throw new Error("Health check returned " + response.status);
    const data = await response.json();
    state.apiProvider = typeof data.provider === "string" ? data.provider.toLowerCase() : "";
    state.apiModel = typeof data.model === "string" ? data.model : "";
    state.apiConfigured = Boolean(data.configured);
    state.apiError = "";
    if (!state.apiConnected) {
      renderAll();
      elements.conversationStatus.textContent = state.apiConfigured
        ? "AMÏA is ready"
        : "AMÏA is temporarily unavailable";
    }
  } catch (error) {
    state.apiError = "health check unavailable";
    if (!state.apiConnected) {
      renderAll();
      elements.conversationStatus.textContent = "AMÏA connection could not be verified";
    }
    console.info("SYNQ.ME could not verify backend provider settings.", error);
  }
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
  chatReturnSummary = "";
  if (!message || isSending) return;
  const todoTurn = Boolean(todoCommandForMessage(message));
  welcomeBackPending ||= shouldWelcomeBack(state.messages);
  if (isOutOfHomeTopicChange(message)) {
    activeOutOfHomeScenarioContext = null;
  }
  const clarificationRequest = isClarificationRequest(message);
  const turnId = ++sendSequence;
  isSending = true;
  if (voiceModeActive) updateVoiceExperience("thinking", companionThinkingMessage(selectedCompanionDisplayName()));
  elements.sendButton.disabled = true;
  elements.messageInput.disabled = true;
  elements.conversationStatus.textContent = voiceModeActive
    ? companionThinkingMessage(selectedCompanionDisplayName())
    : "Sending your message…";
  const userMessageTimestamp = new Date().toISOString();
  state.messages.push({ role: "user", content: message, timestamp: userMessageTimestamp });
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
  const answeredPendingClarification = todoTurn ? false : resolvePendingClarification(message);
  const preferenceIdsBeforeTurn = new Set(state.preferences.map((item) => String(item.id)));
  if (!answeredPendingClarification && !clarificationRequest) savePreference(message);
  const preferenceWasAdded = state.preferences.some((item) => !preferenceIdsBeforeTurn.has(String(item.id)));
  const shouldExtractStructuredMemory = shouldExtractPersonaMemory(message, preferenceWasAdded) ||
    Boolean(answeredPendingClarification && message.length >= 4);
  persist();
  renderAll();
  // Persist the user's message before waiting for the model so a closed tab or
  // interrupted provider request does not leave the turn only in browser memory.
  void flushCloudSave();
  queueStructuredMemoryTurn(message, userMessageTimestamp);

  const sentToAIThisTurn = true;
  let reply = await requestAIReply();
  const replyNeedsRepair = (value) => !value ||
    responseRepeatsUser(value, message) ||
    responseRepeatsRecentAssistant(value) ||
    /i['’]m sorry.{0,100}unable to respond|please send the question again|unable to assist with your request|could not respond to your request/i.test(value) ||
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
  reply = enforceFirstPersonTaskQuestions(reply, selectedCompanionDisplayName());
  if (!isServiceErrorText(reply)) state.messages.push({ role: "assistant", content: reply, timestamp: new Date().toISOString() });
  else if (elements.voiceStatus) { elements.voiceStatus.dataset.error="true"; elements.voiceStatus.textContent="I could not prepare that reply. Please try again."; }
  if (!todoTurn) state.pendingClarification = detectPendingClarification(message, reply);
  if (state.profile.shareAnonymizedLearning === true) {
    void contributeSharedKnowledgeFromTurn();
  }
  state.messages = state.messages.slice(-5000);
  persist();
  renderAll();

  // The reply is already visible. Release the composer immediately instead of
  // keeping the UI in a thinking state while Supabase finishes syncing.
  isSending = false;
  elements.sendButton.disabled = false;
  elements.messageInput.disabled = false;
  elements.conversationStatus.textContent = sentToAIThisTurn && state.apiConnected
    ? "Reply received · saving to your account…"
    : "Reply received · saving to your account…";
  if (!voiceModeActive) elements.messageInput.focus();

  void flushCloudSave().then((conversationSaved) => {
    // An older save must not overwrite the status for a newer user turn.
    if (turnId !== sendSequence || isSending) return;
    elements.conversationStatus.textContent = conversationSaved
      ? (state.apiError && sentToAIThisTurn
          ? "AMÏA could not reply just now. Please try again."
          : "Reply saved to your account")
      : "Reply received · account sync needs attention";
  });
}

elements.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = elements.messageInput.value;
  if (!text.trim() || isSending) return;

  // Preserve the draft when the account/profile gate prevents sending.
  // Once a valid turn begins, sendMessage immediately renders the user message.
  if (cloudUserId && profileComplete()) elements.messageInput.value = "";

  void sendMessage(text).catch((error) => {
    console.error("SYNQ.ME could not complete the submitted message.", error);
    isSending = false;
    if (elements.sendButton) elements.sendButton.disabled = false;
    if (elements.messageInput) elements.messageInput.disabled = false;

    const detail = String(error?.message || "An unexpected error interrupted the reply.");
    if (elements.conversationStatus) {
      elements.conversationStatus.textContent = "Reply failed. Your message is still available to retry.";
    }
    state.apiConnected = false;
    state.apiError = "message failed";
    state.apiErrorDetail = detail;
    state.messages.push({
      role: "assistant",
      content: "I couldn’t complete that reply. " + detail + " You can try sending your message again.",
      timestamp: new Date().toISOString()
    });
    persist();
    renderAll();
    elements.messageInput?.focus();
  });
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

  const pexiCapabilityPlan = buildPexiCapabilityPlan({
    selectedFunctions: state.functions,
    preferences: activeLegacyPreferences().map((item) => ({
      text: item.text,
      category: item.category,
      status: item.status,
      unresolvedFields: preferenceExtraction(item).unresolvedFields
    })),
    targetRobotType: state.profile.robotType || "Humanoid robot",
    capabilityManifest: pexiCapabilityManifest
  });

  const activeMemories = activePersonaMemories();
  const outOfHomeTopicIds = new Set([
    "public_interactions", "social_relationships", "public_mobility", "out_of_home_safety",
    "animal_interactions", "public_venues", "social_etiquette", "professional_community"
  ]);
  const personaMemories = activeMemories.map((memory) => ({
    memory_id: memory.id,
    topic: memory.topic || "general_household",
    kind: memory.kind || "preference",
    scope_key: memory.scope_key || "",
    statement: memory.statement,
    epistemic_status: memory.status || "user_stated",
    confidence: Number.isFinite(Number(memory.confidence)) ? Number(memory.confidence) : null,
    conditions: Array.isArray(memory.conditions) ? memory.conditions : [],
    permission_policy: memory.permission_policy || "unspecified",
    rule_version: memory.rule_version || 1,
    source_refs: memory.source_refs || [],
    provenance: {
      source_application: "SYNQ.ME",
      source_type: "conversation",
      recorded_at: memory.created_at || null,
      last_updated_at: memory.updated_at || memory.created_at || null
    },
    execution_status: "not_executable",
    requires_robot_capability_mapping: true
  }));
  const outOfHomePreferences = personaMemories.filter((memory) => outOfHomeTopicIds.has(memory.topic));
  const outOfHomeBoundaries = outOfHomePreferences.filter((memory) => memory.kind === "boundary");

  const boundaries = preferences.filter((item) =>
    item.category === "Consent & boundaries" ||
    item.explicit_fields.approvalBoundary ||
    item.explicit_fields.negativeConstraint ||
    item.explicit_fields.preserveOrAvoid
  );

  return {
    schema: "app.mysecondself.pexi-persona",
    schema_version: "1.2.0",
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
      preferred_voice: normaliseVoicePreference(state.profile.robotVoice),
      ask_before_actions: Boolean(state.profile.confirmActions)
    },
    domestic_functions: state.functions.map((id) => {
      const activity = ACTIVITIES.find((item) => item.id === id);
      return { function_id: id, label: activity?.label || id, status: "user_selected" };
    }),
    preferences,
    persona_memories: personaMemories,
    out_of_home_preferences: outOfHomePreferences,
    out_of_home_boundaries: outOfHomeBoundaries,
    boundaries,
    pexi_capability_plan: pexiCapabilityPlan,
    pending_clarification: state.pendingClarification || null,
    completeness: {
      preference_count: preferences.length,
      persona_memory_count: personaMemories.length,
      out_of_home_preference_count: outOfHomePreferences.length,
      selected_domestic_function_count: state.functions.length,
      unresolved_detail_count: preferences.reduce((sum, item) => sum + item.unresolved_fields.length, 0),
      capability_plan_status: pexiCapabilityPlan.status,
      mapped_task_count: pexiCapabilityPlan.task_count
    },
    pexi_transfer_contract: {
      target: "PEXI",
      transfer_status: "portable_persona_data_package",
      requires_robot_capability_mapping: true,
      requires_target_robot_safety_validation: true,
      requires_user_authorisation_before_physical_actions: true,
      out_of_home_behaviour_preferences_included: true,
      physical_robot_connected: false,
      physical_actions_enabled: false,
      note: "This package carries stated home and out-of-home persona data alongside a generic domestic task-to-capability brief. A manufacturer/model capability manifest and safety validation are still required before any physical action. It is not a robot-control command or proof of compatibility."
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
    makeTaskStep(2, "Use your personal preferences", curatedPreferences().length
      ? "Reference the " + curatedPreferences().length + (curatedPreferences().length === 1 ? " preference" : " preferences") + " saved to your account."
      : "No preferences recorded yet. Start a conversation with your chosen companion to add details to your persona.");
    makeTaskStep(3, "Build the persona, not a robot connection", "The preview shows a conceptual structure for personalisation. No physical robot is connected, and no action is executed.");
    elements.amyaState.textContent = "Context outlined";
    elements.pexiState.textContent = "Not connected";
    elements.taskDescription.textContent = "This is a persona-building preview: a look at how selected interests and stated preferences could be organised into a future household routine. It is not a simulation of verified robot capability.";
    elements.runTask.querySelector("span").textContent = "Preview ready";
    if (document.body.dataset.appView !== "chat") elements.taskResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
  await setRememberChoice(Boolean(elements.rememberMe?.checked));
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
    const captchaToken = authMode === "recovery" ? undefined : await authTurnstile.requireToken();
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
        options: { emailRedirectTo: AUTH_REDIRECT_URL, ...(captchaToken ? { captchaToken } : {}) }
      });
      if (error) throw error;
      if (data.session && data.user && !data.user.is_anonymous) {
        await rememberMeStorage.syncChoice();
        await loadSignedInAccount(data.session, { migrateDraft: true });
        if (elements.authPassword) elements.authPassword.value = "";
      } else {
        if (elements.authEmail) elements.authEmail.value = email;
        if (elements.authPassword) elements.authPassword.value = "";
        setAuthMode("signin", "Account created. Check your email for the confirmation link, then return here and sign in.");
      }
      return;
      }
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password, ...(captchaToken ? { options: { captchaToken } } : {}) });
    if (error) throw error;
    if (!data.session || !data.user || data.user.is_anonymous) throw new Error("We couldn’t establish your account session. Please try again.");
    await rememberMeStorage.syncChoice();
    await loadSignedInAccount(data.session, { migrateDraft: true });
    if (elements.authPassword) elements.authPassword.value = "";
  } catch (error) {
    const raw = String(error?.message || "");
    const message = /captcha|security check/i.test(raw)
      ? "Complete the security check and try again."
      : /invalid login credentials/i.test(raw)
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
    authTurnstile.reset();
    authBusy = false;
    if (elements.authSubmit) {
      elements.authSubmit.disabled = false;
      elements.authSubmit.textContent = authMode === "signup" ? "Create account" : authMode === "recovery" ? "Save new password" : "Sign in";
    }
  }
}

// Keep password visibility under explicit user control on sign-in, sign-up and reset.
elements.authPasswordToggle?.addEventListener("click", () => {
  const visible = elements.authPassword?.type === "password";
  if (!elements.authPassword) return;
  elements.authPassword.type = visible ? "text" : "password";
  elements.authPasswordToggle.setAttribute("aria-pressed", String(visible));
  elements.authPasswordToggle.setAttribute("aria-label", visible ? "Hide password" : "Show password");
  elements.authPassword?.focus({ preventScroll: true });
});

elements.authForm?.addEventListener("submit", submitAccountForm);
elements.rememberMe?.addEventListener("change", () => {
  void setRememberChoice(elements.rememberMe.checked)
    .then(() => rememberMeStorage.syncChoice())
    .catch(error => {
      console.warn("MSS could not move the current session to the selected storage.", error);
    });
});
elements.authModeToggle?.addEventListener("click", () => {
  if (authBusy) return;
  setAuthMode(authMode === "signup" ? "signin" : "signup");
});
elements.authForgotPassword?.addEventListener("click", async () => {
  if (authBusy) return;
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
  authBusy = true;
  try {
    const captchaToken = await authTurnstile.requireToken();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: AUTH_REDIRECT_URL,
      ...(captchaToken ? { captchaToken } : {})
    });
    if (error) throw error;
    setAuthMode("signin", "If an account exists for that address, a password-reset email has been sent. Follow its link to choose a new password.");
  } catch (error) {
    const detail = String(error?.message || "");
    setAuthMode("signin", /security check|captcha/i.test(detail)
      ? "Complete the security check and try again."
      : "We couldn’t send a reset email right now. Check your connection and try again.");
    console.info("SYNQ.ME password reset request failed.", error);
  } finally {
    authTurnstile.reset();
    authBusy = false;
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
    personaMemoryRecords = [];
    preferenceReviewDrafts.clear(); passportSelection.clear(); renderPersonaPassport();
    simulationSession = null;
    todoItems = []; todoLoadedUserId = null; todoEditingId = null; todoAwaitingTitle = false; renderTodoReminders();
    personaMemoryTableUnavailable = false;
    personaMemoryWarningShown = false;
    personaMemoryWriteInFlight = false;
    showArchivedPersonaMemories = false;
    personaMemoryEditingId = null;
    renderPersonaMemoryLibrary();
    homeMemoryIndexBackfilledUserId = null;
    homeMemoryIndexUnavailable = false;
    homeMemoryIndexWarningShown = false;
    state = initialState();
    activeOutOfHomeScenarioContext = null;
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

if ("serviceWorker" in navigator && import.meta.env.PROD && import.meta.env.MODE !== "mobile") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.info("SYNQ.ME offline install features are unavailable on this load.", error);
    });
  });
}

// Explicit destructive controls use a modal and never run on a select change.
const resetScenarioSelect = document.querySelector("#resetTrainingScenario");
SCENARIOS.forEach(scenario => { const option = document.createElement("option"); option.value = scenario.id; option.textContent = scenario.title; resetScenarioSelect?.append(option); });
let resetTarget = null;
const resetDialog = document.querySelector("#trainingResetDialog");
const resetInput = document.querySelector("#trainingResetConfirmation");
const resetExecute = document.querySelector("#trainingResetExecute");
function openTrainingReset(scenarioId) {
  if (!cloudUserId || isSending || personaMemoryWriteInFlight || roomJourneySaveInFlight) { alert("Wait for the current conversation or save to finish before resetting training."); return; }
  closeVoiceExperience("Voice conversation ended.");
  resetTarget = scenarioId;
  const selected = SCENARIOS.find(item => item.id === scenarioId);
  document.querySelector("#trainingResetTitle").textContent = selected ? "Reset " + selected.title + "?" : "Reset all training?";
  document.querySelector("#trainingResetDescription").textContent = selected ? "Permanently delete this scenario’s conversations, saved learning and progress. Other scenarios stay saved. Older records that cannot be reliably separated will block this reset. This cannot be undone." : "Permanently delete all training conversations, saved preferences, memories and progress. Your account, name, companion settings and usage records stay saved. This cannot be undone.";
  resetInput.value = ""; resetExecute.disabled = true;
  document.querySelector("#trainingResetError").textContent = "";
  resetDialog.showModal(); resetInput.focus();
}
document.querySelector("#resetAllTraining")?.addEventListener("click", () => openTrainingReset(null));
document.querySelector("#resetOneScenario")?.addEventListener("click", () => openTrainingReset(resetScenarioSelect.value));
resetInput?.addEventListener("input", () => { resetExecute.disabled = resetInput.value !== "RESET"; });
document.querySelector("#trainingResetCancel")?.addEventListener("click", () => resetDialog.close());
let resettingTraining = false;
resetDialog?.addEventListener("cancel", event => { if (resettingTraining) event.preventDefault(); });
resetExecute?.addEventListener("click", async () => {
  if (resetInput.value !== "RESET" || resettingTraining) return;
  resettingTraining = true; resetExecute.disabled = true;
  document.querySelector("#trainingResetCancel").disabled = true;
  try {
    clearTimeout(cloudSaveTimer); cloudSaveTimer = null;
    await cloudSaveChain;
    if (isSending || personaMemoryWriteInFlight || roomJourneySaveInFlight) throw new Error("Wait for the current save to finish, then try again.");
    await flushMemoryQueue(cloudUserId, trainingRevision);
    if (pendingMemoryJobs(cloudUserId, trainingRevision).length || personaMemoryWriteInFlight || memoryQueueFlushing || memoryQueueRunner?.running) throw new Error("Wait for pending memory updates to sync before resetting training.");
    const { data, error } = await supabase.rpc("synqme_reset_training", { p_confirmation: resetInput.value, p_scenario_id: resetTarget });
    if (error) throw error;
    // Keep this page on its old revision until reload so late async writes are rejected.
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(ACCOUNT_DRAFT_KEY); writePendingMemoryJobs(cloudUserId, trainingRevision, []); } catch {}
    window.location.reload();
  } catch (error) {
    document.querySelector("#trainingResetError").textContent = error.message || "Reset failed. Nothing was deleted. Try again.";
    resettingTraining = false; resetExecute.disabled = resetInput.value !== "RESET";
    document.querySelector("#trainingResetCancel").disabled = false;
  }
});

document.querySelector("#viewPexiReadiness")?.addEventListener("click", event => {
  const panel = document.querySelector("#pexiReadiness");
  panel.hidden = !panel.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));
  event.currentTarget.textContent = panel.hidden ? "View PEXI Transfer Readiness" : "Hide PEXI Transfer Readiness";
});

document.querySelector("#shareJourneyProgress")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  const status = document.querySelector("#journeyShareStatus");
  if (!cloudUserId || !roomJourney) return;
  button.disabled = true; status.textContent = "Creating your progress image…";
  try {
    const result = await shareProgressImage(scenarioProgressSummary(scenarioData().completed),state.profile.ownerName);
    status.textContent = result === "downloaded" ? "Progress image downloaded. It is ready to share." : "";
  } catch (error) { status.textContent = error.message || "Could not share your progress. Try again."; }
  finally { button.disabled = false; }
});

document.querySelector('#robotVoice')?.addEventListener('change',event=>{
 if(elements.robotName) elements.robotName.placeholder=normaliseVoicePreference(event.target.value)==='male'?'Andy':'Vikki';
});
