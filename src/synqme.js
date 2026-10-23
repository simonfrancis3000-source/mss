import { createClient } from "@supabase/supabase-js";

const STORAGE_KEY = "synqme-demo-v1";
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    })
  : null;
const WELCOME = "Hi, I’m here to help you build your SecondSelf. Which parts of home life would you like it to understand first?";

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
  conversationStatus: $("#conversationStatus"),
  chatMessages: $("#chatMessages"),
  chatForm: $("#chatForm"),
  messageInput: $("#messageInput"),
  sendButton: $("#sendButton"),
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
  robotName: $("#robotName"),
  robotType: $("#robotType"),
  confirmActions: $("#confirmActions"),
  functionGrid: $("#functionGrid"),
  functionCount: $("#functionCount"),
  settingsPreferenceCount: $("#settingsPreferenceCount"),
  settingsPreferenceList: $("#settingsPreferenceList"),
  milestoneCount: $("#milestoneCount"),
  milestoneList: $("#milestoneList"),
  openTaskFromSettings: $("#openTaskFromSettings"),
  mobileOwnerTitle: $("#mobileOwnerTitle"),
  mobileJourneyText: $("#mobileJourneyText"),
  mobileProgressValue: $("#mobileProgressValue")
};

function defaultProfile() {
  return { ownerName: "", robotName: "", robotType: "Humanoid robot", robotVoice: "female", confirmActions: false };
}

function initialState() {
  return {
    messages: [{ role: "assistant", content: WELCOME }],
    preferences: [],
    profile: defaultProfile(),
    functions: [],
    pendingClarification: null,
    apiConnected: false
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

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.messages) || !Array.isArray(saved.preferences)) return initialState();

    const state = {
      messages: saved.messages
        .filter((m) => m && (m.role === "assistant" || m.role === "user") && typeof m.content === "string")
        .slice(-50)
        .map((m) => {
          if (m.role === "assistant" && /follow these steps automatically|the robot will follow|robot will automatically/i.test(m.content)) {
            return { role: "assistant", content: "I’ve noted those preferences in this browser demo. They can shape a proposed household routine, but no physical robot is connected or carrying out the task. You can keep building your SecondSelf by adding more preferences." };
          }
          if (m.role === "assistant" && /That’s useful context for your SecondSelf|I've captured this preference for your browser-based SecondSelf|I’ve captured this preference for your browser-based SecondSelf|I’ve added it to your local digital persona|I've added it to your local digital persona/i.test(m.content)) {
            return { role: "assistant", content: "Got it. Let’s make that preference more precise. What detail would matter most to get right?" };
          }
          if (m.role === "assistant" && /Hi, I’m ELO, your SYNQ\.ME guide/i.test(m.content)) {
            return { role: "assistant", content: WELCOME };
          }
          return { role: m.role, content: m.content };
        }),
      preferences: saved.preferences.slice(0, 24)
        .map((p) => typeof p === "string" ? cleanPreference(p) : cleanPreference(p?.text, p))
        .filter(Boolean),
      profile: { ...defaultProfile(), ...(saved.profile && typeof saved.profile === "object" ? saved.profile : {}) },
      functions: Array.isArray(saved.functions) ? saved.functions.filter((id) => ACTIVITIES.some((a) => a.id === id)) : [],
      pendingClarification: saved.pendingClarification && typeof saved.pendingClarification === "object" ? saved.pendingClarification : null,
      apiConnected: false
    };
    return state;
  } catch {
    return initialState();
  }
}

let state = loadState();
let isSending = false;
let taskRunning = false;
let lastFocusedElement = null;
let cloudUserId = null;
let cloudMode = "local";
let cloudSaveTimer = null;
let cloudSaveChain = Promise.resolve();

function persist() {
  let localSaved = false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      messages: state.messages.slice(-50),
      preferences: state.preferences.slice(0, 24),
      profile: state.profile,
      functions: state.functions,
      pendingClarification: state.pendingClarification || null
    }));
    localSaved = true;
  } catch {
    if (elements.memoryFootnote) elements.memoryFootnote.textContent = "Session memory only; browser storage is unavailable";
  }
  scheduleCloudSave();
  return localSaved;
}

function scheduleCloudSave() {
  if (!supabase || !cloudUserId) return;
  if (cloudSaveTimer) window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(() => {
    cloudSaveTimer = null;
    cloudSaveChain = cloudSaveChain
      .then(() => saveCloudState())
      .catch((error) => {
        console.info("SYNQ.ME cloud sync unavailable; local browser saving remains active.", error);
        cloudMode = "local";
        renderPreferences();
      });
  }, 300);
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

  cloudMode = "cloud";
  renderPreferences();
}

