import test from "node:test";
import assert from "node:assert/strict";
import { createPhonicVoiceConversation, voiceFailureMessage, createFloat32Resampler, firstAudibleSample, lastAudibleSample } from "../src/phonic-voice.js";

function browser(t, { getUserMedia, inputSampleRate = 44100 } = {}) {
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
  const audioSources = [];
  const contexts = [];
  class AudioContext {
    constructor() { contexts.push(this); }
    state = "running";
    sampleRate = inputSampleRate;
    currentTime = 0;
    destination = {};
    audioWorklet = { addModule: async () => {} };
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createBuffer(channels, length, rate) { const data = new Float32Array(length); return { duration:length/rate, getChannelData:()=>data }; }
    createBufferSource() {
      const source = { buffer:null, connect(){}, disconnect(){}, start(time){this.startAt=time;}, stop(){this.stopped=true;} };
      audioSources.push(source);return source;
    }
    createDynamicsCompressor() { return { threshold:{}, knee:{}, ratio:{}, attack:{}, release:{}, connect(){}, disconnect(){} }; }
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
  return { conversation, events, tracks, stream, nodes, Socket, audioSources, contexts };
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

test("16 kHz microphone blocks are split into provider-safe packets without inserted silence", async (t) => {
  const { conversation, nodes, Socket } = browser(t, { inputSampleRate:16000 });
  const starting = conversation.start();
  const socket = await waitForSocket(Socket);
  socket.open(); socket.message({type:"ready_to_start_conversation"});
  await starting;
  nodes[0].port.onmessage({data:{type:"audio-recording-chunk",buffer:new Float32Array(1024).fill(0.5)}});
  const packets=socket.sent.filter(message=>message.type==="audio_chunk");
  assert.ok(packets.length>=4);
  for(const packet of packets){
    const bytes=Buffer.from(packet.audio,'base64');
    assert.ok(bytes.length/2/44100*1000<=20);
    for(let index=0;index<bytes.length;index+=2)assert.ok(bytes.readInt16LE(index)>15000);
  }
});

test("streaming resampling preserves duration and continuity across source rates",()=>{
  for(const rate of [16000,44100,48000]){
    const resample=createFloat32Resampler(rate);
    let frames=0;
    for(let index=0;index<20;index++){
      const output=resample(new Float32Array(1024).fill(0.5));
      frames+=output.length;
      assert.ok(output.every(sample=>sample===0.5));
    }
    const expected=(20*1024-(rate===44100?0:1))*44100/rate;
    assert.ok(Math.abs(frames-expected)<=1,rate+": incorrect resampled duration");
  }
});


function pcmAudio(length=4410){return Buffer.from(new Int16Array(length).fill(1200).buffer).toString('base64');}

test('input timeout uses a helpful message without a technical error code',()=>{
  const message=voiceFailureMessage('The voice service closed the connection (4500): Input was not received in time');
  assert.match(message,/Press Start to continue/); assert.doesNotMatch(message,/4500|failed/i);
});

test('speaking indicator ends before a long silent tail of a buffered audio chunk',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {conversation,Socket,audioSources,contexts,events}=browser(t);
  const starting=conversation.start(); const socket=await waitForSocket(Socket); socket.open();socket.message({type:'ready_to_start_conversation'});await starting;
  const pcm=new Int16Array(44100*3);pcm.fill(1200,0,4410);
  assert.ok(lastAudibleSample(pcm)<pcm.length);
  socket.message({type:'audio_chunk',audio:Buffer.from(pcm.buffer).toString('base64')});
  socket.message({type:'assistant_finished_speaking'});
  contexts[1].currentTime=audioSources[0].startAt+.05;t.mock.timers.tick(20);
  assert.equal(events.at(-1).type,'assistant_started_speaking');
  contexts[1].currentTime=audioSources[0].startAt+1;t.mock.timers.tick(20);
  assert.equal(events.at(-1).type,'assistant_awaiting_user');
  await conversation.stop();
});

test("sentence gaps are scheduled into playback and speaking finishes only after audio drains",async(t)=>{
 const {conversation,Socket,audioSources,events,contexts}=browser(t);
 const starting=conversation.start();const socket=await waitForSocket(Socket);socket.open();socket.message({type:'ready_to_start_conversation'});await starting;
 socket.message({type:'assistant_started_speaking'});
 const sentencePcm=new Int16Array(4410).fill(1200);sentencePcm.fill(0,4410-882);
 socket.message({type:'audio_chunk',text:'Understood.',audio:Buffer.from(sentencePcm.buffer).toString('base64')});
 socket.message({type:'audio_chunk',text:'How would you like',audio:pcmAudio()});
 socket.message({type:'audio_chunk',text:' me to handle it?',audio:pcmAudio()});
 assert.equal(audioSources.length,3);
 assert.ok(Math.abs(audioSources[1].startAt-(audioSources[0].startAt+.08)-.42)<1e-8);
 assert.ok(Math.abs(audioSources[2].startAt-(audioSources[1].startAt+.1))<1e-8);
 socket.message({type:'assistant_finished_speaking'});
 assert.equal(events.filter(e=>e.type==='assistant_finished_speaking').length,0);
 contexts[1].currentTime=audioSources[0].startAt+.01;
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(events.filter(e=>e.type==='assistant_started_speaking').length,1);
 audioSources[0].onended();audioSources[1].onended();
 assert.equal(events.filter(e=>e.type==='assistant_finished_speaking').length,0);
 audioSources[2].onended();
 assert.equal(events.filter(e=>e.type==='assistant_finished_speaking').length,1);
});

test('a short jitter buffer keeps late-arriving continuous packets joined without dropping samples',async(t)=>{
 const {conversation,Socket,audioSources,contexts}=browser(t);
 const starting=conversation.start();const socket=await waitForSocket(Socket);socket.open();socket.message({type:'ready_to_start_conversation'});await starting;
 socket.message({type:'assistant_started_speaking'});
 socket.message({type:'audio_chunk',text:'Keep this',audio:pcmAudio()});
 assert.equal(audioSources[0].startAt,.08);
 const end=audioSources[0].startAt+audioSources[0].buffer.duration;
 contexts[1].currentTime=end-.005;
 socket.message({type:'audio_chunk',text:' sentence continuous.',audio:pcmAudio()});
 assert.equal(audioSources[1].startAt,end);
 assert.equal(audioSources[1].buffer.getChannelData(0).length,4410);
 assert.ok(audioSources[1].buffer.getChannelData(0).every(value=>value===1200/32768));
 contexts[1].currentTime=1;
 socket.message({type:'audio_chunk',text:'A new packet',audio:pcmAudio()});
 assert.equal(audioSources[2].startAt,1.08);
 await conversation.stop();
});

test("interrupting speech cancels queued pauses and stale playback callbacks",async(t)=>{
 const {conversation,Socket,audioSources,events}=browser(t);
 const starting=conversation.start();const socket=await waitForSocket(Socket);socket.open();socket.message({type:'ready_to_start_conversation'});await starting;
 socket.message({type:'assistant_started_speaking'});
 socket.message({type:'audio_chunk',text:'Understood.',audio:pcmAudio()});
 socket.message({type:'audio_chunk',text:'What next?',audio:pcmAudio()});
 socket.message({type:'assistant_finished_speaking'});
 socket.message({type:'user_started_speaking'});
 assert.ok(audioSources.every(source=>source.stopped));
 audioSources.forEach(source=>source.onended());
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(events.filter(e=>e.type==='assistant_started_speaking').length,0);
 assert.equal(events.filter(e=>e.type==='assistant_finished_speaking').length,0);
 socket.message({type:'audio_chunk',text:'Late audio.',audio:pcmAudio()});
 assert.equal(audioSources.length,2);
});


test("silent PCM and provider generation signals never announce speaking before audible playback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { conversation, Socket, audioSources, contexts, events } = browser(t);
  const starting = conversation.start();
  const socket = await waitForSocket(Socket);
  socket.open(); socket.message({ type: "ready_to_start_conversation" }); await starting;
  socket.message({ type: "user_finished_speaking" });
  socket.message({ type: "assistant_started_speaking" });
  const pcm = new Int16Array(44100 * 3);
  pcm.fill(1200, 44100 * 2);
  socket.message({ type: "audio_chunk", audio: Buffer.from(pcm.buffer).toString("base64") });
  const playback = contexts[1];
  playback.currentTime = audioSources[0].startAt + 1.9;
  t.mock.timers.tick(2000);
  assert.equal(events.filter(e => e.type === "assistant_started_speaking").length, 0);
  playback.currentTime = audioSources[0].startAt + 2.01;
  t.mock.timers.tick(20);
  assert.equal(events.filter(e => e.type === "assistant_started_speaking").length, 1);
  socket.message({ type: "assistant_finished_speaking" });
  assert.equal(events.filter(e => e.type === "assistant_finished_speaking").length, 0);
  audioSources[0].onended();
  assert.equal(events.filter(e => e.type === "assistant_finished_speaking").length, 1);
});

