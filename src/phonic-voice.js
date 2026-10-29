// Real-time browser voice adapter for Phonic's Speech-to-Speech WebSocket.
// Adapted from Phonic-Co/phonic-web-demo (MIT): https://github.com/Phonic-Co/phonic-web-demo

const DEFAULT_WS_URL = "wss://api.phonic.ai/v1/sts/ws";
const SAMPLE_RATE = 44100;

function resampleFloat32(input, inputRate, outputRate) {
  if (inputRate === outputRate) return input.slice();
  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  let position = 0;
  for (let index = 0; index < outputLength; index += 1) {
    const nextPosition = (index + 1) * ratio;
    let sum = 0;
    let count = 0;
    while (position < nextPosition && position < input.length) {
      sum += input[position];
      count += 1;
      position += 1;
    }
    output[index] = count ? sum / count : 0;
  }
  return output;
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

export function createPhonicVoiceConversation({ getSession, getConfig, onEvent = () => {}, onToolCall = async () => ({ status: "error", assistant_text: "I’m having trouble preparing a response right now. Please try again in a moment." }) }) {
  let socket = null;
  let microphoneStream = null;
  let microphoneContext = null;
  let microphoneSource = null;
  let microphoneNode = null;
  let silentGain = null;
  let playbackContext = null;
  let playbackSources = new Set();
  let nextPlaybackTime = 0;
  let stopped = true;
  let muted = false;
  let conversationItems = [];
  let nextItemIndex = 0;
  let userIsSpeaking = false;
  let startNewAssistantItem = false;

  function emit(event) {
    try {
      onEvent({ ...event, items: conversationItems.map((item) => ({ ...item })) });
    } catch (error) {
      console.error("SYNQ.ME could not process a Phonic voice event.", error);
    }
  }

  function stopPlayback() {
    for (const source of playbackSources) {
      try { source.stop(); } catch {}
    }
    playbackSources.clear();
    nextPlaybackTime = playbackContext ? playbackContext.currentTime : 0;
  }

  function playAudioChunk(base64Audio) {
    if (stopped || !playbackContext || !base64Audio) return;
    const pcm = base64ToInt16Array(base64Audio);
    if (!pcm.length) return;

    const buffer = playbackContext.createBuffer(1, pcm.length, SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < pcm.length; index += 1) {
      channel[index] = pcm[index] / 32768;
    }

    const source = playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(playbackContext.destination);
    const startAt = Math.max(playbackContext.currentTime + 0.015, nextPlaybackTime);
    nextPlaybackTime = startAt + buffer.duration;
    playbackSources.add(source);
    source.onended = () => {
      playbackSources.delete(source);
      try { source.disconnect(); } catch {}
    };
    source.start(startAt);
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
        if (typeof message.audio === "string") playAudioChunk(message.audio);
        emit({ type: "audio_chunk", audio: message.audio || "", text });
        break;
      }

      case "assistant_started_speaking":
        startNewAssistantItem = true;
        emit({ type: "assistant_started_speaking" });
        break;

      case "assistant_finished_speaking":
        emit({ type: "assistant_finished_speaking" });
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
        void handleToolCall(message);
        break;

      case "error":
        emit({
          type: "error",
          error: message.error?.message || message.message || "Phonic reported a voice-session error."
        });
        break;

      default:
        break;
    }
  }

  async function start() {
    if (!stopped) return;
    stopped = false;
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
      await microphoneContext.audioWorklet.addModule("/phonic-pcm-processor.worklet.js");
      microphoneSource = microphoneContext.createMediaStreamSource(microphoneStream);
      microphoneNode = new AudioWorkletNode(microphoneContext, "pcm-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1]
      });
      microphoneNode.port.onmessage = (event) => {
        if (stopped || event.data?.type !== "audio-recording-chunk") return;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        const input = event.data.buffer;
        if (!(input instanceof Float32Array)) return;
        const resampled = resampleFloat32(input, microphoneContext.sampleRate, SAMPLE_RATE);
        const pcm = floatToInt16(resampled);
        if (!pcm.length) return;
        try {
          socket.send(JSON.stringify({ type: "audio_chunk", audio: int16ToBase64(pcm) }));
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
      await playbackContext.resume();
      const wsBase = String(session.websocketUrl || session.wsUrl || DEFAULT_WS_URL);
      const separator = wsBase.includes("?") ? "&" : "?";
      socket = new WebSocket(wsBase + separator + "session_token=" + encodeURIComponent(sessionToken));
      socket.addEventListener("message", (event) => handleMessage(event.data));

      let connected = false;
      await new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          reject(new Error("Timed out connecting to Phonic. Check the backend URL and Phonic API configuration."));
        }, 15000);

        socket.addEventListener("open", () => {
          window.clearTimeout(timeout);
          if (stopped) {
            reject(new Error("Voice conversation was stopped."));
            return;
          }
          try {
            const config = typeof getConfig === "function" ? getConfig(session) : getConfig;
            if (!config || config.type !== "config") throw new Error("The Phonic conversation configuration is invalid.");
            socket.send(JSON.stringify(config));
            connected = true;
            emit({ type: "open" });
            resolve();
          } catch (error) {
            reject(error);
          }
        }, { once: true });

        socket.addEventListener("error", () => {
          window.clearTimeout(timeout);
          if (!connected) reject(new Error("Could not connect to Phonic. Check PHONIC_API_KEY and the backend URL."));
          emit({ type: "error", error: "The connection to Phonic failed." });
        });

        socket.addEventListener("close", (event) => {
          window.clearTimeout(timeout);
          if (!connected) reject(new Error("Phonic closed the voice connection before it was ready."));
          emit({ type: "close", code: event.code, reason: event.reason || "" });
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
    if (stopped) return;
    stopped = true;
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
    if (playbackContext) {
      try { await playbackContext.close(); } catch {}
      playbackContext = null;
    }
    playbackSources.clear();
    nextPlaybackTime = 0;
  }

  return { start, stop, mute: () => setMuted(true), unmute: () => setMuted(false), setMuted };
}
