import test from "node:test";
import assert from "node:assert/strict";
import { createPhonicVoiceConversation, voiceFailureMessage } from "../src/phonic-voice.js";

function browser(t, { getUserMedia } = {}) {
  const originals = new Map();
  function install(key, value) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  const stream = { getTracks: () => tracks };
  const nodes = [];
  class AudioContext {
    sampleRate = 44100;
    currentTime = 0;
    destination = {};
    audioWorklet = { addModule: async () => {} };
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
    async resume() {}
    async close() {}
  }
  class Worklet {
    port = { postMessage() {} };
    constructor() { nodes.push(this); }
    connect() {}
    disconnect() {}
  }
  class Socket extends EventTarget {
    static OPEN = 1;
    static CONNECTING = 0;
    static instances = [];
    readyState = 0;
    sent = [];
    constructor() { super(); Socket.instances.push(this); }
    send(text) { this.sent.push(JSON.parse(text)); }
    open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
    message(value) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
    close(code = 1000, reason = "") {
      this.readyState = 3;
      const event = new Event("close");
      Object.assign(event, { code, reason });
      this.dispatchEvent(event);
    }
  }
  install("window", { AudioContext, setTimeout, clearTimeout });
  install("navigator", { mediaDevices: { getUserMedia: getUserMedia || (async () => stream) } });
  install("AudioWorkletNode", Worklet);
  install("WebSocket", Socket);
  const events = [];
  const conversation = createPhonicVoiceConversation({
    getSession: async () => ({ sessionToken: "test-token" }),
    getConfig: () => ({ type: "config", voice_id: "grant" }),
    onEvent: (event) => events.push(event)
  });
  t.after(() => conversation.stop());
  return { conversation, events, tracks, stream, nodes, Socket };
}

async function waitForSocket(Socket) {
  for (let i = 0; i < 20 && !Socket.instances.length; i += 1) await new Promise(setImmediate);
  assert.equal(Socket.instances.length, 1);
  return Socket.instances[0];
}

test("voice waits for provider readiness before resolving startup or sending microphone audio", async (t) => {
  const { conversation, events, nodes, Socket, tracks } = browser(t);
  let started = false;
  const starting = conversation.start().then(() => { started = true; });
  const socket = await waitForSocket(Socket);
  socket.open();
  nodes[0].port.onmessage({ data: { type: "audio-recording-chunk", buffer: new Float32Array([0.1]) } });
  await Promise.resolve();
  assert.equal(started, false);
  assert.deepEqual(socket.sent, [{ type: "config", voice_id: "grant" }]);
  socket.message({ type: "ready_to_start_conversation" });
  await starting;
  nodes[0].port.onmessage({ data: { type: "audio-recording-chunk", buffer: new Float32Array([0.1]) } });
  assert.equal(socket.sent[1].type, "audio_chunk");
  await conversation.stop();
  assert.equal(tracks[0].stopped, true);
  assert.deepEqual(events.map((event) => event.type), ["open", "ready"]);
});

test("provider config rejection includes the actual parameter error and cleans up microphone", async (t) => {
  const { conversation, events, tracks, Socket } = browser(t);
  const starting = conversation.start();
  const rejection = assert.rejects(starting, /Invalid config.*voice_id: Unknown voice/);
  const socket = await waitForSocket(Socket);
  socket.open();
  socket.message({ type: "error", error: { message: "Invalid config" }, param_errors: { voice_id: "Unknown voice" } });
  await rejection;
  assert.equal(tracks[0].stopped, true);
  assert.deepEqual(events.map((event) => event.type), ["open"]);
});

test("a socket closing before readiness rejects startup with its reason", async (t) => {
  const { conversation, Socket } = browser(t);
  const starting = conversation.start();
  const rejection = assert.rejects(starting, /4001.*Session expired/);
  const socket = await waitForSocket(Socket);
  socket.open();
  socket.close(4001, "Session expired");
  await rejection;
});

test("stopping during pending startup cancels without emitting an interruption", async (t) => {
  const { conversation, events, Socket } = browser(t);
  const starting = conversation.start();
  const rejection = assert.rejects(starting, /was stopped/);
  const socket = await waitForSocket(Socket);
  socket.open();
  await conversation.stop();
  await rejection;
  socket.message({ type: "ready_to_start_conversation" });
  assert.deepEqual(events.map((event) => event.type), ["open"]);
});

test("microphone permission granted after cancellation still releases its track", async (t) => {
  let grant;
  const pending = new Promise((resolve) => { grant = resolve; });
  const { conversation, stream, tracks, Socket } = browser(t, { getUserMedia: () => pending });
  const starting = conversation.start();
  const rejection = assert.rejects(starting, /was stopped/);
  await conversation.stop();
  grant(stream);
  await rejection;
  assert.equal(tracks[0].stopped, true);
  assert.equal(Socket.instances.length, 0);
});

test("voice failures keep useful details and redact session credentials", () => {
  assert.match(voiceFailureMessage("Invalid config: tools"), /Invalid config: tools/);
  assert.match(voiceFailureMessage("Insufficient credits"), /billing limit/);
  assert.match(voiceFailureMessage("Unknown voice_id"), /selected voice is unavailable/);
  const safe = voiceFailureMessage("wss://api.phonic.ai/?session_token=secret Bearer private ph_session_hidden");
  assert.doesNotMatch(safe, /secret|private|ph_session_hidden/);
});
