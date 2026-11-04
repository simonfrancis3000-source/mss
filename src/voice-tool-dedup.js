// Retransmitted Phonic tool calls share an in-flight/completed successful
// result. A new socket is a new namespace; failures remain retryable.
export function createVoiceToolDeduplicator(limit = 128) {
  const sockets = new WeakMap();
  return async (socket, id, run) => {
    if (!socket || !id) return run();
    let calls = sockets.get(socket);
    if (!calls) { calls = new Map(); sockets.set(socket, calls); }
    if (calls.has(id)) return calls.get(id);
    const result = Promise.resolve().then(run);
    calls.set(id, result);
    try {
      const output = await result;
      if (output?.status !== 'ok') calls.delete(id);
      while (calls.size > limit) calls.delete(calls.keys().next().value);
      return output;
    } catch (error) { calls.delete(id); throw error; }
  };
}
