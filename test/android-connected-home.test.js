import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const get = relative => readFileSync(new URL('../'+relative,import.meta.url),'utf8');
const ui=get('src/mss-interface.js');
const app=get('src/synqme.js');
const feature=get('src/connected-home.js');
const activity=get('android/app/src/main/java/app/mysecondself/MainActivity.java');
const native=get('android/app/src/main/java/app/mysecondself/MSSSmartThingsPlugin.java');
const manifest=get('android/app/src/main/AndroidManifest.xml');

test('Android Connected Home sits after Reminders and before Privacy, matching the web menu',()=>{
  const premium=ui.indexOf("linkCard('Premium & Voice Minutes'");
  const help=ui.indexOf("linkCard('Help & Getting Started'");
  const voice=ui.indexOf("linkCard('Voice Settings'");
  const reminders=ui.indexOf("linkCard('Reminders'");
  const connected=ui.indexOf("linkCard('Connected Home'");
  const privacy=ui.indexOf("linkCard('Privacy'");
  assert.ok([premium,help,voice,reminders,connected,privacy].every(i=>i>=0));
  assert.ok(premium<help&&help<voice&&voice<reminders&&reminders<connected&&connected<privacy);
  assert.match(ui,/openConnectedHome\?\.\(\)/);
  assert.match(app,/import \{ createConnectedHome \} from "\.\/connected-home\.js";/);
  assert.match(app,/openConnectedHome: \(\) => connectedHome\.open\(\)/);
});

test('Android SmartThings uses external browser, never embedded WebView',()=>{
  assert.match(feature,/smartThingsBridge\.openAuthorization\(\{url:url\.toString\(\)\}\)/);
  assert.match(feature,/X-MSS-Connected-Home-Client/);
  assert.match(feature,/window\.addEventListener\("focus"/);
  assert.match(feature,/document\.addEventListener\("visibilitychange"/);
  assert.match(native,/Intent\.ACTION_VIEW/);
  assert.match(native,/api\.smartthings\.com/);
  assert.match(native,/\/v1\/oauth\/authorize/);
  assert.match(native,/https/);
  assert.match(native,/consumeRedirect/);
});

test('Android accepts only the MSS SmartThings return address',()=>{
  assert.match(manifest,/android:scheme="app\.mysecondself"/);
  assert.match(manifest,/android:host="connected-home"/);
  assert.match(activity,/registerPlugin\(MSSSmartThingsPlugin\.class\)/);
  assert.match(activity,/protected void onNewIntent\(Intent intent\)/);
  assert.match(activity,/setIntent\(intent\)/);
  assert.match(native,/"connected-home"\.equals\(data\.getHost\(\)\)/);
  assert.match(native,/intent\.setData\(null\)/);
});

test('Android Connected Home remains read-only',()=>{
  assert.match(feature,/Read-only connection/);
  assert.match(feature,/cannot control them/);
  assert.match(feature,/Refresh Devices/);
  assert.match(feature,/Disconnect/);
  assert.doesNotMatch(feature,/smartthings\/command/);
});
