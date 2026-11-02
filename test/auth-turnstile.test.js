import test from "node:test";
import assert from "node:assert/strict";
import { createAuthTurnstile } from "../src/auth-turnstile.js";

function fakeContainer() {
  const widget = {};
  const status = { textContent: "" };
  const container = {
    hidden: true,
    querySelector(selector) {
      if (selector === "[data-turnstile-widget]") return widget;
      if (selector === "[data-turnstile-status]") return status;
      return null;
    }
  };
  return { container, status, widget };
}

test("Turnstile is opt-in until the public site key is configured", async () => {
  const { container } = fakeContainer();
  const guard = createAuthTurnstile({ siteKey: "", container });
  guard.setMode("signin");
  assert.equal(container.hidden, true);
  assert.equal(await guard.requireToken(), undefined);
});

test("Turnstile protects auth actions and rejects missing, stale and reused tokens", async () => {
  const previousWindow = globalThis.window;
  let options;
  const resetIds = [];
  globalThis.window = {
    turnstile: {
      render(_element, opts) { options = opts; return "widget-1"; },
      reset(widgetId) { resetIds.push(widgetId); }
    }
  };
  try {
    const { container, status } = fakeContainer();
    const guard = createAuthTurnstile({ siteKey: "public-site-key", container });
    guard.setMode("signin");
    assert.equal(container.hidden, false);
    await assert.rejects(guard.requireToken(), /Complete the security check/);
    options.callback("first-token");
    assert.equal(await guard.requireToken(), "first-token");
    options["expired-callback"]();
    assert.match(status.textContent, /expired/);
    await assert.rejects(guard.requireToken(), /Complete the security check/);
    options.callback("second-token");
    guard.reset();
    assert.deepEqual(resetIds, ["widget-1"]);
    await assert.rejects(guard.requireToken(), /Complete the security check/);
    options.callback("third-token");
    guard.setMode("recovery");
    assert.equal(container.hidden, true);
    assert.deepEqual(resetIds, ["widget-1", "widget-1"]);
    guard.setMode("signup");
    assert.equal(container.hidden, false);
    await assert.rejects(guard.requireToken(), /Complete the security check/);
    options.callback("fourth-token");
    assert.equal(await guard.requireToken(), "fourth-token");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
