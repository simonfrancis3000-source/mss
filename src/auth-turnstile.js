// A single, reusable Turnstile challenge for email sign-in, sign-up and password reset.
// Server-side verification is performed by Supabase Auth when CAPTCHA is enabled there.
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise = null;

function loadTurnstile() {
  if (window.turnstile?.render) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => window.turnstile?.render
        ? resolve(window.turnstile)
        : reject(new Error("Security check is unavailable. Refresh and try again."));
      script.onerror = () => reject(new Error("Security check could not load. Check your internet connection."));
      document.head.appendChild(script);
    }).catch((error) => {
      scriptPromise = null;
      throw error;
    });
  }
  return scriptPromise;
}

export function createAuthTurnstile({ siteKey, container }) {
  // Cloudflare Turnstile site key is public. Vite can override it per deployment.
  const key = String(siteKey || "0x4AAAAAAFxQtK2-J-A-K9oc").trim();
  // The production widget is restricted to synqme.mysecondself.app.
  // Do not force an untested CAPTCHA in bundled Capacitor localhost WebViews.
  // Explicit VITE_TURNSTILE_SITE_KEY overrides can enable other verified hosts.
  const hostname = String(window.location?.hostname || "").toLowerCase();
  const configured = Boolean(key) && (
    Boolean(String(siteKey || "").trim()) ||
    !hostname ||
    hostname === "synqme.mysecondself.app"
  );
  const target = container?.querySelector("[data-turnstile-widget]") || null;
  const status = container?.querySelector("[data-turnstile-status]") || null;
  let widgetId = null;
  let pending = null;
  let captchaToken = "";

  function setStatus(message = "") {
    if (status) status.textContent = message;
  }

  async function ensureReady() {
    if (!configured) return;
    if (!target) throw new Error("Security check is unavailable. Refresh and try again.");
    if (widgetId !== null) return;
    if (!pending) {
      pending = loadTurnstile().then((turnstile) => {
        if (widgetId !== null) return;
        widgetId = turnstile.render(target, {
          sitekey: key,
          theme: "auto",
          size: "flexible",
          callback: (token) => {
            captchaToken = token;
            setStatus("");
          },
          "expired-callback": () => {
            captchaToken = "";
            setStatus("Security check expired. Please complete it again.");
          },
          "timeout-callback": () => {
            captchaToken = "";
            setStatus("Security check timed out. Please try again.");
          },
          "error-callback": () => {
            captchaToken = "";
            setStatus("Security check couldn't connect. Please refresh and try again.");
          }
        });
        if (widgetId === null || widgetId === undefined) {
          throw new Error("Security check is unavailable. Refresh and try again.");
        }
      }).catch((error) => {
        setStatus(error.message || "Security check could not load.");
        throw error;
      }).finally(() => {
        pending = null;
      });
    }
    await pending;
  }

  function setMode(mode) {
    if (!container) return;
    container.hidden = !configured || mode === "recovery";
    if (container.hidden) {
      captchaToken = "";
      if (widgetId !== null && window.turnstile?.reset) {
        try { window.turnstile.reset(widgetId); } catch { /* The challenge can reload next time. */ }
      }
      return;
    }
    void ensureReady().catch(() => {});
  }

  async function requireToken() {
    if (!configured) return undefined;
    await ensureReady();
    if (!captchaToken) {
      throw new Error("Complete the security check before continuing.");
    }
    return captchaToken;
  }

  function reset() {
    captchaToken = "";
    if (widgetId !== null && window.turnstile?.reset) {
      try {
        window.turnstile.reset(widgetId);
        setStatus("");
      } catch {
        setStatus("Security check needs refreshing. Reload the page and try again.");
      }
    }
  }

  return { configured, setMode, requireToken, reset };
}
