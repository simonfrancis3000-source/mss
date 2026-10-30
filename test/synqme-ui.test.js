import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("conversation is primary and persona information is available on demand", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /A SecondSelf that/);
  assert.match(html, /id="chatMessages"/);
  assert.match(html, /class="persona-insights-drawer"/);
  assert.match(html, /Your SecondSelf at a glance/);
  assert.doesNotMatch(html, /id="localAIProgress"/);
  assert.doesNotMatch(html, /Downloading local AMÏA model/);
});

test("robot naming remains optional and voice copy describes the transcript flow", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const robotNameField = html.match(/<input id="robotName"[^>]*>/)?.[0] || "";
  assert.ok(robotNameField);
  assert.doesNotMatch(robotNameField, /required/i);
  assert.match(html, /Naming your future companion is optional/);
  assert.match(html, /Spoken words appear as text in this chat/);
  assert.doesNotMatch(html, /Browser voice quality varies by device/);
});

test("settings keep advanced persona review sections collapsible", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<details class="settings-disclosure">[\s\S]*?Companion appearance/);
  assert.match(html, /Learned preferences/);
  assert.match(html, /AMÏA memory library/);
  assert.match(html, /Home interests/);
});
