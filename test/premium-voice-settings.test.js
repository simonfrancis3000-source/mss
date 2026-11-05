import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../src/mss-interface.js', import.meta.url),'utf8');

test('Premium & Voice Minutes is first in the Profile Settings menu', () => {
  const first = ui.indexOf("settings.append(linkCard('Premium & Voice Minutes'");
  const help = ui.indexOf("linkCard('Help & Getting Started'", first);
  const voice = ui.indexOf("linkCard('Voice settings'", first);
  assert.ok(first >= 0, 'Premium & Voice Minutes option must exist');
  assert.ok(help > first, 'Premium & Voice Minutes appears above Help & Getting Started');
  assert.ok(voice > help, 'existing Voice settings shortcut is preserved');
});

test('the Premium shortcut opens existing live membership and minutes balances', () => {
  assert.match(ui, /balance\.id = 'mss-premium-voice-balance'/);
  assert.match(ui, /balance\.scrollIntoView\(\{ block: 'start', behavior: 'smooth' \}\)/);
  assert.match(ui, /balance\.focus\(\{ preventScroll: true \}\)/);
  assert.match(ui, /'Subscription and voice minutes'/);
  assert.match(ui, /'Membership & voice minutes'/);
});