async function initialiseCloudStorage() {
  if (!supabase) {
    cloudMode = "local";
    renderPreferences();
    return;
  }
  try {
    let { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      sessionData = { session: data.session };
    }
    if (!sessionData.session?.user?.id) throw new Error("Supabase did not return an authenticated user.");
    cloudUserId = sessionData.session.user.id;

    const [profileResult, preferencesResult] = await Promise.all([
      supabase.from("synqme_profiles").select("*").eq("user_id", cloudUserId).maybeSingle(),
      supabase.from("synqme_preferences").select("category,preference_text,normalised_text,preference_status,explicit_facets,unresolved_fields,source_message,created_at,schema_version,clarifications").eq("user_id", cloudUserId).order("created_at", { ascending: false }).limit(24)
    ]);
    if (profileResult.error) throw profileResult.error;
    if (preferencesResult.error) throw preferencesResult.error;

    const remoteProfile = profileResult.data;
    if (remoteProfile) {
      state.profile = {
        ownerName: remoteProfile.owner_name || state.profile.ownerName || "",
        robotName: remoteProfile.future_robot_name || state.profile.robotName || "",
        robotType: remoteProfile.future_robot_type || state.profile.robotType || "Humanoid robot",
        robotVoice: remoteProfile.future_robot_voice || state.profile.robotVoice || "female",
        confirmActions: Boolean(remoteProfile.confirm_actions)
      };
      const remoteFunctions = Array.isArray(remoteProfile.domestic_functions)
        ? remoteProfile.domestic_functions.filter((id) => ACTIVITIES.some((activity) => activity.id === id))
        : [];
      state.functions = [...new Set([...remoteFunctions, ...state.functions])];
    }

    const merged = [
      ...(preferencesResult.data || []).map((item) => ({
        text: item.preference_text,
        category: item.category,
        normalised: item.normalised_text,
        preference_status: item.preference_status,
        explicit_facets: item.explicit_facets,
        unresolved_fields: item.unresolved_fields,
        source_message: item.source_message,
        created_at: item.created_at,
        clarifications: item.clarifications
      })),
      ...state.preferences
    ];
    const unique = new Map();
    merged.forEach((item) => {
      const cleaned = cleanPreference(item.text);
      if (!cleaned) return;
      const normalised = (item.normalised || cleaned.normalised).slice(0, 240);
      if (!unique.has(normalised)) unique.set(normalised, { ...cleaned, category: item.category || cleaned.category, normalised, status: item.status || item.preference_status || cleaned.status, explicitFacets: item.explicitFacets || item.explicit_facets || cleaned.explicitFacets, unresolvedFields: item.unresolvedFields || item.unresolved_fields || cleaned.unresolvedFields, sourceMessage: item.sourceMessage || item.source_message || cleaned.sourceMessage, recordedAt: item.recordedAt || item.created_at || cleaned.recordedAt, clarifications: item.clarifications || cleaned.clarifications || [] });
    });
    state.preferences = [...unique.values()].slice(0, 24);

    cloudMode = "cloud";
    populateSettingsForm();
    renderAll();
    persist();
    if (!remoteProfile) scheduleCloudSave();
  } catch (error) {
    cloudUserId = null;
    cloudMode = "local";
    console.info("SYNQ.ME cloud storage is not ready; keeping persona data in this browser.", error);
    renderAll();
    elements.memoryFootnote.textContent = "Saved in this browser. Enable Supabase Anonymous Sign-Ins to add cloud saving.";
  }
}

function dismissSplash() {
  if (!elements.splash) return;
  window.setTimeout(() => elements.splash.classList.add("is-hidden"), 1000);
}
dismissSplash();

function profileComplete() {
  return Boolean(
    state.profile.ownerName && state.profile.ownerName.trim() &&
    state.profile.robotName && state.profile.robotName.trim()
  );
}

function updateSettingsMode() {
  const setupRequired = !profileComplete();
  document.body.classList.toggle("profile-setup-required", setupRequired);
  if (elements.settingsTitle) elements.settingsTitle.textContent = setupRequired ? "Set up your SecondSelf" : "Settings";
  if (elements.settingsIntro) {
    elements.settingsIntro.textContent = setupRequired
      ? "First, add your name and choose a name for your future robot. Complete these essentials before starting your conversation."
      : "Make SYNQ.ME feel like yours. Your settings are saved for this browser profile.";
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
  if (elements.robotName) elements.robotName.required = true;
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
  elements.confirmActions.checked = Boolean(state.profile.confirmActions);
  elements.functionGrid.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = state.functions.includes(checkbox.value);
  });
}
elements.settingsForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const ownerName = elements.ownerName.value.trim().slice(0, 60);
  const robotName = elements.robotName.value.trim().slice(0, 60);
  if (!ownerName || !robotName) {
    if (elements.profileSetupNotice) {
      elements.profileSetupNotice.textContent = "Both your name and your future robot’s name are required before you can start.";
      elements.profileSetupNotice.hidden = false;
    }
    (!ownerName ? elements.ownerName : elements.robotName).focus();
    return;
  }
  state.profile = {
    ownerName,
    robotName,
    robotType: elements.robotType.value || "Humanoid robot",
    robotVoice: document.querySelector("#robotVoice")?.value || "female",
    confirmActions: Boolean(elements.confirmActions.checked)
  };
  persist();
  renderAll();
  updateSettingsMode();
  closeSettings();
  elements.conversationStatus.textContent = "Your profile is ready";
});