test("queued speech waits for a running audio clock and returns to thinking during a stream stall", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { conversation, Socket, audioSources, contexts, events } = browser(t);
  const starting = conversation.start();
  const socket = await waitForSocket(Socket);
  socket.open(); socket.message({ type: "ready_to_start_conversation" }); await starting;
  socket.message({ type: "audio_chunk", audio: pcmAudio() });
  const playback = contexts[1];
  playback.state = "suspended";
  playback.currentTime = audioSources[0].startAt + .01;
  t.mock.timers.tick(3000);
  assert.equal(events.filter(e => e.type === "assistant_started_speaking").length, 0);
  playback.state = "running";
  t.mock.timers.tick(20);
  assert.equal(events.filter(e => e.type === "assistant_started_speaking").length, 1);
  playback.state = "suspended";
  t.mock.timers.tick(20);
  assert.equal(events.at(-1).type, "assistant_waiting_for_audio");
  playback.state = "running";
  t.mock.timers.tick(20);
  assert.equal(events.at(-1).type, "assistant_started_speaking");
  playback.currentTime = audioSources[0].startAt + .1;
  audioSources[0].onended();
  assert.equal(events.at(-1).type, "assistant_waiting_for_audio");
  socket.message({ type: "audio_chunk", audio: pcmAudio() });
  assert.equal(events.at(-1).type, "audio_chunk");
  playback.currentTime = audioSources[1].startAt + .01;
  t.mock.timers.tick(20);
  assert.equal(events.at(-1).type, "assistant_started_speaking");
  await conversation.stop();
  const count = events.length;
  t.mock.timers.tick(3000);
  audioSources[1].onended();
  assert.equal(events.length, count);
});

