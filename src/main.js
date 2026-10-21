import "./style.css";

const $ = id => document.getElementById(id);

const tasks = {
  breakfast: {
    title: "Prepare breakfast · cup routine",
    description: "A visual storyboard of a breakfast cup routine. Cup contact, grasping and placement are not simulated.",
    steps: [
      { short: "Reach", title: "Reach toward the cup", motion: "reach", duration: 680, confirm: true, pauseAfter: true, detail: "The wireframe moves into an approach pose. No object contact is simulated." },
      { short: "Lift", title: "Raise into a carry pose", motion: "carry", duration: 640, confirm: true, pauseAfter: true, detail: "The arm rises into a carry pose; no cup is attached to the hand." },
      { short: "Carry", title: "Move toward the placement point", motion: "carry", duration: 760, confirm: true, pauseAfter: true, detail: "The arm sweeps toward a visual marker. No object is transported." },
      { short: "Settle", title: "Return to a resting pose", motion: "settle", duration: 560, confirm: false, detail: "The wireframe returns to its resting pose." }
    ]
  },
  tidy: {
    title: "Tidy the kitchen · clear the counter",
    description: "A visual storyboard of scanning and clearing motions. No household objects are manipulated.",
    steps: [
      { short: "Scan", title: "Look across the work area", motion: "turn", duration: 480, confirm: false, detail: "The wireframe turns its head toward the work area." },
      { short: "Left", title: "Sweep toward the left", motion: "tidy-left", duration: 620, confirm: true, pauseAfter: true, detail: "The wireframe traces a broad left-side sweep." },
      { short: "Right", title: "Sweep toward the right", motion: "tidy-right", duration: 620, confirm: true, pauseAfter: true, detail: "The wireframe traces a matching right-side sweep." },
      { short: "Settle", title: "Return to a resting pose", motion: "settle", duration: 520, confirm: false, detail: "The wireframe returns to its resting pose." }
    ]
  },
  visitor: {
    title: "Respond to a visitor · greet at the door",
    description: "A visual storyboard of turning toward a visitor and offering a greeting gesture.",
    steps: [
      { short: "Notice", title: "Turn toward the visitor", motion: "turn", duration: 520, confirm: true, pauseAfter: true, detail: "The wireframe turns toward the imagined doorway." },
      { short: "Greet", title: "Offer a greeting gesture", motion: "greet", duration: 620, confirm: true, pauseAfter: true, detail: "The wireframe makes one measured greeting gesture." },
      { short: "Settle", title: "Return to a resting pose", motion: "settle", duration: 520, confirm: false, detail: "The wireframe returns to a neutral pose." }
    ]
  }
};

const profiles = {
  sarah: {
    name: "Sarah",
    sceneLabel: "SARAH · FAMILIAR ROUTINE",
    title: "A measured, familiar routine",
    description: "Sarah’s preview moves more slowly and adds a short settling pause after key actions.",
    preferences: ["Familiar steps proceed independently", "A measured pace with a settling pause"],
    pace: 1.2,
    settlingPause: 460
  },
  alex: {
    name: "Alex",
    sceneLabel: "ALEX · CONFIRM NEW ACTIONS",
    title: "Explain, then confirm",
    description: "Alex’s preview explains each new action and waits for confirmation before it moves.",
    preferences: ["Brief explanation before each new action", "Waits for confirmation to continue"],
    pace: 0.92,
    settlingPause: 0
  }
};

const state = {
  persona: "sarah",
  active: false,
  paused: false,
  waitingForConfirmation: false,
  stepIndex: 0,
  timer: null,
  timerStartedAt: 0,
  remainingMs: 0,
  pendingCallback: null,
  currentStep: null
};

const wireScene = $("wireScene");
const runButton = $("runBtn");
const pauseButton = $("pauseBtn");
const confirmButton = $("confirmBtn");
const taskSelect = $("taskSelect");
const personalization = $("personalization");

function selectedTask() {
  return tasks[taskSelect.value] ?? tasks.breakfast;
}

function isPersonalized() {
  return personalization.checked;
}