elements.functionGrid?.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
  checkbox.addEventListener("change", () => {
    const selected = new Set(state.functions);
    if (checkbox.checked) selected.add(checkbox.value);
    else selected.delete(checkbox.value);
    state.functions = [...selected];
    persist();
    renderAll();
  });
});

 elements.exportPexiPackage?.addEventListener("click", exportPexiPersonaPackage);

elements.openTaskFromSettings?.addEventListener("click", () => {
  closeSettings();
  elements.taskResult.hidden = false;
  elements.taskResult.scrollIntoView({ behavior: "smooth", block: "start" });
});

function appendMessage(role, content) {
  const article = document.createElement("article");
  article.className = "message " + (role === "user" ? "user-message" : "assistant-message");
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user"
    ? (state.profile.ownerName.trim().charAt(0).toUpperCase() || "Y")
    : (state.profile.robotName.trim().charAt(0).toUpperCase() || "E");
  const body = document.createElement("div");
  body.className = "message-body";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = role === "user"
    ? (state.profile.ownerName.trim().toUpperCase() || "YOU")
    : ((state.profile.robotName.trim() || "ELO") + " · SYNQ.ME");
  const paragraph = document.createElement("p");
  paragraph.textContent = content;
  body.append(meta, paragraph);
  article.append(avatar, body);
  elements.chatMessages.append(article);
}

