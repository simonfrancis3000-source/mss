import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.hidden = false;
    this.isConnected = false;
    this.textContent = "";
    this.attributes = {};
    this.events = {};
    this.classes = new Set();
    this.classList = {
      add: value => this.classes.add(value),
      remove: value => this.classes.delete(value),
      contains: value => this.classes.has(value)
    };
  }
  append(...children) {
    this.children.push(...children);
    for (const item of children) if (item && typeof item === "object") item.isConnected = this.isConnected;
  }
  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.events[name] = callback; }
  focus() { this.focused = true; }
}

const body = new Element("body");
body.isConnected = true;
const document = {
  body,
  createElement: tagName => new Element(tagName),
  addEventListener: () => {}
};
const window = {
  location: { href: "https://synqme.mysecondself.app/" }
};
globalThis.document = document;
globalThis.window = window;

// The production module imports CSS for Vite. Remove only that import for this
// dependency-free Node DOM regression check; run all original JavaScript.
const source = readFileSync(new URL("../src/connected-home.js", import.meta.url), "utf8")
  .replace(/^import "\.\/connected-home\.css";\s*/u, "");
const moduleUrl = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const { createConnectedHome } = await import(moduleUrl);

test("Connected Home panel opens even while Supabase is restoring the account", async () => {
  let apiCalled = false;
  const connection = createConnectedHome({
    apiBase: "https://synqme-api.onrender.com",
    getUserId: () => null,
    getHeaders: async () => { throw new Error("Your session is still loading. Sign in to continue."); }
  });
  const overlay = body.children.at(-1);
  assert.equal(overlay.hidden, true);
  await connection.open();
  assert.equal(overlay.hidden, false, "the panel must be visible before auth is checked");
  assert.equal(body.classList.contains("mss-connected-home-open"), true);
  const dialog = overlay.children[0];
  assert.equal(dialog.children[0].children[1].focused, true, "close control should receive focus");
  assert.match(dialog.children[3].textContent, /session is still loading/u);
  assert.equal(apiCalled, false);
  connection.close();
  assert.equal(overlay.hidden, true);
});

test("Connected Home shows the zero-device success copy after successful sync", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    assert.match(String(input), /\/api\/integrations\/smartthings\/status$/u);
    return {
      ok: true,
      json: async () => ({ connected: true, devices: [], syncedAt: "2026-11-04T16:54:11.839Z" })
    };
  };
  try {
    const connection = createConnectedHome({
      apiBase: "https://synqme-api.onrender.com",
      getUserId: () => "some-user",
      getHeaders: async () => ({ Authorization: "Bearer dummy" })
    });
    const overlay = body.children.at(-1);
    await connection.open();
    assert.equal(overlay.hidden, false);
    const dialog = overlay.children[0];
    assert.equal(dialog.children[3].textContent, "SmartThings connected successfully");
    const messages = dialog.children[4].children.map(el => el.textContent).join(" ");
    assert.match(messages, /No devices were found in your SmartThings account/u);
    assert.match(messages, /SmartThings is entirely optional/u);
    assert.match(messages, /select Refresh Devices to import them/u);
    connection.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