function setStatus(title, detail) {
  $("statusText").textContent = title;
  $("statusDetail").textContent = detail;
}

function updateProgress(percent, label) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  $("progressFill").style.width = `${value}%`;
  $("progressTrack").setAttribute("aria-valuenow", String(value));
  $("stepCount").textContent = label;
}

function renderTimeline(activeIndex = -1, completed = false) {
  const steps = selectedTask().steps;
  const timeline = $("timelineSteps");
  timeline.replaceChildren(...steps.map((step, index) => {
    const item = document.createElement("span");
    item.className = "timeline-step";
    if (completed || index < activeIndex) item.classList.add("done");
    if (!completed && index === activeIndex) item.classList.add("active");
    item.textContent = step.short;
    return item;
  }));
}

function updateTask() {
  const task = selectedTask();
  $("sceneTaskLabel").textContent = task.title;
  $("taskHelp").textContent = task.description;
  wireScene.dataset.task = taskSelect.value;
  renderTimeline();
  updateProgress(0, "Ready");
  wireScene.dataset.motion = "idle";
  setStatus("Choose a persona and start a task preview.", "This wireframe is illustrative; it does not demonstrate robot capability.");
}

function updatePersona() {
  const profile = profiles[state.persona];
  const enabled = isPersonalized();
  $("sarahBtn").setAttribute("aria-pressed", String(state.persona === "sarah"));
  $("alexBtn").setAttribute("aria-pressed", String(state.persona === "alex"));
  $("scenePersonaLabel").textContent = enabled ? profile.sceneLabel : "STANDARD · PERSONALISATION OFF";
  $("preferenceTitle").textContent = enabled ? `${profile.name}’s preferences` : "Standard preview";
  const preferences = enabled
    ? profile.preferences
    : ["Standard movement pace", "No persona-specific pauses or confirmations"];
  $("preferences").replaceChildren(...preferences.map(text => {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }));
  $("modeHelp").textContent = enabled
    ? state.persona === "sarah" ? "Sarah’s slower pace and settling pauses are active." : "Alex’s explanations and action confirmations are active."
    : "The preview uses a standard pace without persona-specific steps.";
  $("explainTitle").textContent = enabled ? profile.title : "Standard task preview";
  $("explainText").textContent = enabled
    ? profile.description
    : "Turn personalisation on to apply Sarah’s or Alex’s response preferences to the sequence.";
}

function lockSetup(locked) {
  $("sarahBtn").disabled = locked;
  $("alexBtn").disabled = locked;
  taskSelect.disabled = locked;
  personalization.disabled = locked;
  runButton.disabled = locked;
  pauseButton.disabled = !locked || state.waitingForConfirmation;
  $("resetBtn").disabled = false;
  confirmButton.hidden = !state.waitingForConfirmation;
}

function setMotion(name, durationMs) {
  document.documentElement.style.setProperty("--motion-duration", `${Math.max(1, durationMs)}ms`);
  wireScene.dataset.motion = name;
}

function schedule(ms, callback) {
  clearTimeout(state.timer);
  state.remainingMs = ms;
  state.pendingCallback = callback;
  state.timerStartedAt = performance.now();
  state.timer = window.setTimeout(() => {
    state.timer = null;
    state.remainingMs = 0;
    state.pendingCallback = null;
    callback();
  }, ms);
}

function completeStep(step) {
  const profile = profiles[state.persona];
  if (isPersonalized() && state.persona === "sarah" && step.pauseAfter) {
    const pause = profile.settlingPause;
    setMotion("settle", Math.min(520, pause));
    setStatus("Sarah is taking a settling pause", "The familiar routine pauses briefly before its next step.");
    schedule(pause, () => {
      state.stepIndex += 1;
      advanceSequence();
    });
    return;
  }
  state.stepIndex += 1;
  advanceSequence();
}

