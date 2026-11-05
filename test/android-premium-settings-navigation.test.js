import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui=readFileSync(new URL('../src/mss-interface.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/synqme.js',import.meta.url),'utf8');
const checkout=readFileSync(new URL('../src/google-play-checkout.js',import.meta.url),'utf8');

test('Premium & Voice Minutes opens existing native Google Play purchase screen',()=>{
 assert.match(ui,/linkCard\('Premium & Voice Minutes'[^;\n]*openBilling\)/);
 assert.match(app,/openBilling:\s*googlePlayCheckout\.enabled\s*\?\s*\(\)\s*=>\s*googlePlayCheckout\.open\(\)/);
 assert.match(checkout,/MSSBilling\.startVoiceTopUpPurchase/);
 assert.match(checkout,/MSSBilling\.startSubscriptionPurchase/);
 assert.match(checkout,/Restore purchases/);
});

test('Voice Settings is the third item and all existing options remain',()=>{
 const premium=ui.indexOf("settings.append(linkCard('Premium & Voice Minutes'");
 const help=ui.indexOf("settings.append(linkCard('Help & Getting Started'",premium);
 const voice=ui.indexOf("linkCard('Voice Settings'",help);
 const reminders=ui.indexOf("linkCard('Reminders'",voice);
 const privacy=ui.indexOf("linkCard('Privacy'",reminders);
 assert.ok(premium>0 && help>premium && voice>help && reminders>voice && privacy>reminders);
});

test('Voice Minutes balance has Buy to left of Refresh and uses native checkout',()=>{
 assert.match(ui,/el\('h2','','Voice Minutes'\)/);
 assert.match(ui,/const buy = action\('Buy','mss-balance-buy',openBilling\)/);
 const actionsStart=ui.indexOf("const balanceActions = el('div','mss-balance-actions')");
 const buy=ui.indexOf("balanceActions.append(buy)",actionsStart);
 const refresh=ui.indexOf("balanceActions.append(refresh)",buy);
 assert.ok(actionsStart>0 && buy>actionsStart && refresh>buy);
 assert.doesNotMatch(ui,/balance\.scrollIntoView/);
});
