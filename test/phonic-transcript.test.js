import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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


test("legacy one-word assistant audio fragments are removed when transcripts are restored", async () => {
  const source = await readFile(new URL("../src/synqme.js", import.meta.url), "utf8");
  const sanitiser = source.match(/function sanitiseConversationMessage\(item\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(sanitiser, /item\.role === "assistant"/);
  assert.match(sanitiser, /\^i\(\?:\['’\]m\| am\)\?\$/);
  assert.match(source, /return sanitiseConversationMessage\(m\);\s*\}\)\s*\.filter\(Boolean\)/);
});
