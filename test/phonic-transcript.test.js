import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("voice input transcripts are committed to chat as soon as Phonic transcribes them", async () => {
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  const inputCase = source.match(/case "input_text": \{([\s\S]*?)\n    \}/)?.[1] || "";
  assert.match(inputCase, /syncPhonicTranscriptItems\(event\.items\)/);
  assert.match(inputCase, /if \(synced\.userAdded\) void flushCloudSave\(\)/);
});

test("the exact assistant text is saved before Phonic plays it and partial assistant fragments are not persisted", async () => {
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  const handler = source.match(/async function handlePhonicAmiaToolCall\([\s\S]*?\n\}/)?.[0] || "";
  assert.match(handler, /const spokenReply = enforceFirstPersonTaskQuestions/);
  assert.match(handler, /state\.messages\.push\(\{ role: "assistant", content: spokenReply/);
  assert.match(handler, /persist\(\);[\s\S]*?renderAll\(\);[\s\S]*?return \{ status: "ok", decision_owner: "AMÏA", assistant_text: spokenReply \}/);
  const synchroniser = source.match(/function syncPhonicTranscriptItems\(items\) \{([\s\S]*?)\n\}\n\nfunction handlePhonicVoiceEvent/)?.[1] || "";
  assert.match(synchroniser, /item\.role !== "user"/);
  assert.match(synchroniser, /phonicItemMap\.set\(key, state\.messages\.length - 1\)/);
  assert.doesNotMatch(synchroniser, /role: item\.role/);
});

test("voice sessions do not replay an automatic self-introduction on every reconnect", async () => {
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  const config = source.match(/function buildPhonicConfig\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(config, /welcome_message\s*:/);
  assert.match(config, /Do not introduce yourself again at the start of each voice session/);
});

test("Phonic forwards transcript-bearing input and output audio events to the UI", async () => {
  const source = await readFile(new URL("../src/phonic-voice.js", import.meta.url), "utf8");
  assert.match(source, /emit\(\{ type: "input_text", text \}\)/);
  assert.match(source, /emit\(\{ type: "audio_chunk", audio: message\.audio \|\| "", text \}\)/);
});


test("partial assistant audio transcript fragments are ignored instead of becoming chat bubbles", async () => {
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  const synchroniser = source.match(/function syncPhonicTranscriptItems\(items\) \{([\s\S]*?)\n\}\n\nfunction handlePhonicVoiceEvent/)?.[1] || "";
  assert.match(synchroniser, /item\.role !== "user"/);
  assert.doesNotMatch(synchroniser, /role: item\.role/);
  assert.doesNotMatch(synchroniser, /role === "assistant"/);
  assert.match(source, /state\.messages\.push\(\{ role: "assistant", content: spokenReply/);
});

test("user voice transcripts continue to be synchronised and saved", async () => {
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  const synchroniser = source.match(/function syncPhonicTranscriptItems\(items\) \{([\s\S]*?)\n\}\n\nfunction handlePhonicVoiceEvent/)?.[1] || "";
  assert.match(synchroniser, /state\.messages\.push\(\{ role: "user", content: textValue/);
  assert.match(source, /case "input_text": \{[\s\S]*?syncPhonicTranscriptItems\(event\.items\)/);
  assert.match(source, /case "audio_chunk": \{[\s\S]*?syncPhonicTranscriptItems\(event\.items\)/);
});


test("legacy one-word assistant audio fragments are removed when transcripts are restored", async () => {
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  const sanitiser = source.match(/function sanitiseConversationMessage\(item\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(sanitiser, /item\.role === "assistant"/);
  assert.match(sanitiser, /\^i\(\?:\['’\]m\| am\)\?\$/);
  assert.match(source, /return sanitiseConversationMessage\(m\);\s*\}\)\s*\.filter\(Boolean\)/);
});