function renderMessages() {
  elements.chatMessages.replaceChildren();
  state.messages.slice(-50).forEach((message) => appendMessage(message.role, message.content));
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
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



function detectPendingClarification(userMessage, reply) {
  const response = String(reply || "").toLowerCase();
  const latest = String(userMessage || "").toLowerCase();

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

  if (pending.type === "supply_scope") {
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
    ? "Cloud-synced to this browser profile · " + count + (count === 1 ? " preference" : " preferences")
    : count === 0
      ? "Your persona starts in this browser"
      : "Saved in this browser · " + count + (count === 1 ? " preference" : " preferences");

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
  elements.functionCount.textContent = state.functions.length + (state.functions.length === 1 ? " SELECTED" : " SELECTED");
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
  renderPreferences();
  updateDecisionSummary();
  renderSettingsDetails();
  renderPexiReadiness();

  const name = state.profile.ownerName.trim();
  const robotName = state.profile.robotName.trim();
  if (elements.companionName) elements.companionName.textContent = robotName || "ELO";
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
  elements.providerLabel.textContent = state.apiConnected ? "LIVE AI RESPONSE" : (API_BASE ? "AI ENDPOINT CONFIGURED" : "SCRIPTED DEMO MODE");
  document.title = name ? "SYNQ.ME | " + name + "’s SecondSelf" : "SYNQ.ME | Build Your SecondSelf";
  const intro = $(".conversation-intro p");
  if (intro) intro.textContent = robotName
    ? "Tell me what matters to you. I’ll help shape your digital persona, one preference at a time. Your future robot name is " + robotName + "."
    : "Tell me what matters to you. I’ll help shape your digital persona, one preference at a time.";
}
renderAll();

function localReply(message) {
  const lower = message.toLowerCase();
  const category = classifyPreference(message);
  const assistantTurns = state.messages.filter((item) => item.role === "assistant").length;
  const acknowledgements = ["Gotcha.", "Got it.", "Cool, thanks for telling me.", "Understood.", "Right, that makes sense."];
  const acknowledgement = acknowledgements[assistantTurns % acknowledgements.length];
  const ownerName = state.profile.ownerName.trim();
  const namePrefix = ownerName && assistantTurns > 0 && assistantTurns % 4 === 2 ? ownerName + ", " : "";

  if (/(paper towels?|spray|cleaning product|surface cleaner|cleaner you|detergent)/i.test(message)) {
    return namePrefix + "Gotcha. Should I treat those as your standard supplies for all surface cleaning, or just the kitchen?";
  }
  if (/(kitchen|counter|worktop|surface)/i.test(message) &&
      /(twice|two times|2 times|two a day|2 a day|daily|each day|every day|a day)/i.test(message)) {
    return namePrefix + "Gotcha. Would morning and evening suit you, or do you prefer two other times?";
  }
  if (/(ask me|ask before|check with me|permission|confirm before|before changing|before moving|without asking)/i.test(message)) {
    return namePrefix + "Understood. Should asking first apply to every household task, or especially when something would be moved or handled?";
  }
  if (/(what can|what does|how does|how do|what is synq)/i.test(message)) {
    return "SYNQ.ME helps you build a digital persona through natural conversation. We explore what you prefer, what matters most, and what you want to avoid, one useful question at a time.";
  }
  if (/(laundry|washing|clothes|fold)/i.test(lower)) {
    return namePrefix + acknowledgement + " Which laundry detail matters most to you: sorting, washing and drying, or how clothes are put away?";
  }
  if (/(vacuum|floor|carpet|tidy|cleaning|clean|surface|counter|worktop)/i.test(lower)) {
    return namePrefix + acknowledgement + " What matters most to get right here: timing, task order, or anything that must be left untouched?";
  }
  if (category === "Consent & boundaries" || state.profile.confirmActions) {
    return namePrefix + acknowledgement + " What would you most want to prevent: things being moved, a wrong choice, or something happening at the wrong time?";
  }
  return namePrefix + acknowledgement + " What matters most to you when getting that right?";
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

async function requestAIReply() {
  if (!API_BASE) return null;
  try {
    const response = await fetch(API_BASE + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: state.messages.slice(-20).map((message) => ({ role: message.role, content: message.content })),
        preferences: state.preferences.map((preference) => {
          const extracted = preferenceExtraction(preference);
          return {
            category: preference.category || classifyPreference(preference.text),
            text: preference.text,
            epistemicStatus: preference.status || "user_stated",
            explicitFields: extracted.explicitFields,
            unresolvedFields: extracted.unresolvedFields
          };
        }),
        profile: {
          ownerName: state.profile.ownerName,
          robotName: state.profile.robotName,
          robotType: state.profile.robotType,
          robotVoice: state.profile.robotVoice || "female",
          askBeforeActions: state.profile.confirmActions
        },
        domesticFunctions: state.functions.map((id) => ACTIVITIES.find((activity) => activity.id === id)?.label).filter(Boolean)
      })
    });
    if (!response.ok) throw new Error("AI endpoint returned " + response.status);
    const data = await response.json();
    const reply = typeof data.reply === "string" ? data.reply : typeof data.message === "string" ? data.message : "";
    if (!reply.trim()) throw new Error("AI endpoint returned no reply text");
    state.apiConnected = true;
    elements.providerLabel.textContent = "LIVE AI RESPONSE";
    return reply.trim();
  } catch (error) {
    console.info("SYNQ.ME is using scripted demo replies because the AI endpoint is not available.", error);
    state.apiConnected = false;
    elements.providerLabel.textContent = "SCRIPTED DEMO MODE";
    return null;
  }
}

async function sendMessage(rawText) {
  if (!profileComplete()) {
    openSettings();
    elements.conversationStatus.textContent = "Set up your profile to begin";
    return;
  }
  const message = rawText.trim();
  if (!message || isSending) return;
  isSending = true;
  elements.sendButton.disabled = true;
  elements.messageInput.disabled = true;
  elements.conversationStatus.textContent = "ELO is thinking";
  state.messages.push({ role: "user", content: message });
  const answeredPendingClarification = resolvePendingClarification(message);
  if (!answeredPendingClarification) savePreference(message);
  persist();
  renderAll();

  let reply = await requestAIReply();
  if (!reply || responseRepeatsUser(reply, message) || /I've captured this preference for your browser-based SecondSelf|I've added it to your local digital persona|That's useful context for your SecondSelf|Let's make that preference more precise|What detail would matter most to get right/i.test(reply)) {
    reply = localReply(message);
  }
  state.messages.push({ role: "assistant", content: reply });
  state.pendingClarification = detectPendingClarification(message, reply);
  state.messages = state.messages.slice(-50);
  persist();
  renderAll();
  elements.conversationStatus.textContent = state.apiConnected ? "AI response received" : "Preference captured";
  isSending = false;
  elements.sendButton.disabled = false;
  elements.messageInput.disabled = false;
  elements.messageInput.focus();
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
      ? "Reference the " + state.preferences.length + (state.preferences.length === 1 ? " preference" : " preferences") + " currently stored in this browser."
      : "No preferences recorded yet. Start a conversation with ELO to add details to your persona.");
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

initialiseCloudStorage().finally(() => {
  if (!profileComplete()) openSettings();
  else updateSettingsMode();
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.info("SYNQ.ME offline install features are unavailable on this load.", error);
    });
  });
}
