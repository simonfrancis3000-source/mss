import "./connected-home.css";
import { Capacitor, registerPlugin } from "@capacitor/core";

const isNativeAndroid = Capacitor.getPlatform() === "android";
const smartThingsBridge = isNativeAndroid ? registerPlugin("MSSSmartThings") : null;

const text = (tag, className, content) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
};

export function createConnectedHome({ apiBase, getHeaders, getUserId }) {
  const base = String(apiBase || "https://synqme-api.onrender.com").replace(/\/+$/, "");
  const overlay = text("div", "mss-connected-home-overlay");
  overlay.hidden = true;
  const dialog = text("section", "mss-connected-home-panel");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Connected Home");
  const top = text("div", "mss-connected-home-top");
  const headings = text("div");
  headings.append(text("h2", "", "Connected Home"), text("p", "", "Help your future robot understand your home."));
  const closeButton = text("button", "mss-connected-home-close", "Close");
  closeButton.type = "button";
  top.append(headings, closeButton);
  const title = text("h3", "", "Samsung SmartThings");
  const privacy = text("p", "mss-connected-home-privacy", "Read-only connection. AMÏA can identify compatible devices but cannot control them.");
  const status = text("p", "mss-connected-home-status", "");
  status.setAttribute("role", "status");
  const devices = text("div", "mss-connected-home-devices");
  const controls = text("div", "mss-connected-home-controls");
  const connect = text("button", "mss-connected-home-primary", "Connect SmartThings");
  const sync = text("button", "", "Refresh Devices");
  const disconnect = text("button", "mss-connected-home-danger", "Disconnect");
  for (const button of [connect, sync, disconnect]) button.type = "button";
  controls.append(connect, sync, disconnect);
  dialog.append(top, title, privacy, status, devices, controls);
  overlay.append(dialog);
  document.body.append(overlay);
  let current = null;
  let busy = false;
  const busyButtons = flag => {
    busy = flag;
    for (const button of [connect, sync, disconnect]) button.disabled = flag;
  };
  const setMessage = message => { status.textContent = message; };
  const request = async (path, method = "GET") => {
    const response = await fetch(base + "/api/integrations/smartthings/" + path, {
      method,
      headers: {
        ...await getHeaders(),
        ...(isNativeAndroid && path === "start" ? {"X-MSS-Connected-Home-Client":"android"} : {})
      },
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The SmartThings service is temporarily unavailable.");
    return payload;
  };
  function render(data) {
    current = data;
    devices.replaceChildren();
    connect.hidden = Boolean(data.connected);
    sync.hidden = !data.connected;
    disconnect.hidden = !data.connected;
    if (!data.connected) {
      setMessage("Not connected. Connect to identify your supported household devices.");
      return;
    }
    const found = Array.isArray(data.devices) ? data.devices : [];
    setMessage(found.length + " devices discovered" + (data.syncedAt ? " · Last updated " + new Date(data.syncedAt).toLocaleString() : "") + ".");
    if (!found.length) {
      if (data.syncedAt) {
        setMessage("SmartThings connected successfully");
        devices.append(
          text("p", "", "No devices were found in your SmartThings account."),
          text("p", "", "That's fine! You can continue training your future robot by telling AMÏA about your appliances and household equipment. SmartThings is entirely optional."),
          text("p", "", "If you add compatible devices later, select Refresh Devices to import them.")
        );
      } else {
        setMessage("SmartThings connected. Device discovery has not yet completed.");
        devices.append(text("p", "", "Select Refresh Devices to import any compatible devices in your SmartThings account."));
      }
      return;
    }
    for (const device of found) {
      const card = text("div", "mss-connected-home-device");
      card.append(text("strong", "", device.label || device.name || "Connected device"));
      const details = [device.manufacturer, device.model, device.category].filter(Boolean).join(" · ");
      if (details) card.append(text("p", "", details));
      const capabilities = Array.isArray(device.capabilities) ? device.capabilities.slice(0, 6).join(", ") : "";
      if (capabilities) card.append(text("small", "", "Capabilities: " + capabilities));
      devices.append(card);
    }
  }
  async function load() {
    busyButtons(true);
    setMessage("Checking your SmartThings connection...");
    try { render(await request("status")); }
    catch (error) { setMessage(error.message); }
    finally { busyButtons(false); }
  }
  function close() {
    overlay.hidden = true;
    document.body.classList.remove("mss-connected-home-open");
  }
  async function open() {
    // Always present the panel, even if Supabase is still restoring the account.
    // A missing account token must produce a visible status, never a dead settings button.
    if (!overlay.isConnected) document.body.append(overlay);
    overlay.hidden = false;
    document.body.classList.add("mss-connected-home-open");
    closeButton.focus();
    await load();
  }
  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  document.addEventListener("keydown", event => { if (!overlay.hidden && event.key === "Escape") close(); });
  connect.addEventListener("click", async () => {
    busyButtons(true);
    try {
      const payload = await request("start", "POST");
      const url = new URL(payload.authorizationUrl);
      if (url.origin !== "https://api.smartthings.com") throw new Error("Unexpected SmartThings authorisation address.");
      if (isNativeAndroid) {
        await smartThingsBridge.openAuthorization({url:url.toString()});
        setMessage("Complete Samsung authorisation in your browser. You will return to MySecondSelf automatically.");
        busyButtons(false);
      } else {
        window.location.assign(url.toString());
      }
    } catch (error) { setMessage(error.message); busyButtons(false); }
  });
  sync.addEventListener("click", async () => {
    if (busy) return;
    busyButtons(true); setMessage("Discovering devices...");
    try {
      await request("sync", "POST");
      render(await request("status"));
    } catch (error) { setMessage(error.message); }
    finally { busyButtons(false); }
  });
  disconnect.addEventListener("click", async () => {
    if (busy || !window.confirm("Disconnect Samsung SmartThings and remove its imported device inventory from MSS?")) return;
    busyButtons(true);
    try { render(await request("disconnect", "POST")); }
    catch (error) { setMessage(error.message); }
    finally { busyButtons(false); }
  });
  // The Samsung sign-in page opens in the Android browser. When it returns
  // to the MSS app, re-fetch authenticated status rather than trusting a URL
  // or a cached device list. Browser redirects keep their original behaviour.
  if (isNativeAndroid) {
    let lastReturnCheck = 0;
    const refreshAfterReturn = async () => {
      if (overlay.hidden || !getUserId() || busy || Date.now() - lastReturnCheck < 750) return;
      lastReturnCheck = Date.now();
      let outcome = null;
      try {
        outcome = (await smartThingsBridge.consumeRedirect()).outcome;
      } catch {
        // A device with an older native bridge can still refresh on return.
      }
      await load();
      if (outcome && outcome !== "connected" && current?.connected !== true) {
        setMessage("SmartThings authorisation was not completed (" + outcome + "). You can try again.");
      }
    };
    window.addEventListener("focus", () => void refreshAfterReturn());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void refreshAfterReturn();
    });
  }
  const outcome = new URL(window.location.href).searchParams.get("smartthings");
  if (outcome) {
    const url = new URL(window.location.href);
    url.searchParams.delete("smartthings");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    // Do not assume Supabase has restored the session at module initialization.
    const onReady = () => {
      if (!getUserId()) return false;
      void open().then(() => {
        if (outcome !== "connected") setMessage("SmartThings authorisation was not completed (" + outcome + "). You can try again.");
      });
      return true;
    };
    if (!onReady()) {
      const interval = window.setInterval(() => { if (onReady()) window.clearInterval(interval); }, 500);
      window.setTimeout(() => window.clearInterval(interval), 20000);
    }
  }
  return { open, close, refresh: load };
}
