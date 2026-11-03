import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import tls from "node:tls";

const UPSTREAM_HOST = "api.phonic.ai";
const UPSTREAM_PATH = "/v1/sts/ws";
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_HEADER_BYTES = 16384;
const PENDING_CONNECTION_MS = 45_000;

function websocketAccept(key) {
  return createHash("sha1").update(key + GUID).digest("base64");
}

function rejectUpgrade(socket, code, explanation) {
  if (!socket.destroyed) {
    socket.end("HTTP/1.1 " + code + " " + explanation + "\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  }
}

function timeoutCloseFrame(code, reason) {
  const reasonBytes = Buffer.from(reason, "utf8").subarray(0, 123);
  const frame = Buffer.alloc(4 + reasonBytes.length);
  frame[0] = 0x88; frame[1] = 2 + reasonBytes.length;
  frame.writeUInt16BE(code, 2);
  reasonBytes.copy(frame, 4);
  return frame;
}

export function createVoiceRelay({ db, permittedOrigin = () => false, websocketBaseUrl = "wss://synqme-api.onrender.com/api/phonic/relay" }) {
  const pending = new Map();

  async function settle({ userId, leaseId, elapsedMs = 0 }) {
    const { data, error } = await db.rpc("mss_settle_voice_lease", {
      p_user_id: userId, p_lease_id: leaseId, p_elapsed_ms: Math.max(0, Math.floor(elapsedMs))
    });
    if (error) {
      console.error("MSS voice lease settlement failed", { code: error.code || "unknown" });
      throw new Error("Voice minutes could not be settled.");
    }
    return data;
  }

  async function reserve(userId) {
    const leaseId = randomUUID();
    const { data, error } = await db.rpc("mss_reserve_voice_lease", {
      p_user_id: userId, p_lease_id: leaseId
    });
    if (error || !Number.isInteger(Number(data?.reservedMs)) || Number(data?.reservedMs) < 1000) {
      const reason = String(error?.message || "");
      if (reason.includes("no_voice_credits")) {
        const failure = new Error("Your voice minutes have run out. You can purchase more in Profile.");
        failure.statusCode = 402;
        throw failure;
      }
      if (reason.includes("voice_session_already_active")) {
        const failure = new Error("You already have an active voice session. End it before starting another.");
        failure.statusCode = 409;
        throw failure;
      }
      const failure = new Error("Voice credit reservation is temporarily unavailable.");
      failure.statusCode = 503;
      throw failure;
    }
    return { userId, leaseId, reservedMs: Number(data.reservedMs) };
  }

  async function extend({ userId, leaseId }) {
    const { data, error } = await db.rpc("mss_extend_voice_lease", {
      p_user_id: userId, p_lease_id: leaseId
    });
    if (error || !Number.isFinite(Number(data?.reservedMs))) {
      throw new Error("No further verified voice minutes are available.");
    }
    return Number(data.reservedMs);
  }

  function register(reservation, upstreamSessionToken) {
    if (typeof upstreamSessionToken !== "string" || !upstreamSessionToken) {
      throw new Error("Phonic session token missing.");
    }
    const secret = randomBytes(32).toString("base64url");
    const item = { ...reservation, secret, upstreamSessionToken };
    const timer = setTimeout(() => {
      if (pending.get(reservation.leaseId) !== item) return;
      pending.delete(reservation.leaseId);
      void settle({ userId: item.userId, leaseId: item.leaseId, elapsedMs: 0 }).catch(() => {});
    }, PENDING_CONNECTION_MS);
    timer.unref?.();
    item.timer = timer;
    pending.set(reservation.leaseId, item);
    return {
      websocketUrl: websocketBaseUrl + "?lease_id=" + encodeURIComponent(reservation.leaseId),
      sessionToken: secret,
      reservedMs: reservation.reservedMs
    };
  }

  function onUpgrade(request, client, head = Buffer.alloc(0)) {
    const origin = String(request.headers.origin || "").replace(/\/+$/, "");
    const key = request.headers["sec-websocket-key"];
    const validKey = typeof key === "string" && /^[A-Za-z0-9+/]{22}==$/.test(key);
    if (!permittedOrigin(origin) || !validKey ||
        String(request.headers.upgrade || "").toLowerCase() !== "websocket") {
      return rejectUpgrade(client, 403, "Forbidden");
    }
    const url = new URL(request.url || "/", "http://localhost");
    const leaseId = url.searchParams.get("lease_id");
    const supplied = url.searchParams.get("session_token");
    const item = pending.get(leaseId);
    const found = typeof supplied === "string" && item && Buffer.byteLength(supplied) === Buffer.byteLength(item.secret)
      && timingSafeEqual(Buffer.from(supplied), Buffer.from(item.secret));
    if (!found) return rejectUpgrade(client, 401, "Unauthorized");
    pending.delete(leaseId);
    clearTimeout(item.timer);

    let upstream = null;
    let startedAt = 0;
    let closed = false;
    let maxDurationTimer = null;
    let extensionTimer = null;
    let extensionPending = null;
    const finish = () => {
      if (closed) return;
      closed = true;
      if (maxDurationTimer) clearTimeout(maxDurationTimer);
      if (extensionTimer) clearTimeout(extensionTimer);
      const elapsedMs = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
      if (upstream && !upstream.destroyed) upstream.destroy();
      if (!client.destroyed) client.destroy();
      void (async () => {
        if (extensionPending) await extensionPending.catch(() => {});
        await settle({ userId: item.userId, leaseId: item.leaseId, elapsedMs });
      })().catch(() => {});
    };
    client.on("error", finish);
    client.on("close", finish);

    upstream = tls.connect({
      host: UPSTREAM_HOST, port: 443, servername: UPSTREAM_HOST,
      rejectUnauthorized: true, timeout: 15_000
    });
    upstream.on("error", finish);
    upstream.on("timeout", finish);
    upstream.on("close", finish);
    const upstreamKey = randomBytes(16).toString("base64");
    upstream.once("secureConnect", () => {
      if (closed) return;
      upstream.write([
        "GET " + UPSTREAM_PATH + "?session_token=" + encodeURIComponent(item.upstreamSessionToken) + " HTTP/1.1",
        "Host: " + UPSTREAM_HOST,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: " + upstreamKey,
        "Origin: https://synqme.mysecondself.app", "", ""
      ].join("\r\n"));
    });
    let headerBuffer = Buffer.alloc(0);
    const readHandshake = (data) => {
      headerBuffer = Buffer.concat([headerBuffer, data]);
      if (headerBuffer.length > MAX_HEADER_BYTES) {
        rejectUpgrade(client, 502, "Bad Gateway"); finish(); return;
      }
      const end = headerBuffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      upstream.removeListener("data", readHandshake);
      const responseHeaders = headerBuffer.subarray(0, end + 4).toString("ascii");
      const acceptMatch = responseHeaders.match(/^sec-websocket-accept:\s*(\S+)\s*$/im);
      if (!/^HTTP\/1\.[01] 101\b/.test(responseHeaders) ||
          acceptMatch?.[1] !== websocketAccept(upstreamKey)) {
        rejectUpgrade(client, 502, "Bad Gateway"); finish(); return;
      }
      client.write([
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Accept: " + websocketAccept(key), "", ""
      ].join("\r\n"));
      startedAt = Date.now();
      const leftover = headerBuffer.subarray(end + 4);
      if (leftover.length) client.write(leftover);
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
      function hardCutoff() {
        if (closed) return;
        if (upstream && !upstream.destroyed) upstream.unpipe(client);
        client.unpipe(upstream);
        if (client.writable && !client.destroyed) {
          client.write(timeoutCloseFrame(4008, "Voice minutes used"));
        }
        setTimeout(finish, 120).unref?.();
      }
      function scheduleCreditBoundary() {
        if (closed) return;
        const remainingMs = Math.max(0, item.reservedMs - (Date.now() - startedAt));
        maxDurationTimer = setTimeout(hardCutoff, remainingMs);
        maxDurationTimer.unref?.();
        extensionTimer = setTimeout(() => {
          if (closed) return;
          extensionPending = extend({ userId: item.userId, leaseId: item.leaseId })
            .then((nextReservedMs) => {
              if (closed || nextReservedMs <= item.reservedMs) return;
              item.reservedMs = nextReservedMs;
              clearTimeout(maxDurationTimer);
              scheduleCreditBoundary();
            }).catch(() => {
              // Retain the exact prepaid hard cutoff when no more minutes
              // can be reserved or the database is temporarily unavailable.
            }).finally(() => { extensionPending = null; });
        }, Math.max(0, remainingMs - 1500));
        extensionTimer.unref?.();
      }
      scheduleCreditBoundary();
    };
    upstream.on("data", readHandshake);
  }

  return { reserve, extend, settle, register, onUpgrade };
}