test("silent and very quiet lead-in packets have no audible onset", () => {
  assert.equal(firstAudibleSample(new Int16Array(4410)), -1);
  assert.equal(firstAudibleSample(new Int16Array(4410).fill(20)), -1);
  const pcm = new Int16Array(8820);
  pcm.fill(1200, 4410);
  assert.equal(firstAudibleSample(pcm), 4410);
});

 test('a question returns to waiting after audible output even if provider completion is late',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {conversation,Socket,audioSources,contexts,events}=browser(t);
  const starting=conversation.start();const socket=await waitForSocket(Socket);socket.open();socket.message({type:'ready_to_start_conversation'});await starting;
  socket.message({type:'assistant_started_speaking'});
  socket.message({type:'audio_chunk',text:'Where should I put your papers?',audio:pcmAudio()});
  contexts[1].currentTime=audioSources[0].startAt+.01;t.mock.timers.tick(20);
  assert.equal(events.at(-1).type,'assistant_started_speaking');
  contexts[1].currentTime=audioSources[0].startAt+.11;audioSources[0].onended();
  assert.equal(events.at(-1).type,'assistant_awaiting_user');
  socket.message({type:'assistant_finished_speaking'});
  assert.equal(events.at(-1).type,'assistant_finished_speaking');
  await conversation.stop();
 });
 test('a buffered future sentence prevents an early waiting status during a speech pause',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {conversation,Socket,audioSources,contexts,events}=browser(t);
  const starting=conversation.start();const socket=await waitForSocket(Socket);socket.open();socket.message({type:'ready_to_start_conversation'});await starting;
  socket.message({type:'audio_chunk',text:'Understood.',audio:pcmAudio()});
  socket.message({type:'audio_chunk',text:'Where should I put them?',audio:pcmAudio()});
  socket.message({type:'assistant_finished_speaking'});
  contexts[1].currentTime=audioSources[0].startAt+.01;t.mock.timers.tick(20);
  contexts[1].currentTime=audioSources[0].startAt+.11;audioSources[0].onended();
  assert.equal(events.some(event=>event.type==='assistant_awaiting_user'),false);
  await conversation.stop();
 });
