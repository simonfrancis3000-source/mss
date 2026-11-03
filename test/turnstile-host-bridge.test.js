import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const HTML = new URL("../public/turnstile-bridge.html", import.meta.url);
const NONCE = "0123456789abcdef0123456789abcdef";

async function harness() {
  const html = await readFile(HTML, "utf8");
  const script = html.split("<script>")[1]?.split("</script>")[0];
  assert.ok(script, "the hosted page has a token bridge");
  const callbacks = {};
  const posted = [];
  const listeners = new Map();
  const parent = { postMessage(data, targetOrigin) { posted.push({data,targetOrigin}); } };
  const status = {textContent:""};
  const turnstile = {
    render(_target, settings) { Object.assign(callbacks, settings); return "bridge-widget"; },
    reset(_id) { callbacks.resetCount = (callbacks.resetCount || 0) + 1; }
  };
  const child = {parent,turnstile,addEventListener(type, fn) {listeners.set(type,fn)}};
  const document = {
    getElementById(id) { return id === "status" ? status : {}; },
    createElement() { return { src:"", async:false, onload:null, onerror:null}; },
    head: { appendChild(el) { el.onload(); } }
  };
  vm.runInNewContext(script, {window:child,document,location:{hash:"#nonce="+NONCE},URLSearchParams,Set,Promise,Error});
  function send(type,origin="http://localhost",nonce=NONCE,source=parent) {
    listeners.get("message")({origin,source,data:{type,nonce}});
  }
  await Promise.resolve();
  return {send,posted,callbacks,status};
}

test("Only the local native app may initialize the hosted challenge", async () => {
  const h=await harness();
  h.send("mss-turnstile:init","https://attacker.example");
  h.send("mss-turnstile:init","http://localhost","badnonce");
  assert.equal(h.posted.length,0);
  h.send("mss-turnstile:init");
  await new Promise(setImmediate);
  assert.equal(h.posted[0].data.type,"mss-turnstile:ready");
  assert.equal(h.posted[0].targetOrigin,"http://localhost");
  h.callbacks.callback("safe-token");
  assert.equal(h.posted.at(-1).data.token,"safe-token");
  assert.equal(h.posted.at(-1).data.nonce,NONCE);
  h.send("mss-turnstile:reset");
  assert.equal(h.callbacks.resetCount,1);
});

test("Hosted challenge rejects reset requests from untrusted origins", async()=>{
  const h=await harness();
  h.send("mss-turnstile:init");
  await new Promise(setImmediate);
  h.send("mss-turnstile:reset","https://attacker.example");
  h.send("mss-turnstile:reset","http://localhost","badnonce");
  assert.equal(h.callbacks.resetCount || 0,0);
});
