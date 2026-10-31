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


test("PEXI offers a target robot capability manifest import", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="pexiManifestInput"/);
  assert.match(html, /id="pexiManifestStatus"/);
  assert.match(html, /id="removePexiManifest"/);
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  assert.match(source, /cleanPexiCapabilityManifest/);
  assert.match(source, /PEXI_CAPABILITY_MANIFEST_KEY/);
  assert.match(source, /capabilityManifest: pexiCapabilityManifest/);
});


test("PEXI includes a per-task capability view and downloadable manifest template", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="pexiCapabilityPlanList"/);
  assert.match(html, /id="downloadPexiManifestTemplate"/);
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  assert.match(source, /function renderPexiCapabilityDetails\(plan\)/);
  assert.match(source, /function downloadPexiManifestTemplate\(\)/);
  assert.match(source, /REPLACE_WITH_MANUFACTURER_SPECIFICATION_URL/);
});


test("Beyond the Home exposes progressive out-of-home scenario training", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  const training = await readFile(new URL("../src/out-of-home-training.js", import.meta.url), "utf8");
  assert.match(html, /id="outOfHomeTraining"/);
  assert.match(html, /Beyond the Home/);
  assert.match(html, /data-out-of-home-stage="everyday"/);
  assert.match(html, /data-out-of-home-stage="social"/);
  assert.match(html, /data-out-of-home-stage="advanced"/);
  assert.match(html, /id="outOfHomeCategorySelect"/);
  assert.match(html, /id="outOfHomeScenarioList"/);
  assert.ok(html.includes("PEXI / CAPABILITY VALIDATION"));
  assert.match(source, /buildOutOfHomeScenarioPrompt/);
  assert.match(source, /initialiseOutOfHomeTrainingControls/);
  assert.match(source, /renderOutOfHomeTraining/);
  assert.match(training, /Social and contextual intelligence/);
});

test("first-use introduction audio is offered before conversation and can be replayed", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  assert.match(html, /id="welcomeAudioOffer"/);
  assert.match(html, /id="welcomeAudioPlayer" controls preload="none"/);
  assert.match(html, /https:\/\/mysecondself\.app\/wp-content\/uploads\/2026\/10\/MSS-Intro\.mp3/);
  assert.match(html, /id="welcomeAudioContinue"/);
  assert.match(html, /id="welcomeAudioSkip"/);
  assert.match(html, /id="introAudioReplay"/);
  assert.match(html, /id="chatStage" hidden/);
  assert.doesNotMatch(html.match(/<audio id="welcomeAudioPlayer"[^>]*>/)?.[0] || "", /autoplay/i);
  assert.match(source, /prepareWelcomeAudioOffer/);
  assert.match(source, /INTRO_AUDIO_DISMISSED_KEY/);
  assert.match(source, /introAudioStorageKey/);
  assert.match(source, /openWelcomeAudioOffer/);
});


test("the public app UI presents AMÏA without exposing an AI provider or model", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  assert.match(html, /AMÏA · PERSONAL INTELLIGENCE/);
  assert.doesNotMatch(html, /id="providerLabel"/i);
  assert.doesNotMatch(html, /Checking AI connection/i);
  assert.doesNotMatch(source, /elements\\.providerLabel/);
  assert.doesNotMatch(source, /responseProviderLabel/);
  assert.doesNotMatch(source, /DEEPSEEK ONLY · BACKEND CHECK REQUIRED/);
  assert.match(source, /"AMÏA is ready"/);
  assert.match(source, /AMÏA is temporarily unavailable/);
});
