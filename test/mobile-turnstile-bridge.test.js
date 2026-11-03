import test from "node:test";
import assert from "node:assert/strict";
import { createMobileAuthTurnstile } from "../src/mobile-turnstile-bridge.js";

function fakeApp() {
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const messages = [];
  const listeners = new Map();
  const timers = new Map();
  let timerCounter = 0;
  let frame;
  const widget = {
    replaceChildren(child) {
      frame = child;
      frame.onload();
    }
  };
  const status = { textContent: "" };
  const container = {
    hidden: true,
    querySelector(selector) {
      if (selector === "[data-turnstile-widget]") return widget;
      if (selector === "[data-turnstile-status]") return status;
      return null;
    }
  };
  globalThis.window = {
    crypto: { getRandomValues(bytes) { for (let i = 0; i < bytes.length; i++) bytes[i] = i + 3; return bytes; } },
    addEventListener(type, callback) { listeners.set(type, callback); },
    setTimeout(callback) { const id = ++timerCounter; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "iframe");
      return {
        style: {},
        setAttribute() {},
        remove() { frame = null; },
        contentWindow: {
          postMessage(message, targetOrigin) { messages.push({ message, targetOrigin }); }
        }
      };
    }
  };
  function send(type, token, origin = "https://synqme.mysecondself.app", source = frame?.contentWindow, nonce = new URL(frame.src).hash.slice(7)) {
    listeners.get("message")?.({ origin, source, data: { type, nonce, ...(token ? { token } : {}) } });
  }
  return {
    container, status, messages, send, get frame() { return frame; }, get timers() { return timers; },
    restore() {
      if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
      if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    }
  };
}

test("Android CAPTCHA accepts a token only from the correct HTTPS frame and nonce", async () => {
  const app = fakeApp();
  try {
    const guard = createMobileAuthTurnstile({ container: app.container });
    guard.setMode("signin");
    assert.equal(app.container.hidden, false);
    assert.equal(new URL(app.frame.src).origin, "https://synqme.mysecondself.app");
    assert.equal(new URL(app.frame.src).pathname, "/turnstile-bridge.html");
    const nonce = new URL(app.frame.src).hash.slice(7);
    assert.match(nonce, /^[0-9a-f]{32}$/);
    assert.equal(app.messages[0].targetOrigin, "https://synqme.mysecondself.app");
    assert.equal(app.messages[0].message.type, "mss-turnstile:init");

    app.send("mss-turnstile:ready");
    app.send("mss-turnstile:token", "malicious", "https://evil.example");
    app.send("mss-turnstile:token", "malicious", "https://synqme.mysecondself.app", {});
    app.send("mss-turnstile:token", "malicious", "https://synqme.mysecondself.app", app.frame.contentWindow, "wrong-nonce");
    await assert.rejects(guard.requireToken(), /Complete the security check/);
    app.send("mss-turnstile:token", "real-captcha-token");
    assert.equal(await guard.requireToken(), "real-captcha-token");
    guard.reset();
    assert.equal(app.messages.at(-1).message.type, "mss-turnstile:reset");
    await assert.rejects(guard.requireToken(), /Complete the security check/);
    app.send("mss-turnstile:token", "fresh-captcha-token");
    assert.equal(await guard.requireToken(), "fresh-captcha-token");
  } finally { app.restore(); }
});

test("Expired challenges and recovery mode cannot reuse old mobile CAPTCHA tokens", async () => {
  const app = fakeApp();
  try {
    const guard = createMobileAuthTurnstile({ container: app.container });
    guard.setMode("signup");
    app.send("mss-turnstile:ready");
    app.send("mss-turnstile:token", "first-token");
    assert.equal(await guard.requireToken(), "first-token");
    app.send("mss-turnstile:expired");
    await assert.rejects(guard.requireToken(), /Complete the security check/);
    app.send("mss-turnstile:token", "second-token");
    guard.setMode("recovery");
    assert.equal(app.container.hidden, true);
    await assert.rejects(guard.requireToken(), /Complete the security check/);
    guard.setMode("signin");
    app.send("mss-turnstile:token", "third-token");
    assert.equal(await guard.requireToken(), "third-token");
  } finally { app.restore(); }
});

test("Native CAPTCHA fails closed when the hosted challenge does not load", async () => {
  const app = fakeApp();
  try {
    const guard = createMobileAuthTurnstile({ container: app.container });
    guard.setMode("signin");
    const failure = guard.requireToken();
    const timer = [...app.timers.values()][0];
    timer();
    await assert.rejects(failure, /Security verification did not load/);
    assert.equal(app.frame, null);
    assert.match(app.status.textContent, /did not load/);
  } finally { app.restore(); }
});
