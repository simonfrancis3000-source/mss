import { createSentencePausePlanner } from "./sentence-pause.js";
import { Capacitor } from "@capacitor/core";
// Real-time browser voice adapter for Phonic's Speech-to-Speech WebSocket.
// Adapted from Phonic-Co/phonic-web-demo (MIT): https://github.com/Phonic-Co/phonic-web-demo

const DEFAULT_WS_URL = "wss://api.phonic.ai/v1/sts/ws";
const SAMPLE_RATE = 44100;
const MICROPHONE_PACKET_SAMPLES = Math.floor(SAMPLE_RATE * 0.02);

// Provider errors can contain a token-bearing URL. Keep useful validation
// details while ensuring credentials never reach a status label or console.
export function voiceFailureMessage(value) {
  const detail = String(value?.message || value || "The voice service disconnected.")
    .replace(/https?:\/\/\S+|wss?:\/\/\S+/gi, "[connection]")
    .replace(/\b(?:ph_session_|ph_sk_|sk-)[A-Za-z0-9_.-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[\r\n\t]+/g, " ").slice(0, 350);
  if (/microphone|NotAllowedError|permission.*(?:microphone|denied)/i.test(detail)) {
    if (Capacitor.isNativePlatform()) {
      return "Microphone access is needed to speak with your robot. Allow access when your phone asks. If you previously denied it, enable Microphone in your phone Settings > Apps > MySecondSelf > Permissions.";
    }
    return "Microphone access is needed to start a voice conversation. Allow it in your browser settings, then try again.";
  }
  if (/credit|balance|billing|quota/i.test(detail)) return "The voice service has reached its account or billing limit. Text chat is still available.";
  if (/voice_id|(?:unknown|invalid|unsupported) voice/i.test(detail)) return "The selected voice is unavailable. " + detail;
  if (/timed out|timeout/i.test(detail)) return "The voice service did not become ready in time. Please try again.";
  return "Voice connection failed: " + detail;
}

export function createFloat32Resampler(inputRate, outputRate = SAMPLE_RATE) {
  const ratio = inputRate / outputRate;
  let tail = new Float32Array(0);
  let position = 0;
  return (input) => {
    if (inputRate === outputRate) return input.slice();
    const samples = new Float32Array(tail.length + input.length);
    samples.set(tail); samples.set(input, tail.length);
    const output = [];
    // Keep fractional position and the last source sample across worklet
    // messages. Upsampling low-rate microphones must not insert silence.
    while (position < samples.length - 1) {
      const index = Math.floor(position);
      const fraction = position - index;
      output.push(samples[index] + (samples[index + 1] - samples[index]) * fraction);
      position += ratio;
    }
    const consumed = Math.min(Math.floor(position), Math.max(0, samples.length - 1));
    tail = samples.slice(consumed);
    position -= consumed;
    return Float32Array.from(output);
  };
}

function floatToInt16(input) {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function int16ToBase64(data) {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToInt16Array(base64) {
  const binary = atob(base64);
  const byteLength = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Int16Array(bytes.buffer);
}

// Ignore silent lead-in packets when deciding whether speech is playing.
export function firstAudibleSample(pcm, sampleRate = SAMPLE_RATE) {
  const windowSize = Math.max(1, Math.round(sampleRate * 0.01));
  for (let offset = 0; offset < pcm.length; offset += windowSize) {
    const end = Math.min(pcm.length, offset + windowSize);
    let energy = 0;
    for (let index = offset; index < end; index += 1) energy += (pcm[index] / 32768) ** 2;
    if (Math.sqrt(energy / (end - offset)) >= 0.003) return offset;
  }
  return -1;
}

export function createPhonicVoiceConversation({ getSession, getConfig, onEvent = () => {}, onToolCall = async () => ({ status: "error", assistant_text: "I’m having trouble preparing a response right now. Please try again in a moment." }) }) {
  let socket = null;
  let microphoneStream = null;
  let microphoneContext = null;
  let microphoneSource = null;
  let microphoneNode = null;
  let silentGain = null;
  let playbackContext = null;
  let playbackGain = null;
  let playbackLimiter = null;
  let playbackSources = new Set();
  const playbackTimings = new Map();
  let nextPlaybackTime = 0;
  const sentencePauses = createSentencePausePlanner(SAMPLE_RATE);
  let providerFinishedSpeaking = false;
  let playbackActive = false;
  let playbackMonitorTimer = null;
  let playbackGeneration = 0;
  let stopped = true;
  let muted = false;
  let conversationItems = [];
  let nextItemIndex = 0;
  let userIsSpeaking = false;
  let startNewAssistantItem = false;
  let ready = false;
  let resolveStartup = null;
  let rejectStartup = null;

  function emit(event) {
    try {
      onEvent({ ...event, items: conversationItems.map((item) => ({ ...item })) });
    } catch (error) {
      console.error("SYNQ.ME could not process a Phonic voice event.", error);
    }
  }

  function finishPlaybackIfDrained() {
    if (!providerFinishedSpeaking || playbackSources.size || userIsSpeaking) return;
    providerFinishedSpeaking = false;
    playbackActive = false;
    sentencePauses.reset();
    if (playbackMonitorTimer !== null) globalThis.clearTimeout(playbackMonitorTimer);
    playbackMonitorTimer = null;
    emit({ type: "assistant_finished_speaking" });
  }

  // Provider generation events precede speaker output. Watch the audio clock,
  // including suspended contexts, rather than treating receipt as playback.
  function monitorPlayback() {
    if (playbackMonitorTimer !== null) globalThis.clearTimeout(playbackMonitorTimer);
    playbackMonitorTimer = null;
    if (stopped || !playbackContext || userIsSpeaking) return;
    const running = playbackContext.state === "running";
    const now = playbackContext.currentTime;
    const audible = running && [...playbackTimings.values()].some(({ audibleAt, endsAt }) =>
      audibleAt !== null && now >= audibleAt && now < endsAt);
    if (!playbackActive && audible) {
      playbackActive = true;
      emit({ type: "assistant_started_speaking" });
    } else if (playbackActive && (!running || !playbackSources.size)) {
      playbackActive = false;
      if (!providerFinishedSpeaking) emit({ type: "assistant_waiting_for_audio" });
    }
    finishPlaybackIfDrained();
    if (playbackSources.size) playbackMonitorTimer = globalThis.setTimeout(monitorPlayback, 20);
  }

  function stopPlayback() {
    playbackGeneration++;
    providerFinishedSpeaking = false;
    playbackActive = false;
    sentencePauses.reset();
    if (playbackMonitorTimer !== null) globalThis.clearTimeout(playbackMonitorTimer);
    playbackMonitorTimer = null;
    const sources = [...playbackSources];
    playbackSources.clear();
    playbackTimings.clear();
    for (const source of sources) {
      try { source.stop(); } catch {}
    }
    nextPlaybackTime = playbackContext ? playbackContext.currentTime : 0;
  }

  function playAudioChunk(base64Audio, text = "") {
    if (stopped || userIsSpeaking || !playbackContext || !base64Audio) return;
    const pcm = base64ToInt16Array(base64Audio);
    if (!pcm.length) return;

    const buffer = playbackContext.createBuffer(1, pcm.length, SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < pcm.length; index += 1) {
      channel[index] = pcm[index] / 32768;
    }

    const source = playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(playbackGain);
    const baseStart = Math.max(playbackContext.currentTime + 0.015, nextPlaybackTime);
    const elapsedGap = Math.max(0, baseStart - nextPlaybackTime);
    const startAt = baseStart + sentencePauses.gapBefore(pcm, text, elapsedGap);
    nextPlaybackTime = startAt + buffer.duration;
    playbackSources.add(source);
    const sourceGeneration = playbackGeneration;
    const firstAudible = firstAudibleSample(pcm);
    playbackTimings.set(source, {
      audibleAt: firstAudible < 0 ? null : startAt + firstAudible / SAMPLE_RATE,
      endsAt: nextPlaybackTime
    });
    source.onended = () => {
      if (sourceGeneration !== playbackGeneration) { try { source.disconnect(); } catch {} return; }
      playbackSources.delete(source);
      playbackTimings.delete(source);
      try { source.disconnect(); } catch {}
      monitorPlayback();
    };
    source.start(startAt);
    monitorPlayback();
  }

  async function handleToolCall(message) {
    const toolCallId = String(message?.tool_call_id || "");
    if (!toolCallId) return;

    const activeSocket = socket;
    let output;
    try {
      output = await onToolCall({
        name: String(message.tool_name || ""),
        parameters: message.parameters && typeof message.parameters === "object" ? message.parameters : {},
        items: conversationItems.map((item) => ({ ...item }))
      });
    } catch (error) {
      console.error("SYNQ.ME AMÏA tool call failed.", error);
      output = {
        status: "error",
        assistant_text: "I’m having trouble preparing a response right now. Please try again in a moment."
      };
    }

    // A tool call may finish after the user ends the voice session. Never write
    // a late result to a closed or superseded socket.
    if (!activeSocket || activeSocket !== socket || activeSocket.readyState !== WebSocket.OPEN) return;
    const safeOutput = output && typeof output === "object"
      ? output
      : {
          status: "error",
          assistant_text: "I’m having trouble preparing a response right now. Please try again in a moment."
        };
    activeSocket.send(JSON.stringify({
      type: "tool_call_output",
      tool_call_id: toolCallId,
      output: safeOutput
    }));
  }

  function handleMessage(raw) {
    if (typeof raw !== "string") return;
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    switch (message.type) {
      case "ready_to_start_conversation":
        ready = true;
        resolveStartup?.();
        emit({ type: "ready" });
        break;

      case "input_text": {
        const text = typeof message.text === "string" ? message.text.trim() : "";
        if (!text) break;
        const last = conversationItems[conversationItems.length - 1];
        if (last && last.role === "user") {
          const prefix = last.text ? last.text + " " : "";
          conversationItems[conversationItems.length - 1] = { ...last, text: (prefix + text).trim() };
        } else {
          conversationItems.push({ itemIdx: nextItemIndex++, role: "user", text });
        }
        emit({ type: "input_text", text });
        break;
      }

      case "audio_chunk": {
        const text = typeof message.text === "string" ? message.text : "";
        if (text) {
          const last = conversationItems[conversationItems.length - 1];
          if (startNewAssistantItem || !last || last.role !== "assistant") {
            conversationItems.push({ itemIdx: nextItemIndex++, role: "assistant", text });
          } else {
            conversationItems[conversationItems.length - 1] = {
              ...last,
              text: (last.text || "") + text
            };
          }
          startNewAssistantItem = false;
        }
        if (typeof message.audio === "string") playAudioChunk(message.audio, text);
        emit({ type: "audio_chunk", audio: message.audio || "", text });
        break;
      }

      case "assistant_started_speaking":
        startNewAssistantItem = true;
        providerFinishedSpeaking = false;
        break;

      case "assistant_finished_speaking":
        if (userIsSpeaking) break;
        providerFinishedSpeaking = true;
        finishPlaybackIfDrained();
        break;

      case "user_started_speaking":
        if (!userIsSpeaking) {
          conversationItems.push({ itemIdx: nextItemIndex++, role: "user", text: null });
        }
        userIsSpeaking = true;
        stopPlayback();
        emit({ type: "user_started_speaking" });
        break;

      case "user_finished_speaking":
        userIsSpeaking = false;
        emit({ type: "user_finished_speaking" });
        break;

      case "input_cancelled": {
        const last = conversationItems[conversationItems.length - 1];
        if (last && last.role === "user" && last.text === null) conversationItems.pop();
        emit({ type: "input_cancelled" });
        break;
      }

      case "tool_call":
        if (!playbackActive && !userIsSpeaking) emit({ type: "assistant_waiting_for_audio" });
        void handleToolCall(message);
        break;

      case "error":
        {
          const fields = message.param_errors && typeof message.param_errors === "object"
            ? Object.entries(message.param_errors).map(([key, value]) => key + ": " + String(value)).join("; ")
            : "";
          const detail = [message.error?.message || message.message || "The voice service reported an error.", fields].filter(Boolean).join(" ");
          if (!ready) rejectStartup?.(new Error(detail));
          else emit({ type: "error", error: detail });
        }
        break;

      default:
        break;
    }
  }

  async function start() {
    if (!stopped) return;
    stopped = false;
    ready = false;
    conversationItems = [];
    nextItemIndex = 0;
    userIsSpeaking = false;
    startNewAssistantItem = false;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access is unavailable. Open SYNQ.ME in a current browser over HTTPS.");
      }
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("This browser does not support real-time audio.");

      // Ask for microphone permission directly as the voice experience starts.
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      if (stopped) throw new Error("Voice conversation was stopped.");

      microphoneContext = new AudioContextClass();
      const resample = createFloat32Resampler(microphoneContext.sampleRate);
      await microphoneContext.audioWorklet.addModule("/phonic-pcm-processor.worklet.js?v=2");
      microphoneSource = microphoneContext.createMediaStreamSource(microphoneStream);
      microphoneNode = new AudioWorkletNode(microphoneContext, "pcm-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1]
      });
      microphoneNode.port.onmessage = (event) => {
        if (stopped || event.data?.type !== "audio-recording-chunk") return;
        // Opening the transport is not confirmation that Phonic accepted the
        // config. Sending audio before readiness can race its initialization.
        if (!ready || !socket || socket.readyState !== WebSocket.OPEN) return;
        const input = event.data.buffer;
        if (!(input instanceof Float32Array)) return;
        const resampled = resample(input);
        const pcm = floatToInt16(resampled);
        if (!pcm.length) return;
        try {
          // Cap every wire message to 20 ms after resampling. This remains
          // valid even if an older cached worklet produces larger blocks.
          for (let offset = 0; offset < pcm.length; offset += MICROPHONE_PACKET_SAMPLES) {
            socket.send(JSON.stringify({ type: "audio_chunk", audio: int16ToBase64(pcm.subarray(offset, offset + MICROPHONE_PACKET_SAMPLES)) }));
          }
        } catch (error) {
          console.info("SYNQ.ME could not send a microphone chunk to Phonic.", error);
        }
      };
      microphoneSource.connect(microphoneNode);
      silentGain = microphoneContext.createGain();
      silentGain.gain.value = 0;
      microphoneNode.connect(silentGain);
      silentGain.connect(microphoneContext.destination);
      if (muted) microphoneNode.port.postMessage({ type: "mute" });
      await microphoneContext.resume();

      const session = await getSession();
      if (stopped) throw new Error("Voice conversation was stopped.");
      const sessionToken = session?.sessionToken || session?.session_token;
      if (!sessionToken) throw new Error("The SYNQ.ME backend did not return a Phonic session token.");

      playbackContext = new AudioContextClass();
      // Raise quiet speech by 6 dB and limit peaks before speaker output.
      playbackGain = playbackContext.createGain();
      playbackGain.gain.value = 2;
      playbackLimiter = playbackContext.createDynamicsCompressor();
      playbackLimiter.threshold.value = -3;
      playbackLimiter.knee.value = 0;
      playbackLimiter.ratio.value = 20;
      playbackLimiter.attack.value = 0.003;
      playbackLimiter.release.value = 0.12;
      playbackGain.connect(playbackLimiter);
      playbackLimiter.connect(playbackContext.destination);
      await playbackContext.resume();
      const wsBase = String(session.websocketUrl || session.wsUrl || DEFAULT_WS_URL);
      const separator = wsBase.includes("?") ? "&" : "?";
      socket = new WebSocket(wsBase + separator + "session_token=" + encodeURIComponent(sessionToken));
      const activeSocket = socket;
      activeSocket.addEventListener("message", (event) => {
        if (!stopped && activeSocket === socket) handleMessage(event.data);
      });

      await new Promise((resolve, reject) => {
        function finish(error) {
          window.clearTimeout(timeout);
          resolveStartup = null;
          rejectStartup = null;
          if (error) reject(error);
          else resolve();
        }
        const timeout = window.setTimeout(() => {
          finish(new Error("Timed out waiting for the voice service to accept the conversation settings."));
        }, 30000);
        resolveStartup = () => finish();
        rejectStartup = (error) => finish(error);

        activeSocket.addEventListener("open", () => {
          if (stopped) {
            finish(new Error("Voice conversation was stopped."));
            return;
          }
          try {
            const config = typeof getConfig === "function" ? getConfig(session) : getConfig;
            if (!config || config.type !== "config") throw new Error("The Phonic conversation configuration is invalid.");
            activeSocket.send(JSON.stringify(config));
            emit({ type: "open" });
          } catch (error) {
            finish(error);
          }
        }, { once: true });

        activeSocket.addEventListener("error", () => {
          if (stopped || activeSocket !== socket) return;
          const detail = "Could not reach the voice service. Check your connection and try again.";
          if (!ready) finish(new Error(detail));
          else emit({ type: "error", error: detail });
        });

        activeSocket.addEventListener("close", (event) => {
          if (stopped || activeSocket !== socket) return;
          const detail = "The voice service closed the connection (" + event.code + ")" + (event.reason ? ": " + event.reason : ".");
          if (!ready) finish(new Error(detail));
          else if (event.code !== 1000) emit({ type: "error", error: detail });
          else emit({ type: "close", code: event.code, reason: event.reason || "" });
        });
      });
    } catch (error) {
      await stop();
      throw error;
    }
  }

  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    if (microphoneNode) microphoneNode.port.postMessage({ type: muted ? "mute" : "unmute" });
  }

  async function stop() {
    // getUserMedia may finish after an earlier stop. Always release any
    // resources that arrived late rather than leaking the microphone track.
    stopped = true;
    ready = false;
    rejectStartup?.(new Error("Voice conversation was stopped."));
    stopPlayback();

    const activeSocket = socket;
    socket = null;
    if (activeSocket) {
      try {
        if (activeSocket.readyState === WebSocket.OPEN || activeSocket.readyState === WebSocket.CONNECTING) activeSocket.close(1000, "Voice session ended");
      } catch {}
    }

    try { microphoneNode?.disconnect(); } catch {}
    try { microphoneSource?.disconnect(); } catch {}
    try { silentGain?.disconnect(); } catch {}
    microphoneNode = null;
    microphoneSource = null;
    silentGain = null;

    if (microphoneStream) {
      for (const track of microphoneStream.getTracks()) track.stop();
      microphoneStream = null;
    }
    if (microphoneContext) {
      try { await microphoneContext.close(); } catch {}
      microphoneContext = null;
    }
    try { playbackGain?.disconnect(); } catch {}
    try { playbackLimiter?.disconnect(); } catch {}
    playbackGain = null;
    playbackLimiter = null;
    if (playbackContext) {
      try { await playbackContext.close(); } catch {}
      playbackContext = null;
    }
    playbackSources.clear();
    nextPlaybackTime = 0;
  }

  return { start, stop, mute: () => setMuted(true), unmute: () => setMuted(false), setMuted };
}