function performStep(step) {
  state.waitingForConfirmation = false;
  state.currentStep = step;
  confirmButton.hidden = true;
  const profile = profiles[state.persona];
  const personalized = isPersonalized();
  const pace = personalized ? profile.pace : 1;
  setMotion(step.motion, 480 * pace);
  renderTimeline(state.stepIndex);
  updateProgress((state.stepIndex / selectedTask().steps.length) * 100, `Step ${state.stepIndex + 1} of ${selectedTask().steps.length}`);

  let detail = step.detail;
  if (personalized && state.persona === "sarah" && step.confirm) detail += " Sarah lets this familiar step proceed independently.";
  if (personalized && state.persona === "alex" && step.confirm) detail += " Alex confirmed this action.";
  setStatus(step.title, detail);
  pauseButton.disabled = false;
  pauseButton.textContent = "Pause";
  schedule(step.duration * pace, () => completeStep(step));
}

function advanceSequence() {
  const steps = selectedTask().steps;
  if (state.stepIndex >= steps.length) {
    state.active = false;
    state.paused = false;
    state.waitingForConfirmation = false;
    lockSetup(false);
    runButton.textContent = "Replay task preview";
    pauseButton.textContent = "Pause";
    pauseButton.disabled = true;
    renderTimeline(-1, true);
    updateProgress(100, "Preview complete");
    setMotion("settle", 420);
    setStatus("Preview complete", "This was a choreographed visual sequence, not a physical robot task.");
    return;
  }

  const step = steps[state.stepIndex];
  const needsConfirmation = isPersonalized() && state.persona === "alex" && step.confirm;
  renderTimeline(state.stepIndex);
  updateProgress((state.stepIndex / steps.length) * 100, `Step ${state.stepIndex + 1} of ${steps.length}`);
  if (needsConfirmation) {
    state.currentStep = step;
    state.waitingForConfirmation = true;
    lockSetup(true);
    pauseButton.disabled = true;
    confirmButton.textContent = `Confirm: ${step.short}`;
    confirmButton.hidden = false;
    setStatus(`Alex wants to confirm: ${step.title}`, `Review the next visual action. ${step.detail}`);
    return;
  }
  performStep(step);
}

function startPreview() {
  if (state.active) return;
  clearTimeout(state.timer);
  state.active = true;
  state.paused = false;
  state.waitingForConfirmation = false;
  state.stepIndex = 0;
  state.currentStep = null;
  runButton.textContent = "Preview running";
  lockSetup(true);
  advanceSequence();
}

function pauseOrResume() {
  if (!state.active || state.waitingForConfirmation) return;
  if (!state.paused) {
    clearTimeout(state.timer);
    state.timer = null;
    state.remainingMs = Math.max(0, state.remainingMs - (performance.now() - state.timerStartedAt));
    state.paused = true;
    pauseButton.textContent = "Resume";
    setStatus("Preview paused", "Resume when you are ready to continue.");
    return;
  }
  state.paused = false;
  pauseButton.textContent = "Pause";
  if (state.pendingCallback) schedule(state.remainingMs, state.pendingCallback);
  if (state.currentStep) {
    setStatus(state.currentStep.title, state.currentStep.detail);
  }
}

function resetPreview() {
  clearTimeout(state.timer);
  state.active = false;
  state.paused = false;
  state.waitingForConfirmation = false;
  state.stepIndex = 0;
  state.currentStep = null;
  state.remainingMs = 0;
  state.pendingCallback = null;
  setMotion("idle", 420);
  runButton.textContent = "Start task preview";
  pauseButton.textContent = "Pause";
  lockSetup(false);
  updateTask();
}

function selectPersona(persona) {
  if (state.active) return;
  state.persona = persona;
  updatePersona();
}

$("sarahBtn").addEventListener("click", () => selectPersona("sarah"));
$("alexBtn").addEventListener("click", () => selectPersona("alex"));
personalization.addEventListener("change", updatePersona);
taskSelect.addEventListener("change", updateTask);
runButton.addEventListener("click", startPreview);
pauseButton.addEventListener("click", pauseOrResume);
$("resetBtn").addEventListener("click", resetPreview);
confirmButton.addEventListener("click", () => {
  if (!state.waitingForConfirmation || !state.currentStep) return;
  performStep(state.currentStep);
});

updatePersona();
updateTask();
