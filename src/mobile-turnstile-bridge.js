// Native Capacitor authentication runs on localhost, which is not authorized
// for the production Cloudflare Turnstile widget. Load only the challenge from
// our trusted HTTPS hostname in a WebView iframe, then accept a single-use
// token over an origin-, frame- and nonce-validated postMessage channel.
// No account credentials or Supabase sessions ever enter the iframe.
export function createMobileAuthTurnstile({ container }) {
  const BRIDGE_ORIGIN = "https://synqme.mysecondself.app";
  const BRIDGE_URL = BRIDGE_ORIGIN + "/turnstile-bridge.html";
  const target = container?.querySelector("[data-turnstile-widget]") || null;
  const status = container?.querySelector("[data-turnstile-status]") || null;
  let frame = null;
  let nonce = "";
  let captchaToken = "";
  let ready = false;
  let readyPromise = null;
  let readyResolve = null;
  let readyReject = null;
  let readyTimeout = null;

  function setStatus(message = "") {
    if (status) status.textContent = message;
  }
  function resetLoading(error) {
    if (readyTimeout !== null) window.clearTimeout(readyTimeout);
    readyTimeout = null;
    if (readyReject) readyReject(error);
    readyResolve = null;
    readyReject = null;
    readyPromise = null;
    ready = false;
    captchaToken = "";
    frame?.remove();
    frame = null;
    nonce = "";
  }
  function post(type) {
    if (frame?.contentWindow && nonce) {
      frame.contentWindow.postMessage({ type, nonce }, BRIDGE_ORIGIN);
    }
  }
  function handleMessage(event) {
    const data = event.data;
    if (!frame || event.origin !== BRIDGE_ORIGIN ||
        event.source !== frame.contentWindow ||
        !data || data.nonce !== nonce) return;
    if (data.type === "mss-turnstile:ready") {
      ready = true;
      if (readyTimeout !== null) window.clearTimeout(readyTimeout);
      readyTimeout = null;
      readyResolve?.();
      readyResolve = null;
      readyReject = null;
      setStatus("");
    } else if (data.type === "mss-turnstile:token" && typeof data.token === "string" &&
               data.token.length > 0 && data.token.length <= 2048) {
      if (container?.hidden) return;
      captchaToken = data.token;
      setStatus("");
    } else if (data.type === "mss-turnstile:expired") {
      captchaToken = "";
      setStatus("Security check expired. Please complete it again.");
    } else if (data.type === "mss-turnstile:error") {
      captchaToken = "";
      const message = "Security verification could not complete. Check your internet connection and try again.";
      setStatus(message);
      if (!ready) resetLoading(new Error(message));
    }
  }

  window.addEventListener("message", handleMessage);

  async function ensureReady() {
    if (ready && frame) return;
    if (readyPromise) return readyPromise;
    if (!target) throw new Error("Security check is unavailable. Restart the app and try again.");
    const cryptoSource = window.crypto;
    if (!cryptoSource?.getRandomValues) throw new Error("Secure verification is unavailable on this device.");
    nonce = Array.from(cryptoSource.getRandomValues(new Uint8Array(16)))
      .map(byte => byte.toString(16).padStart(2, "0")).join("");
    captchaToken = "";
    setStatus("Loading security verification…");
    const url = BRIDGE_URL + "#nonce=" + nonce;
    frame = document.createElement("iframe");
    frame.title = "Cloudflare security verification";
    frame.src = url;
    frame.referrerPolicy = "no-referrer";
    frame.setAttribute("aria-label", "Cloudflare security verification");
    frame.style.width = "100%";
    frame.style.height = "116px";
    frame.style.border = "0";
    frame.style.display = "block";
    frame.onload = () => { post("mss-turnstile:init"); };
    frame.onerror = () => {
      const message = "Could not load security verification. Check your connection.";
      setStatus(message);
      resetLoading(new Error(message));
    };
    readyPromise = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
      readyTimeout = window.setTimeout(() => {
        const message = "Security verification did not load. Check your connection and try again.";
        setStatus(message);
        resetLoading(new Error(message));
      }, 15000);
    });
    target.replaceChildren(frame);
    return readyPromise;
  }

  function setMode(mode) {
    if (!container) return;
    container.hidden = mode === "recovery";
    if (container.hidden) {
      captchaToken = "";
      if (frame) post("mss-turnstile:reset");
      return;
    }
    void ensureReady().catch(() => {});
  }
  async function requireToken() {
    await ensureReady();
    if (!captchaToken) throw new Error("Complete the security check before continuing.");
    return captchaToken;
  }
  function reset() {
    captchaToken = "";
    if (frame && ready) {
      post("mss-turnstile:reset");
      setStatus("");
    }
  }

  return { configured: true, setMode, requireToken, reset };
}
