// Speech arrives from Phonic as signed 16-bit PCM at 44.1 kHz.
// Keep synthesis below unity to preserve its dynamic range. Doubling its
// amplitude and brick-wall compressing it caused harsh, pumping playback.
export const PHONIC_PLAYBACK_GAIN = 0.85;
// Slightly more jitter tolerance on Android/WebView than the previous 80 ms.
// Only applied when the queue has drained, not before each packet.
export const PHONIC_PLAYBACK_BUFFER_SECONDS = 0.18;

export function phonicAudioChunkStart(now, queuedUntil) {
  const current = Math.max(0, Number(now) || 0);
  const queued = Math.max(0, Number(queuedUntil) || 0);
  return queued > current ? queued : current + PHONIC_PLAYBACK_BUFFER_SECONDS;
}
