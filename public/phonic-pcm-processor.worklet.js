// This worklet captures microphone PCM for Phonic's STS WebSocket.
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 1024;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
    this.isMuted = false;
    this.port.onmessage = (event) => {
      if (event.data.type === "mute") this.isMuted = true;
      else if (event.data.type === "unmute") this.isMuted = false;
    };
  }

  averageInputChannels(channels) {
    if (!channels.length) return new Float32Array(0);
    if (channels.length === 1) return channels[0];
    const length = channels[0].length;
    const output = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      let sum = 0;
      for (let channel = 0; channel < channels.length; channel += 1) sum += channels[channel][index];
      output[index] = sum / channels.length;
    }
    return output;
  }

  process(inputs, outputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const input = this.averageInputChannels(channels);
    const outputChannels = outputs[0] || [];
    for (const output of outputChannels) output.fill(0);

    for (let index = 0; index < input.length; index += 1) {
      this.buffer[this.bufferIndex++] = this.isMuted ? 0 : input[index];
      if (this.bufferIndex >= this.bufferSize) {
        this.port.postMessage({
          type: "audio-recording-chunk",
          buffer: this.buffer.slice()
        });
        this.bufferIndex = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-processor", PCMProcessor);
