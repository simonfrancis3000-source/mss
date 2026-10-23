const STORAGE_KEY = "synqme-demo-v1";
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const WELCOME = "Hi, I’m ELO. Let’s start with a household routine. If a robot were loading your dishwasher, what would you want it to know about how you like things done?";

const $ = (selector) => document.querySelector(selector);
const elements = {
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
  taskSteps: $("#taskSteps")
};

function initialState() {
  return {
    messages: [{ role: "assistant", content: WELCOME }],
    preferences: [],
    apiConnected: false
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.messages) || !Array.isArray(saved.preferences)) return initialState();
    return {
      messages: saved.messages.slice(-50),
      preferences: saved.preferences.slice(0, 12),
      apiConnected: false
    };
  } catch {
    return initialState();
  }
}

let state = loadState();
let isSending = false;
let taskRunning = false;

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      messages: state.messages.slice(-50),
      preferences: state.preferences.slice(0, 12)
    }));
  } catch {
    elements.memoryFootnote.textContent = "Session memory only; browser storage is unavailable";
  }
}

function appendMessage(role, content) {
  const article = document.createElement("article");
  article.className = "message " + (role === "user" ? "user-message" : "assistant-message");
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "Y" : "E";
  const body = document.createElement("div");
  body.className = "message-body";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = role === "user" ? "YOU" : (state.apiConnected ? "ELO · AI RESPONSE" : "ELO · SYNQ.ME");
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
  if (/glass|fragile|delicate|mug|cup|top rack/.test(text)) return "Care & placement";
  if (/ask me|ask before|confirm|permission|before start|before starting/.test(text)) return "Confirmation";
  if (/knife|knives|sharp|cutlery|safety|safe/.test(text)) return "Safety";
  if (/quiet|noise|morning|evening|schedule|routine|time|when/.test(text)) return "Routine & timing";
  if (/clean|tidy|wipe|counter|surface|order/.test(text)) return "Household routine";
  return "Personal preference";
}

function savePreference(message) {
  const normalised = message.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalised) return;
  const exists = state.preferences.some((preference) => preference.normalised === normalised);
  if (exists) return;
  state.preferences.unshift({
    text: message.trim().slice(0, 240),
    category: classifyPreference(message),
    normalised,
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 7)
  });
  state.preferences = state.preferences.slice(0, 12);
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
  elements.personaProgress.style.width = Math.min(100, count * 17) + "%";
  elements.foundationValue.textContent = count === 0
    ? "Waiting for your first preference"
    : count === 1
      ? "First preference captured"
      : count < 4
        ? "Preference patterns emerging"
        : "Persona foundation taking shape";
  $(".memory-pulse").classList.toggle("active", count > 0);
  elements.memoryFootnote.textContent = count === 0
    ? "No preferences saved yet"
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
    return;
  }
  state.preferences.forEach((preference, index) => {
    const item = document.createElement("div");
    item.className = "preference-item";
    addElement(item, "preference-number", String(index + 1).padStart(2, "0"));
    const copy = document.createElement("div");
    copy.className = "preference-copy";
    addElement(copy, "preference-category", preference.category);
    addElement(copy, "preference-text", preference.text);
    item.append(copy);
    elements.preferenceList.append(item);
  });
}

function updateDecisionSummary() {
  const preferences = state.preferences;
  if (!preferences.length) {
    elements.decisionSummary.textContent = "AMYA will use the preferences you share to shape a personalised task plan.";
    elements.amyaState.textContent = "Waiting";
    elements.pexiState.textContent = "Waiting";
    elements.amyaState.classList.remove("ready");
    elements.pexiState.classList.remove("ready");
    return;
  }
  const hasConfirmation = preferences.some((item) => item.category === "Confirmation");
  const hasSafety = preferences.some((item) => item.category === "Safety");
  const details = [];
  if (hasConfirmation) details.push("a confirmation checkpoint");
  if (hasSafety) details.push("a safety-first handling step");
  elements.decisionSummary.textContent = "Your SecondSelf now contains " + preferences.length + (preferences.length === 1 ? " preference" : " preferences") + (details.length ? ". The illustrative task plan will include " + details.join(" and ") + "." : ". AMYA can use this context to personalise the illustrative task plan.");
  elements.amyaState.textContent = "Context added";
  elements.pexiState.textContent = "Ready to map";
  elements.amyaState.classList.add("ready");
  elements.pexiState.classList.add("ready");
}

function renderAll() {
  renderMessages();
  renderPreferences();
  updateDecisionSummary();
  elements.providerLabel.textContent = state.apiConnected ? "LIVE AI RESPONSE" : (API_BASE ? "AI ENDPOINT CONFIGURED" : "SCRIPTED DEMO MODE");
}
renderAll();

