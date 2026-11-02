// An account-scoped, leased queue is persisted by the caller. The runner only
// removes a job after extraction and all memory writes have succeeded.
export function createMemoryJobRunner({ claim, process, complete, retry, onError = () => {} }) {
  let running = false;
  return {
    get running() { return running; },
    async drain() {
      if (running) return;
      running = true;
      try {
        while (true) {
          const job = await claim();
          if (!job) break;
          try {
            await process(job);
            await complete(job);
          } catch (error) {
            await retry(job, error);
            onError(error);
            break; // Respect the retry delay instead of immediately looping.
          }
        }
      } finally { running = false; }
    }
  };
}

export function memoryRetryDelaySeconds(attempts) {
  return Math.min(300, 5 * 2 ** Math.min(6, Math.max(0, Number(attempts || 1) - 1)));
}

// Timestamp plus message hash avoids collapsing two different turns that have
// the same millisecond timestamp. The key contains no message text.
export function memoryJobKey(timestamp, message) {
  let hash = 2166136261;
  for (const char of String(message || '')) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return String(timestamp || '').replace(/[^0-9]/g, '') + '-' + (hash >>> 0).toString(36);
}
