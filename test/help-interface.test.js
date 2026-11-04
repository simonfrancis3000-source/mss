import test from 'node:test';
import assert from 'node:assert/strict';
import { createHelpInterface } from '../src/help-interface.js';

function fixture(t, overrides = {}) {
  class Node {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.events = {}; this.attributes = {}; this.open = false; this.paused = true; this.currentTime = 0; this.plays = 0; }
    append(...nodes) { for (const node of nodes) { if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(item => item !== node); node.parentElement = this; this.children.push(node); } }
    replaceChildren(...nodes) { for (const node of this.children) node.parentElement = null; this.children = []; this.append(...nodes); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, callback) { this.events[key] = callback; }
    showModal() { this.open = true; }
    close() { this.open = false; this.events.close?.(); }
    focus() {}
    pause() { this.paused = true; }
    play() { this.plays++; this.paused = false; return this.fail ? Promise.reject(Error('blocked')) : Promise.resolve(); }
    querySelector() { return null; }
  }
  const body = new Node('body'), main = new Node('main'); body.append(main);
  const originals = Object.fromEntries(['document', 'window', 'requestAnimationFrame'].map(key => [key, globalThis[key]]));
  Object.assign(globalThis, { document: { body, createElement: tag => new Node(tag), querySelector: () => main }, window: { scrollTo() {} }, requestAnimationFrame: callback => callback() });
  t.after(() => { for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const context = { userId: 'account', profileReady: true, companion: '', view: 'profile', ...overrides };
  const help = createHelpInterface({ getContext: () => context, navigate() {}, dismiss: async () => {}, pauseTalk() {}, editPrivacy() {}, openSupport() {}, snapshot: () => ({}) });
  const walk = node => [node, ...node.children.flatMap(walk)];
  const find = predicate => walk(body).find(predicate);
  const click = text => { const node = find(node => node.tagName === 'BUTTON' && node.textContent === text); assert.ok(node, 'Missing button: ' + text); return node.events.click(); };
  return { help, context, click, find, guide: find(node => node.tagName === 'DIALOG'), audio: find(node => node.tagName === 'AUDIO') };
}

test('only step one offers Listen, using the chosen name or Vikki, without automatic playback', t => {
  const f = fixture(t); f.help.openGuide({ auto: true });
  assert.ok(f.find(node => node.textContent === 'Listen to Vikki')); assert.equal(f.audio.plays, 0);
  for (let step = 2; step <= 4; step++) {
    f.click('Next');
    assert.equal(f.find(node => node.tagName === 'BUTTON' && /^Listen to /.test(node.textContent)), undefined);
  }
});

test('a long recording remains connected and playing while navigating all four steps', t => {
  const f = fixture(t, { companion: 'Freddie' }); f.help.openGuide(); f.click('Listen to Freddie');
  const parent = f.audio.parentElement; f.audio.currentTime = 130;
  for (let step = 2; step <= 4; step++) {
    f.click('Next'); assert.equal(f.audio.parentElement, parent); assert.equal(parent.parentElement, f.guide);
    assert.equal(f.audio.paused, false); assert.equal(f.audio.currentTime, 130); assert.equal(f.audio.plays, 1);
  }
  f.click('Back'); assert.equal(f.audio.paused, false);
});

test('Help replay starts step one and restarts audio even when optional profile setup is incomplete', async t => {
  const f = fixture(t, { companion: 'Andy', profileReady: false });
  assert.equal(f.help.openGuide({ auto: true }), false);
  f.help.openHelp(); f.click('Replay the introduction');
  assert.equal(f.guide.open, true); assert.equal(f.audio.plays, 1); assert.equal(f.audio.currentTime, 0);
  assert.equal(f.audio.attributes['aria-label'], 'Andy introduction audio');
  f.audio.currentTime = 160; f.click('Close'); await Promise.resolve(); await Promise.resolve();
  f.click('Replay the introduction');
  assert.equal(f.audio.currentTime, 0); assert.equal(f.audio.plays, 2); assert.equal(f.audio.paused, false);
});

test('playback failure gives visible retry guidance instead of failing silently', async t => {
  const f = fixture(t); f.help.openGuide(); f.audio.fail = true; f.click('Listen to Vikki'); await Promise.resolve();
  const status = f.find(node => node.attributes.role === 'status' && /could not start/.test(node.textContent));
  assert.ok(status); assert.equal(status.hidden, false); assert.equal(f.audio.parentElement.hidden, false);
});