function localReply(message) {
  const category = classifyPreference(message);
  const text = message.toLowerCase();
  if (category === "Care & placement") {
    return "Understood. I’ve added that care-and-placement preference to your local SecondSelf. In this demonstration, the task plan will carry that instruction forward rather than treating every household the same.";
  }
  if (category === "Confirmation") {
    return "I’ll record that you want a confirmation before the cycle starts. That preference should become a checkpoint in the plan, rather than an assumption that the robot can make the decision for you.";
  }
  if (category === "Safety") {
    return "Safety matters. I’ve saved that handling preference to the local persona. The illustrative plan will call it out as a constraint, not just a general suggestion.";
  }
  if (category === "Routine & timing") {
    return "That gives your SecondSelf useful context about timing and routine. I’ve saved it, so the task preview can account for when and how you prefer things to happen.";
  }
  if (/dishwasher|dish|plate|load|unload/.test(text)) {
    return "That is a helpful household instruction. I’ve saved it as part of your SecondSelf. You can add another preference, or run the task demo to see how persona context flows into an illustrative PEXI task plan.";
  }
  return "That’s useful context. I’ve added it to your local SecondSelf as a personal preference. The point of SYNQ.ME is to preserve the way you like things done, so compatible robots can use that context rather than starting from a generic routine.";
}

async function requestAIReply() {
  if (!API_BASE) return null;
  try {
    const response = await fetch(API_BASE + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: state.messages.slice(-20).map((message) => ({ role: message.role, content: message.content })),
        preferences: state.preferences.map((preference) => ({ category: preference.category, text: preference.text }))
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
  const message = rawText.trim();
  if (!message || isSending) return;
  isSending = true;
  elements.sendButton.disabled = true;
  elements.messageInput.disabled = true;
  elements.conversationStatus.textContent = "ELO is thinking";
  state.messages.push({ role: "user", content: message });
  savePreference(message);
  persist();
  renderMessages();
  renderPreferences();
  updateDecisionSummary();

  let reply = await requestAIReply();
  if (!reply) reply = localReply(message);
  state.messages.push({ role: "assistant", content: reply });
  state.messages = state.messages.slice(-50);
  persist();
  renderMessages();
  renderPreferences();
  updateDecisionSummary();
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
  if (!window.confirm("Reset the conversation and clear the preferences saved by this demo in this browser?")) return;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  state = initialState();
  state.apiConnected = false;
  elements.conversationStatus.textContent = "Ready to talk";
  elements.taskResult.hidden = true;
  renderAll();
  persist();
});

function makeTaskStep(number, title, description) {
  const item = document.createElement("div");
  item.className = "task-step";
  addElement(item, "task-step-number", String(number).padStart(2, "0"));
  const copy = document.createElement("div");
  addElement(copy, "task-step-title", title).className = "task-step-title";
  copy.firstChild.style.cssText = "display:block;color:#d9e0e9;font-size:9px;font-weight:600";
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
  elements.runTask.querySelector("span").textContent = "Preparing task plan…";
  elements.taskResult.hidden = false;
  elements.taskSteps.replaceChildren();
  elements.amyaState.textContent = "Interpreting";
  elements.pexiState.textContent = "Waiting";
  elements.amyaState.classList.add("ready");
  elements.pexiState.classList.remove("ready");
  elements.taskDescription.textContent = "AMYA is applying the preferences saved to this browser. PEXI then maps the example task to an illustrative capability profile. The sequence below is a scripted demonstration.";
  window.setTimeout(() => {
    elements.amyaState.textContent = "Context applied";
    elements.pexiState.textContent = "Mapping";
    const hasConfirmation = state.preferences.some((item) => item.category === "Confirmation");
    const hasSafety = state.preferences.some((item) => item.category === "Safety");
    makeTaskStep(1, "AMYA interprets personal context", state.preferences.length
      ? "Use " + state.preferences.length + (state.preferences.length === 1 ? " saved preference" : " saved preferences") + " from this digital persona."
      : "No personal preferences are saved yet, so the demo uses a generic starting routine.");
    makeTaskStep(2, "PEXI maps the example task", "Match the illustrative dishwasher task to a conceptual robot capability profile.");
    if (hasSafety) makeTaskStep(3, "Apply safety preference", "Carry the saved handling instruction into the example task plan.");
    if (hasConfirmation) makeTaskStep(hasSafety ? 4 : 3, "Add a confirmation checkpoint", "The example plan pauses for user confirmation before the dishwasher cycle.");
    makeTaskStep(elements.taskSteps.children.length + 1, "Present the proposed sequence", "Show the personalised plan for review. No physical robot command is sent.");
    elements.pexiState.textContent = "Mapped (demo)";
    elements.pexiState.classList.add("ready");
    elements.taskDescription.textContent = "The demo has translated the current SecondSelf context into a proposed dishwasher task sequence. It shows the intended AMYA-to-PEXI flow, not a verified robot execution.";
    elements.runTask.querySelector("span").textContent = "Task plan ready";
    elements.taskResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
    taskRunning = false;
    elements.runTask.disabled = false;
    window.setTimeout(() => { elements.runTask.querySelector("span").textContent = "Run dishwasher task demo"; }, 1800);
  }, 500);
});
