import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("Talk portrait uses a slight sine-wave line instead of an open mouth", () => {
  const markup = read("../src/mss-interface.js");
  const match = markup.match(/<g class="mss-robot-mouth-shape">([\s\S]*?)<\/g>/);
  assert.ok(match, "speaking-mouth overlay should exist");
  assert.match(match[1], /M315 342 C326 338 337 338 348 342 S370 346 381 342/);
  assert.match(match[1], /fill="none"/);
  assert.doesNotMatch(match[1], /\bfill="#0[0-9a-f]{5}"/i, "speaking mouth must not use a dark, filled oval");
});

test("Selectable robots use the same line-style mouth while speaking", () => {
  const markup = read("../src/synqme.js");
  assert.match(markup, /class="robot-mouth-speaking"><path d="M52 69 C55 67 57 67 60 69 S65 71 68 69"/);
  assert.doesNotMatch(markup, /class="robot-mouth-speaking"><ellipse/);
  assert.match(markup, /class="robot-mouth-rest" d="M52 68q8 5 16 0"/, "resting smile must be preserved");
});

test("Speaking animation gently varies a wave rather than opening a large mouth", () => {
  const main = read("../src/mss-interface.css");
  const alternate = read("../src/synqme-soft.css");
  for (const [name,css] of [["portrait", main],["selectable", alternate]]) {
    const match = css.match(new RegExp("@keyframes " + (name === "portrait" ? "mss-robot-mouth-talk" : "robot-mouth-talk") + "\\s*\\{([^}]*\\}[^}]*\\}[^}]*\\}[^}]*\\})"));
    assert.ok(match, name + " speaking keyframes must exist");
    assert.match(match[0], /translateY/);
    assert.doesNotMatch(match[0], /scale\([^)]*,\s*\.(?:1|2|3)\)/);
  }
});
