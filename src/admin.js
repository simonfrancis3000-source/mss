import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const ADMIN_USAGE_URL = SUPABASE_URL
  ? SUPABASE_URL + "/functions/v1/synqme-admin-usage"
  : "";

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

const el = (id) => document.getElementById(id);
const loginPanel = el("loginPanel");
const dashboard = el("dashboard");
const loginForm = el("loginForm");
const loginButton = el("loginButton");
const loginNotice = el("loginNotice");
const signOutButton = el("signOutButton");
const statusLine = el("statusLine");
const userSearch = el("userSearch");
let currentData = null;
let currentSession = null;
let loading = false;

function number(value, digits = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Number(value || 0));
}
function money(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "Not priced";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(Number(value));
}
function minutes(value) {
  return number(value, 1) + " min";
}
function timestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}
function totalUserCost(user) {
  return Number(user.deepseekCostUsd || 0) +
    Number(user.searchCostUsd || 0) +
    Number(user.fetchCostUsd || 0) +
    Number(user.phonicCostUsd || 0);
}
function setNotice(element, message, kind = "") {
  if (!element) return;
  element.textContent = message || "";
  element.dataset.kind = kind;
}
function setBusy(isBusy) {
  loading = isBusy;
  loginButton.disabled = isBusy;
  loginButton.textContent = isBusy ? "Signing in…" : "Sign in securely ↗";
  el("refreshButton").disabled = isBusy;
  el("periodSelect").disabled = isBusy;
}
function showLogin(message = "", kind = "") {
  loginPanel.hidden = false;
  dashboard.hidden = true;
  signOutButton.hidden = true;
  setNotice(loginNotice, message, kind);
}
function showDashboard() {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  signOutButton.hidden = false;
  setNotice(loginNotice, "");
}
async function getAccessToken() {
  if (!supabase) throw new Error("Supabase is not configured in this build. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) throw new Error("Your sign-in session has expired. Sign in again.");
  currentSession = data.session;
  return data.session.access_token;
}

async function loadDashboard() {
  if (loading) return;
  setBusy(true);
  statusLine.textContent = "Refreshing usage data…";
  try {
    const token = await getAccessToken();
    const period = el("periodSelect").value;
    if (!ADMIN_USAGE_URL) throw new Error("Supabase is not configured in this build. Check the frontend environment variables.");
    const response = await fetch(ADMIN_USAGE_URL + "?period=" + encodeURIComponent(period), {
      headers: {
        Authorization: "Bearer " + token,
        apikey: SUPABASE_KEY
      },
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error("Your session is no longer valid. Sign in again.");
    if (response.status === 403) throw new Error(payload.error || "This account is not on the administrator allowlist.");
    if (!response.ok) throw new Error(payload.error || "The admin API returned HTTP " + response.status + ".");
    currentData = payload;
    renderDashboard(payload);
    statusLine.textContent = "Updated " + timestamp(new Date().toISOString()) + " · " + el("periodSelect").selectedOptions[0].textContent;
  } catch (error) {
    statusLine.textContent = error?.message || "Could not load the administration data.";
    if (/session|sign in/i.test(statusLine.textContent)) {
      await supabase?.auth.signOut().catch(() => {});
      currentSession = null;
      showLogin(statusLine.textContent, "error");
    }
  } finally {
    setBusy(false);
  }
}

function renderDashboard(data) {
  const totals = data.totals || {};
  const deepseekTotal = Number(totals.deepseekCostUsd || 0);
  const searchFetchTotal = Number(totals.searchCostUsd || 0) + Number(totals.fetchCostUsd || 0);
  el("registeredUsers").textContent = number(totals.registeredUsers);
  el("activeUsers").textContent = number(totals.activeUsers);
  el("deepseekCost").textContent = money(deepseekTotal + searchFetchTotal);
  el("phonicMinutes").textContent = minutes(totals.voiceMinutes);
  el("knownCost").textContent = money(totals.knownCostUsd);

  el("inputTokens").textContent = number(totals.inputTokens);
  el("cacheTokens").textContent = number(totals.cacheHitTokens);
  el("outputTokens").textContent = number(totals.outputTokens);
  el("chatRequests").textContent = number(totals.chatRequests);
  el("deepseekUnpricedRequests").textContent = number(totals.deepseekUnpricedRequests);
  el("deepseekPricingNote").textContent = Number(totals.deepseekUnpricedRequests || 0)
    ? Number(totals.deepseekUnpricedRequests) + " DeepSeek requests did not include token details. Their inference cost is not calculated."
    : "DeepSeek cost is estimated from provider token usage and the rate card effective at request time. Peak/off-peak estimates use UTC time; Chinese public-holiday exceptions are not applied.";
  el("voiceMinutes").textContent = minutes(totals.voiceMinutes);
  el("userSpeechMinutes").textContent = minutes(totals.userSpeechMinutes);
  el("assistantSpeechMinutes").textContent = minutes(totals.assistantSpeechMinutes);
  el("voiceSessions").textContent = number(totals.voiceSessions);
  el("searchRequests").textContent = number(totals.searchRequests);
  el("fetchRequests").textContent = number(totals.fetchRequests);
  el("searchCost").textContent = money(totals.searchCostUsd);
  el("fetchCost").textContent = money(totals.fetchCostUsd);

  const rate = data.phonicRatePerMinuteUsd;
  const unpriced = Number(totals.phonicUnpricedSessions || 0);
  const pending = Number(totals.pendingVoiceSessions || 0);
  const phonicParts = [];
  if (rate) phonicParts.push("Rate card: " + money(rate) + " per minute.");
  else phonicParts.push("Phonic rate not configured. Set PHONIC_COST_PER_MINUTE_USD on the Supabase usage function.");
  if (unpriced) phonicParts.push(unpriced + " sessions currently have no priced Phonic amount.");
  if (pending) phonicParts.push(pending + " sessions are pending provider reconciliation.");
  el("phonicPricingNote").textContent = phonicParts.join(" ");

  renderUsers(data.users || []);
  renderEvents(data.recentEvents || []);
  el("trackingNote").textContent = data.trackingStartedAt
    ? "Recorded usage from " + timestamp(data.trackingStartedAt) + ". Earlier activity is not included in this ledger."
    : "No provider usage has been recorded yet. Tracking begins with the first authenticated API call.";
}

function renderUsers(users) {
  const query = String(userSearch.value || "").trim().toLowerCase();
  const filtered = users.filter((user) =>
    !query ||
    String(user.email || "").toLowerCase().includes(query) ||
    String(user.ownerName || "").toLowerCase().includes(query) ||
    String(user.userId || "").toLowerCase().includes(query)
  );
  el("userCount").textContent = number(filtered.length) + " of " + number(users.length) + " accounts";
  const body = el("userTableBody");
  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty-cell">No accounts match this search.</td></tr>';
    return;
  }
  body.innerHTML = filtered.map((user) => {
    const cost = totalUserCost(user);
    const name = user.ownerName || user.email || user.userId;
    const secondary = user.ownerName && user.email ? user.email : user.userId;
    const phonicCost = user.phonicUnpricedSessions ? "Partially unpriced" :
      (user.voiceSessions && user.phonicCostUsd === 0 ? "—" : money(user.phonicCostUsd));
    return `<tr>
      <td><div class="user-cell"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(secondary || "—")}</small></div></td>
      <td>${number(user.chatRequests)}</td>
      <td>${number(user.voiceSessions)}</td>
      <td>${minutes(user.voiceMinutes)}</td>
      <td>${money(user.deepseekCostUsd)}</td>
      <td>${number(user.deepseekUnpricedRequests)}</td>
      <td>${money(Number(user.searchCostUsd || 0) + Number(user.fetchCostUsd || 0))}</td>
      <td>${escapeHtml(phonicCost)}</td>
      <td class="cost-cell">${money(cost)}</td>
    </tr>`;
  }).join("");
}
function renderEvents(events) {
  const body = el("eventTableBody");
  if (!events.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty-cell">No usage events are recorded for this period.</td></tr>';
    return;
  }
  body.innerHTML = events.map((event) => `<tr>
    <td>${escapeHtml(timestamp(event.createdAt))}</td>
    <td class="mono">${escapeHtml(String(event.userId || "").slice(0, 8))}…</td>
    <td>${escapeHtml(event.provider || "—")}</td>
    <td>${escapeHtml(event.type || "—")}</td>
    <td>${escapeHtml(event.model || "—")}</td>
    <td><span class="state-pill state-${escapeHtml(event.status || "pending")}">${escapeHtml(event.status || "pending")}</span></td>
    <td class="cost-cell">${money(event.totalCostUsd)}</td>
  </tr>`).join("");
}

function exportCsv() {
  if (!currentData) return;
  const rows = [["Name", "Email", "User ID", "Registered At", "DeepSeek Requests", "Voice Sessions", "Voice Minutes", "User Speech Minutes", "Assistant Speech Minutes", "Input Tokens", "Cached Input Tokens", "Output Tokens", "DeepSeek Unpriced Requests", "Search Requests", "Fetch Requests", "DeepSeek Cost USD", "Search Cost USD", "Fetch Cost USD", "Phonic Cost USD", "Phonic Unpriced Sessions", "Known Total Cost USD"]];
  const query = String(userSearch.value || "").trim().toLowerCase();
  for (const user of currentData.users || []) {
    if (query && ![user.email, user.ownerName, user.userId].some((value) => String(value || "").toLowerCase().includes(query))) continue;
    rows.push([
      user.ownerName || "", user.email || "", user.userId || "", user.createdAt || "",
      user.chatRequests || 0, user.voiceSessions || 0, user.voiceMinutes || 0, user.userSpeechMinutes || 0,
      user.assistantSpeechMinutes || 0, user.inputTokens || 0, user.cacheHitTokens || 0, user.outputTokens || 0,
      user.deepseekUnpricedRequests || 0, user.searchRequests || 0, user.fetchRequests || 0, user.deepseekCostUsd || 0, user.searchCostUsd || 0,
      user.fetchCostUsd || 0, user.phonicUnpricedSessions ? "" : (user.phonicCostUsd || 0), user.phonicUnpricedSessions || 0, totalUserCost(user)
    ]);
  }
  const csv = rows.map((row) => row.map((value) => '"' + String(value ?? "").replace(/"/g, '""') + '"').join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "synqme-usage-" + el("periodSelect").value + ".csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) {
    setNotice(loginNotice, "Supabase is not configured in this build. Check the frontend environment variables.", "error");
    return;
  }
  setBusy(true);
  setNotice(loginNotice, "Checking your account…");
  try {
    const email = el("emailInput").value.trim();
    const password = el("passwordInput").value;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data?.session) throw new Error(error?.message || "Sign-in failed.");
    currentSession = data.session;
    showDashboard();
    setBusy(false);
    await loadDashboard();
  } catch (error) {
    setNotice(loginNotice, error?.message || "Could not sign in.", "error");
  } finally {
    setBusy(false);
  }
});

signOutButton.addEventListener("click", async () => {
  await supabase?.auth.signOut();
  currentSession = null;
  currentData = null;
  showLogin("You have signed out.");
});
el("periodSelect").addEventListener("change", loadDashboard);
el("refreshButton").addEventListener("click", loadDashboard);
el("exportButton").addEventListener("click", exportCsv);
userSearch.addEventListener("input", () => {
  if (currentData) renderUsers(currentData.users || []);
});

if (!supabase) {
  showLogin("This build is missing the Supabase URL or publishable/anon key.", "error");
} else {
  supabase.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    if (session && dashboard.hidden) {
      showDashboard();
      window.setTimeout(loadDashboard, 0);
    } else if (!session && !dashboard.hidden) {
      showLogin();
    }
  });
  supabase.auth.getSession().then(({ data, error }) => {
    if (error || !data?.session) {
      showLogin();
      return;
    }
    currentSession = data.session;
    showDashboard();
    void loadDashboard();
  });
}
