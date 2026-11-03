import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceRelay } from "../server/voice-relay.js";

test("voice relay reserves verified prepaid balance before issuing connection credentials", async () => {
  const calls = [];
  const db = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "mss_reserve_voice_lease") return { data: { reservedMs: 300000 }, error: null };
      if (name === "mss_extend_voice_lease") return { data: { reservedMs: 600000 }, error: null };
      if (name === "mss_settle_voice_lease") return { data: { settled: true, chargedMs: 10000 }, error: null };
      return { data: null, error: { message: "unexpected RPC" } };
    }
  };
  const relay = createVoiceRelay({ db });
  const reservation = await relay.reserve("test-user");
  assert.equal(reservation.reservedMs, 300000);
  assert.match(reservation.leaseId, /^[a-f0-9-]{36}$/);
  assert.equal(await relay.extend(reservation), 600000);
  const connection = relay.register(reservation, "provider-token-never-shared");
  assert.equal(connection.reservedMs, 300000);
  assert.ok(connection.websocketUrl.startsWith("wss://synqme-api.onrender.com/api/phonic/relay?lease_id="));
  assert.ok(!connection.websocketUrl.includes("provider-token"));
  assert.ok(!connection.sessionToken.includes("provider-token"));
  assert.equal((await relay.settle({ ...reservation, elapsedMs: 10000 })).settled, true);
  assert.deepEqual(calls.map(x => x.name), [
    "mss_reserve_voice_lease", "mss_extend_voice_lease", "mss_settle_voice_lease"
  ]);
});

test("voice relay rejects missing credits and concurrent sessions", async () => {
  const db = { async rpc(name) { return { data: null, error: {
    message: name === "mss_reserve_voice_lease" ? "no_voice_credits" : "unknown"
  } }; } };
  const relay = createVoiceRelay({ db });
  await assert.rejects(relay.reserve("user"), error => error.statusCode === 402);
  const busy = createVoiceRelay({ db: {
    async rpc() { return { data: null, error: { message: "voice_session_already_active" } }; }
  } });
  await assert.rejects(busy.reserve("user"), error => error.statusCode === 409);
});

test("voice relay refuses malformed or absent reservation amount", async () => {
  const relay = createVoiceRelay({ db: {
    async rpc() { return { data: { reservedMs: 0 }, error: null }; }
  } });
  await assert.rejects(relay.reserve("user"), error => error.statusCode === 503);
});
