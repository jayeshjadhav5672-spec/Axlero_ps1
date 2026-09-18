const { Server } = require("socket.io");

const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const COLLABORATION_EVENTS = ["canvas:update", "code:update", "cursor:update", "yjs:update", "yjs:awareness"];

// Shared with src/lib/yjsSocketProvider.js — Yjs wire envelope protocol tag.
const YJS_PROTOCOL = "syncspace-yjs-1";
const YJS_AWARENESS_EVENT = "yjs:awareness";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidRoomId(roomId) {
  return typeof roomId === "string" && ROOM_PATTERN.test(roomId);
}

function hasAcceptableSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}

function normalizeOptionalString(value, field, maxLength) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${field} must be a string of at most ${maxLength} characters`);
  }
  return value;
}

// --- Minimal y-protocols awareness framing (Shree, Phase 3 follow-up) ---
// The server never parses awareness state content — it only tracks
// (clientId → clock) from relayed payloads and hand-encodes removal
// updates, so abrupt disconnects don't leave stale "online" users.
// Wire format per client entry: varUint clientId, varUint clock,
// varString JSON state (null state = removal).

function readVarUint(bytes, pos) {
  let value = 0;
  let shift = 0;
  while (pos < bytes.length) {
    const byte = bytes[pos];
    pos += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [value >>> 0, pos];
    shift += 7;
    if (shift > 35) throw new Error("varUint overflow");
  }
  throw new Error("truncated varUint");
}

function readVarBuffer(bytes, pos) {
  const [length, next] = readVarUint(bytes, pos);
  pos = next;
  if (length > bytes.length - pos) throw new Error("truncated buffer");
  return [bytes.slice(pos, pos + length), pos + length];
}

function writeVarUint(value) {
  const out = [];
  let rest = value >>> 0;
  while (rest > 0x7f) {
    out.push(0x80 | (rest & 0x7f));
    rest >>>= 7;
  }
  out.push(rest);
  return out;
}

/** Extract [clientId, clock] pairs from a base64 awareness update. Never throws. */
function snoopAwarenessClocks(updateB64) {
  try {
    if (typeof updateB64 !== "string" || updateB64.length === 0) return [];
    const bytes = Buffer.from(updateB64, "base64");
    if (bytes.length === 0 || bytes.length > MAX_PAYLOAD_BYTES) return [];
    let pos = 0;
    const [count, afterCount] = readVarUint(bytes, 0);
    pos = afterCount;
    if (count > 10000) return [];
    const pairs = [];
    for (let i = 0; i < count; i += 1) {
      const [clientId, afterId] = readVarUint(bytes, pos);
      const [clock, afterClock] = readVarUint(bytes, afterId);
      const [, afterState] = readVarBuffer(bytes, afterClock);
      pos = afterState;
      pairs.push([clientId, clock]);
    }
    return pairs;
  } catch {
    return [];
  }
}

/** Encode a removal update (null state) for one client at the given clock. */
function encodeAwarenessRemoval(clientId, clock) {
  const nullBytes = Buffer.from("null", "utf8");
  const bytes = [
    ...writeVarUint(1),
    ...writeVarUint(clientId),
    ...writeVarUint(clock),
    ...writeVarUint(nullBytes.length),
    ...nullBytes,
  ];
  return Buffer.from(bytes).toString("base64");
}

function createSocketServer(httpServer, options = {}) {
  const io = new Server(httpServer, {
    cors: options.cors || { origin: true, credentials: true },
    ...options.socket,
  });
  const roomPresence = new Map();
  // Last-seen awareness clock per room per Yjs clientID, snooped from
  // relayed yjs:awareness payloads. Needed so a server-generated removal
  // update carries a clock peers accept (removals with a stale clock are
  // ignored by Yjs). roomId → Map(clientId → clock).
  const awarenessClocks = new Map();

  function presenceFor(roomId) {
    return [...(roomPresence.get(roomId) || [])].map((entry) => ({ ...entry }));
  }

  function broadcastPresence(roomId) {
    io.to(roomId).emit("presence:update", {
      roomId,
      users: presenceFor(roomId),
    });
  }

/** Record last-seen awareness clocks so removals use an accepted clock. */
  function trackAwarenessClocks(socket, roomId, updateB64) {
    const pairs = snoopAwarenessClocks(updateB64);
    if (pairs.length === 0) return;
    let roomClocks = awarenessClocks.get(roomId);
    if (!roomClocks) {
      roomClocks = new Map();
      awarenessClocks.set(roomId, roomClocks);
    }
    // Authorship binding (anti-spoof): only clientIDs this socket actually
    // authored through this server may later be removed on its behalf.
    // A hello-claimed ID the socket never wrote can never evict anyone.
    let authored = socket.data.yjsAuthored;
    if (!(authored instanceof Set)) {
      authored = new Set();
      socket.data.yjsAuthored = authored;
    }
    for (const [clientId, clock] of pairs) {
      const prev = roomClocks.get(clientId) || 0;
      if (clock > prev) roomClocks.set(clientId, clock);
      authored.add(clientId);
      // Bound per-room clock state: rooms with pathological client counts
      // evict the oldest entry instead of growing without limit. (Eviction
      // only affects never-hello'd authors, which get no removal anyway.)
      if (roomClocks.size > 1000) {
        const oldest = roomClocks.keys().next();
        if (!oldest.done) roomClocks.delete(oldest.value);
      }
    }
  }

  function sendError(socket, event, message, code = "INVALID_PAYLOAD") {
    socket.emit("connection:error", { event, code, message });
  }

  function removeFromPresence(socket) {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const users = roomPresence.get(roomId) || [];
    roomPresence.set(roomId, users.filter((entry) => entry.socketId !== socket.id));
    if (roomPresence.get(roomId).length === 0) roomPresence.delete(roomId);
    delete socket.data.roomId;
    broadcastPresence(roomId);
    broadcastAwarenessRemoval(socket, roomId);
  }

  // If the socket registered a Yjs awareness clientID for this room
  // (via yjs:hello), broadcast a removal update so remaining clients stop
  // listing it — this covers explicit leave, room switch AND abrupt
  // disconnect (removeFromPresence runs on all three paths). The removal
  // clock is last-seen + 1 so peers accept it; state itself is never read.
  // The mapping must ALSO be socket-authored (seen in this socket's own
  // relayed updates): a hello-claimed ID the socket never wrote cannot
  // evict the real owner.
  function broadcastAwarenessRemoval(socket, roomId) {
    const clientId = socket.data.yjsClientId;
    delete socket.data.yjsClientId;
    if (!Number.isInteger(clientId) || clientId < 0) return;
    const authored = socket.data.yjsAuthored;
    if (!(authored instanceof Set) || !authored.has(clientId)) return;
    const roomClocks = awarenessClocks.get(roomId);
    const lastClock = roomClocks ? roomClocks.get(clientId) || 0 : 0;
    if (roomClocks) {
      roomClocks.delete(clientId);
      if (roomClocks.size === 0) awarenessClocks.delete(roomId);
    }
    try {
      // broadcast excludes the leaving socket itself (matches relay
      // semantics; avoids recreating a just-destroyed local Awareness).
      socket.broadcast.to(roomId).emit(YJS_AWARENESS_EVENT, {
        roomId,
        data: { protocol: YJS_PROTOCOL, kind: "awareness", update: encodeAwarenessRemoval(clientId, lastClock + 1) },
      });
    } catch {
      // never break presence cleanup because of an encode/emit failure
    }
  }

  function addToPresence(socket, roomId, payload) {
    const users = roomPresence.get(roomId) || [];
    const identity = socket.user || {};
    users.push({
      socketId: socket.id,
      userId: identity.id || payload.userId,
      displayName: identity.displayName || payload.displayName,
      roomId,
    });
    roomPresence.set(roomId, users);
  }

  io.on("connection", (socket) => {
    socket.on("room:join", (payload) => {
      try {
        if (!isPlainObject(payload) || !isValidRoomId(payload.roomId)) {
          throw new Error("roomId must be a valid room identifier");
        }
        const userId = normalizeOptionalString(payload.userId, "userId", 128);
        const displayName = normalizeOptionalString(payload.displayName, "displayName", 128);

        if (socket.data.roomId === payload.roomId) {
          socket.emit("room:joined", {
            roomId: payload.roomId,
            presence: presenceFor(payload.roomId),
          });
          return;
        }

        const prevRoom = socket.data.roomId;
        removeFromPresence(socket);
        if (prevRoom && prevRoom !== payload.roomId) {
          socket.leave(prevRoom);
        }
        socket.join(payload.roomId);
        socket.data.roomId = payload.roomId;
        addToPresence(socket, payload.roomId, { userId, displayName });
        socket.emit("room:joined", {
          roomId: payload.roomId,
          presence: presenceFor(payload.roomId),
        });
        broadcastPresence(payload.roomId);
      } catch (error) {
        sendError(socket, "room:join", error.message);
      }
    });

    socket.on("room:leave", (payload) => {
      try {
        if (!isPlainObject(payload) || !isValidRoomId(payload.roomId)) {
          throw new Error("roomId must be a valid room identifier");
        }
        if (socket.data.roomId !== payload.roomId) {
          throw new Error("socket does not belong to this room");
        }

        const roomId = socket.data.roomId;
        removeFromPresence(socket);
        socket.leave(roomId);
        socket.emit("room:left", { roomId });
      } catch (error) {
        sendError(socket, "room:leave", error.message);
      }
    });

    socket.on("yjs:hello", (payload) => {
      try {
        if (!isPlainObject(payload) || !isValidRoomId(payload.roomId)) {
          throw new Error("payload must include a valid roomId");
        }
        if (socket.data.roomId !== payload.roomId) {
          throw new Error("socket does not belong to this room");
        }
        const data = payload.data;
        if (!isPlainObject(data) || data.protocol !== YJS_PROTOCOL || data.kind !== "hello") {
          throw new Error("payload must be a Yjs hello envelope");
        }
        if (!Number.isInteger(data.clientId) || data.clientId < 0 || data.clientId > 4294967295) {
          throw new Error("clientId must be a 32-bit unsigned integer");
        }
        // Mapping only — no broadcast. Peers learn this client through its
        // regular awareness updates; the mapping lets the server broadcast
        // a removal when this socket leaves or disconnects abruptly.
        socket.data.yjsClientId = data.clientId;
      } catch (error) {
        sendError(socket, "yjs:hello", error.message);
      }
    });

    for (const event of COLLABORATION_EVENTS) {
      socket.on(event, (payload) => {
        try {
          if (!isPlainObject(payload) || !isValidRoomId(payload.roomId)) {
            throw new Error("payload must include a valid roomId");
          }
          if (socket.data.roomId !== payload.roomId) {
            throw new Error("socket does not belong to this room");
          }
          if (!("data" in payload) || payload.data === undefined || !hasAcceptableSize(payload.data)) {
            throw new Error("payload must include acceptable data");
          }

          if (event === YJS_AWARENESS_EVENT && isPlainObject(payload.data)) {
            trackAwarenessClocks(socket, payload.roomId, payload.data.update);
          }

          socket.to(socket.data.roomId).emit(event, {
            roomId: socket.data.roomId,
            data: payload.data,
            socketId: socket.id,
          });
        } catch (error) {
          sendError(socket, event, error.message);
        }
      });
    }

    socket.on("error", (error) => {
      sendError(socket, "socket", error?.message || "Socket error", "SOCKET_ERROR");
    });

    socket.on("disconnect", () => {
      removeFromPresence(socket);
    });
  });

  return { io, roomPresence };
}

module.exports = { createSocketServer, isValidRoomId };
