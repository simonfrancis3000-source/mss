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


test("Journey integrates public scenarios without a second training browser", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="outOfHomeTraining"/);
  assert.doesNotMatch(html, /id="outOfHomeScenarioList"/);
  assert.match(source, /scenarioTasks\(scenario\)/);
  assert.match(source, /renderScenarioSummary\(scenario\)/);
  assert.match(source, /startJourneyScenario\(scenario, task\)/);
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


test("portable PEXI export contains structured out-of-home preferences and boundaries", async () => {
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  assert.ok(source.includes('schema_version: "1.2.0"'));
  assert.match(source, /persona_memories: personaMemories/);
  assert.match(source, /out_of_home_preferences: outOfHomePreferences/);
  assert.match(source, /out_of_home_boundaries: outOfHomeBoundaries/);
  assert.match(source, /out_of_home_behaviour_preferences_included: true/);
  assert.ok(source.includes("function activePersonaMemories()"));
});


test("provider and model names are not rendered in the SYNQ.ME interface or conversation status", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  assert.match(html, /AMÏA · PERSONAL INTELLIGENCE/);
  assert.doesNotMatch(html, /providerLabel|Checking AI connection|DeepSeek|deepseek-flash/i);
  assert.doesNotMatch(source, /elements\\.providerLabel|responseProviderLabel/);
  assert.doesNotMatch(source, /DEEPSEEK ONLY · BACKEND CHECK REQUIRED/);
  assert.match(source, /"AMÏA is ready"/);
  assert.match(source, /"AMÏA is temporarily unavailable"/);
});

test("voice view pulses the robot ring only while the user is speaking", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/synqme.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  assert.match(html, /id="voiceOrbCore"/);
  assert.match(css, /voice-orb\[data-state="user-speaking"\] \.voice-orb-ring-one\s*\{\s*animation:\s*voice-user-pulse/);
  assert.match(source, /case "user_started_speaking":[\s\S]*?updateVoiceExperience\("user-speaking"/);
  assert.match(source, /case "user_finished_speaking":[\s\S]*?updateVoiceExperience\("thinking"/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
