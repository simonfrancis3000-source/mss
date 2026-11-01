// Phonic's text belongs to its paired PCM chunk. Add silence only between
// chunks after terminal punctuation; never split or remove audio samples.
const QUIET_SAMPLE = 80;
const SENTENCE_GAP = 0.28;
const QUESTION_GAP = 0.42;

function endsSentence(text) {
  const value = String(text || '').trim();
  if (!/[.!?。！？]["'”’»）)\]]*$/.test(value)) return false;
  if (/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)\.["'”’]*$/i.test(value)) return false;
  if (/\b(?:[A-Z]\.){2,}$/.test(value)) return false;
  if (/(?:^|\s)[A-Z]\.$/.test(value) || /^\s*\d+\.$/.test(value)) return false;
  return true;
}

export function createSentencePausePlanner(sampleRate = 44100) {
  let pending = false;
  let silence = 0;
  let textTail = '';
  return {
    reset() { pending = false; silence = 0; textTail = ''; },
    gapBefore(pcm, text = '', elapsedGap = 0) {
      let leading = 0;
      while (leading < pcm.length && Math.abs(pcm[leading]) <= QUIET_SAMPLE) leading++;
      let trailing = 0;
      while (trailing < pcm.length && Math.abs(pcm[pcm.length - 1 - trailing]) <= QUIET_SAMPLE) trailing++;
      let gap = 0;
      if (pending && /\d\.$/.test(textTail) && /^\s*\d/.test(text)) { pending = false; silence = 0; }
      if (pending && leading < pcm.length) {
        const question = /^\s*(?:what|when|where|which|why|how|would|could|should|do|does|did|is|are|can|may|will|qué|cómo|cuándo|dónde|comment|quand|pourquoi|wie|was|wann|wo)\b|^\s*[¿？]/i.test(text);
        gap = Math.max(0, (question ? QUESTION_GAP : SENTENCE_GAP) - silence - leading / sampleRate - Math.max(0, elapsedGap));
        pending = false;
        silence = 0;
      } else if (pending) {
        silence += pcm.length / sampleRate + Math.max(0, elapsedGap);
      }
      if (text) textTail = (textTail + text).slice(-100);
      if (text && endsSentence(textTail)) {
        pending = true;
        silence = trailing / sampleRate;
      }
      return gap;
    }
  };
}
