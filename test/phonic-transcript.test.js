import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("voice input transcripts are committed to chat as soon as Phonic transcribes them", async () => {
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  const inputCase = source.match(/case "input_text": \{([\s\S]*?)\n    \}/)?.[1] || "";
  assert.match(inputCase, /syncPhonicTranscriptItems\(event\.items\)/);
  assert.match(inputCase, /if \(synced\.userAdded\) void flushCloudSave\(\)/);
});

test("the exact assistant text is saved before Phonic plays it and transcript chunks are linked to it", async () => {
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  assert.match(source, /state\.messages\.push\(\{ role: "assistant", content: spokenReply/);
  assert.match(source, /pendingPhonicAssistantMessageIndex = state\.messages\.length - 1/);
  assert.match(source, /phonicCanonicalAssistantItemKeys\.add\(key\)/);
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
