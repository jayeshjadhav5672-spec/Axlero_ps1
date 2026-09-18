const { Server } = require("socket.io");

const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const COLLABORATION_EVENTS = ["canvas:update", "code:update", "cursor:update"];
// High-frequency pen-stroke streaming: relayed without the generic JSON
// size check (a size-capped points array is validated cheaply below, so the
// hot path never pays a full stringify per pointermove).
const STROKE_STREAM_EVENTS = ["draw:stroke-progress", "draw:stroke-complete", "draw:stroke-cancel"];
const MAX_STREAM_POINTS = 20000;

/**
 * Server-side room snapshots (Issue 1: ghost artifacts). The relay is
 * otherwise stateless, so a late joiner would see an empty board — and any
 * shape deleted/cleared before they arrived would resurrect the moment an
 * older client re-broadcasts. `roomState` tracks the authoritative shape
 * array per room from every validated mutation channel (unified +
 * legacy ops); `room:join` delivers it as `canvas:sync-init` to the
 * joiner only. Bounded (rooms + shapes caps, oldest evicted) so memory
 * cannot grow unboundedly. Ephemeral streams (previews, cursors, trails,
 * in-progress strokes) never touch it.
 */
const MAX_ROOMS = 200;
const MAX_ROOM_SHAPES = 2000;

function commitListOf(data) {
  if (!isPlainObject(data)) return [];
  if (Array.isArray(data.shapes)) return data.shapes;
  if (data.shape !== undefined) return [data.shape];
  return [];
}

function validShapeEntries(list) {
  return (Array.isArray(list) ? list : []).filter(
    (s) => isPlainObject(s) && typeof s.id === "string" && s.id
  );
}

/**
 * Pure room-snapshot reducer: folds one validated mutation event into the
 * previous shape array. Returns the same reference when nothing changed.
 * Exported for unit tests.
 */
function applyRoomMutation(prevShapes, event, data) {
  const prev = Array.isArray(prevShapes) ? prevShapes : [];
  switch (event) {
    case "shapes:commit":
    case "draw:stroke-complete": {
      const fresh = validShapeEntries(commitListOf(data)).filter(
        (s) => !prev.some((p) => p.id === s.id)
      );
      if (fresh.length === 0) return prev;
      return [...prev, ...fresh];
    }
    case "shapes:update-batch":
    case "canvas:history-sync": {
      if (!isPlainObject(data) || !Array.isArray(data.shapes)) return prev;
      const incoming = validShapeEntries(data.shapes);
      if (event === "canvas:history-sync") return incoming;
      if (incoming.length === 0) return prev;
      const merged = new Map(prev.map((s) => [s.id, s]));
      for (const s of incoming) merged.set(s.id, { ...merged.get(s.id), ...s });
      // Adopt sender order when id sets match (reorder sync).
      const inIds = incoming.map((s) => s.id);
      if (inIds.length === prev.length && inIds.every((id) => merged.has(id))) {
        const prevIds = new Set(prev.map((s) => s.id));
        if (inIds.every((id) => prevIds.has(id))) return inIds.map((id) => merged.get(id));
      }
      const next = [...merged.values()];
      return next.length === prev.length && next.every((s, i) => s === prev[i]) ? prev : next;
    }
    case "shapes:delete": {
      if (!isPlainObject(data)) return prev;
      const ids = new Set(
        (Array.isArray(data.shapeIds) ? data.shapeIds : data.shapeId !== undefined ? [data.shapeId] : []).filter(
          (id) => typeof id === "string"
        )
      );
      if (ids.size === 0) return prev;
      const next = prev.filter((s) => !ids.has(s.id));
      return next.length === prev.length ? prev : next;
    }
    case "canvas:clear":
      return prev.length === 0 ? prev : [];
    case "canvas:update": {
      // Legacy op envelope { op, ... } from the controlled shell.
      if (!isPlainObject(data) || typeof data.op !== "string") return prev;
      if (data.op === "create" && isPlainObject(data.shape) && typeof data.shape.id === "string") {
        return prev.some((s) => s.id === data.shape.id) ? prev : [...prev, data.shape];
      }
      if (data.op === "update" && typeof data.shapeId === "string" && isPlainObject(data.changes)) {
        if (!prev.some((s) => s.id === data.shapeId)) return prev;
        return prev.map((s) => (s.id === data.shapeId ? { ...s, ...data.changes } : s));
      }
      if (data.op === "delete" && typeof data.shapeId === "string") {
        const next = prev.filter((s) => s.id !== data.shapeId);
        return next.length === prev.length ? prev : next;
      }
      if (data.op === "clear") return prev.length === 0 ? prev : [];
      if (data.op === "reorder" && Array.isArray(data.shapes)) {
        return validShapeEntries(data.shapes);
      }
      return prev;
    }
    default:
      return prev;
  }
}

/**
 * Unified live-collaboration channels. Two classes:
 * - Ephemeral peer-to-peer streams (high-frequency, never persisted):
 *   shape:preview-progress / shape:preview-cancel (all-tool creation
 *   drag previews), cursor:move, eraser:trail.
 * - Committed mutations (persisted, full room sync): shapes:commit,
 *   shapes:delete, shapes:update-batch, canvas:clear, canvas:history-sync.
 *
 * Legacy channels stay operational: draw:stroke-* (pen streaming),
 * canvas:update / code:update / cursor:update (committed ops + presence).
 */
const LIVE_COLLAB_EVENTS = [
  "shape:preview-progress",
  "shape:preview-cancel",
  "cursor:move",
  "eraser:trail",
  "shapes:commit",
  "shapes:delete",
  "shapes:update-batch",
  "canvas:clear",
  "canvas:history-sync",
  // Peer selection presence (ephemeral overlay; tools/selection stay local
  // per client — this channel only paints non-intrusive peer highlights).
  "collab:selection",
  // Shared viewport + toolbar sync (ephemeral, last-writer-wins).
  "canvas:viewport-sync",
  "collab:tool-sync",
];
const MAX_PREVIEW_BYTES = 64 * 1024;
const MAX_BATCH_SHAPES = 500;
const MAX_TRAIL_POINTS = 5000;

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

function isFiniteCoord(value) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e7;
}

function isIdString(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function byteSizeOk(value, cap) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= cap;
  } catch {
    return false;
  }
}

/**
 * Lightweight validation for the high-frequency stroke-stream envelope.
 * Points arrays are length-capped (no full-payload stringify on the hot
 * path); shape payloads on `draw:stroke-complete` reuse the generic byte
 * cap since they arrive once per stroke.
 */
function assertStrokeStreamPayload(payload, event) {
  if (!isPlainObject(payload) || !isValidRoomId(payload.roomId)) {
    throw new Error("payload must include a valid roomId");
  }
  const data = payload.data;
  if (!isPlainObject(data) || typeof data.strokeId !== "string" || data.strokeId.length === 0 || data.strokeId.length > 128) {
    throw new Error("payload data must include a valid strokeId");
  }
  if (event === "draw:stroke-progress") {
    const points = data.points;
    if (
      !Array.isArray(points) ||
      points.length < 2 ||
      points.length > MAX_STREAM_POINTS ||
      points.length % 2 !== 0 ||
      !points.every(isFiniteCoord)
    ) {
      throw new Error("stroke points must be a finite [x, y, ...] array within the stream cap");
    }
  }
  if (event === "draw:stroke-complete" && data.shape !== undefined && data.shape !== null) {
    if (!isPlainObject(data.shape) || !hasAcceptableSize(data.shape)) {
      throw new Error("completed shape must be an acceptable object");
    }
  }
}

/**
 * Validation for the unified live-collaboration envelope. Ephemeral
 * streams use cheap structural/size checks (no hot-path stringify beyond
 * a capped byte measure on small preview objects); committed mutations
 * reuse the generic byte cap. Every branch throws — callers convert to
 * `connection:error` so malformed input fails LOUD, never silent.
 */
function assertLiveCollabPayload(payload, event) {
  if (!isPlainObject(payload) || !isValidRoomId(payload.roomId)) {
    throw new Error("payload must include a valid roomId");
  }
  const data = payload.data;
  switch (event) {
    case "shape:preview-progress": {
      if (!isPlainObject(data) || !isIdString(data.draftId)) {
        throw new Error("preview progress must include a valid draftId");
      }
      if (
        !isPlainObject(data.shape) ||
        typeof data.shape.id !== "string" ||
        !data.shape.id ||
        typeof data.shape.type !== "string" ||
        !byteSizeOk(data, MAX_PREVIEW_BYTES)
      ) {
        throw new Error("preview progress must include an acceptable shape descriptor");
      }
      break;
    }
    case "shape:preview-cancel": {
      if (!isPlainObject(data) || !isIdString(data.draftId)) {
        throw new Error("preview cancel must include a valid draftId");
      }
      break;
    }
    case "cursor:move": {
      if (!isPlainObject(data) || !isFiniteCoord(data.x) || !isFiniteCoord(data.y)) {
        throw new Error("cursor move must include finite x/y");
      }
      if (data.user !== undefined && typeof data.user !== "string") {
        throw new Error("cursor user must be a string");
      }
      if (data.tool !== undefined && typeof data.tool !== "string") {
        throw new Error("cursor tool must be a string");
      }
      break;
    }
    case "eraser:trail": {
      if (!isPlainObject(data) || !isIdString(data.eraserId)) {
        throw new Error("eraser trail must include a valid eraserId");
      }
      const points = data.points;
      if (
        !Array.isArray(points) ||
        points.length > MAX_TRAIL_POINTS ||
        !points.every(isFiniteCoord)
      ) {
        throw new Error("eraser points must be a finite array within the trail cap");
      }
      break;
    }
    case "shapes:commit": {
      if (!isPlainObject(data)) {
        throw new Error("commit must include a shape payload");
      }
      // Accept both envelopes: { shape } (legacy) and { shapes: [] }.
      const list = Array.isArray(data.shapes) ? data.shapes : data.shape !== undefined ? [data.shape] : null;
      if (!list || list.length === 0 || list.length > MAX_BATCH_SHAPES) {
        throw new Error("commit must include 1-500 shapes");
      }
      if (!list.every((s) => isPlainObject(s) && typeof s.id === "string" && s.id)) {
        throw new Error("every committed shape must include an id");
      }
      if (!byteSizeOk(list, MAX_PAYLOAD_BYTES)) {
        throw new Error("commit exceeds the size cap");
      }
      break;
    }
    case "shapes:delete": {
      if (!isPlainObject(data)) throw new Error("delete must include shape ids");
      const ids = Array.isArray(data.shapeIds) ? data.shapeIds : data.shapeId !== undefined ? [data.shapeId] : null;
      if (!ids || ids.length === 0 || ids.length > MAX_BATCH_SHAPES || !ids.every(isIdString)) {
        throw new Error("delete must include 1-500 valid shape ids");
      }
      break;
    }
    case "shapes:update-batch": {
      if (!isPlainObject(data) || !Array.isArray(data.shapes) || data.shapes.length === 0 || data.shapes.length > MAX_BATCH_SHAPES) {
        throw new Error("update batch must include 1-500 shapes");
      }
      if (!data.shapes.every((s) => isPlainObject(s) && typeof s.id === "string" && s.id)) {
        throw new Error("every batched shape must include an id");
      }
      if (!hasAcceptableSize(data.shapes)) {
        throw new Error("update batch exceeds the size cap");
      }
      break;
    }
    case "canvas:clear": {
      if (data !== undefined && data !== null && !isPlainObject(data)) {
        throw new Error("clear payload must be an object when present");
      }
      break;
    }
    case "canvas:history-sync": {
      if (!isPlainObject(data) || !Array.isArray(data.shapes) || data.shapes.length > MAX_BATCH_SHAPES) {
        throw new Error("history sync must include a shapes array within the cap");
      }
      if (!hasAcceptableSize(data.shapes)) {
        throw new Error("history snapshot exceeds the size cap");
      }
      break;
    }
    case "collab:selection": {
      if (!isPlainObject(data)) {
        throw new Error("selection must include a payload object");
      }
      if (data.shapeIds !== undefined) {
        if (!Array.isArray(data.shapeIds) || data.shapeIds.length > MAX_BATCH_SHAPES || !data.shapeIds.every(isIdString)) {
          throw new Error("selection shapeIds must be 0-500 valid ids");
        }
      }
      if (data.userId !== undefined && !isIdString(data.userId)) {
        throw new Error("selection userId must be a valid id");
      }
      for (const field of ["userName", "color"]) {
        if (data[field] !== undefined && typeof data[field] !== "string") {
          throw new Error(`selection ${field} must be a string`);
        }
      }
      break;
    }
    case "canvas:viewport-sync": {
      if (!isPlainObject(data)) {
        throw new Error("viewport sync must include a payload object");
      }
      if (data.stagePos !== undefined) {
        if (!isPlainObject(data.stagePos) || !isFiniteCoord(data.stagePos.x) || !isFiniteCoord(data.stagePos.y)) {
          throw new Error("viewport stagePos must hold finite x/y");
        }
      }
      if (data.scale !== undefined && (!isFiniteCoord(data.scale) || data.scale <= 0 || data.scale > 100)) {
        throw new Error("viewport scale must be a positive finite number");
      }
      break;
    }
    case "collab:tool-sync": {
      if (!isPlainObject(data) || typeof data.tool !== "string" || data.tool.length === 0 || data.tool.length > 32) {
        throw new Error("tool sync must include a tool name");
      }
      break;
    }
    default:
      throw new Error(`unknown live-collab event ${event}`);
  }
}

function createSocketServer(httpServer, options = {}) {
  const io = new Server(httpServer, {
    cors: options.cors || { origin: true, credentials: true },
    ...options.socket,
  });
  const roomPresence = new Map();
  const roomState = new Map(); // roomId -> { shapes: [], updatedAt }

  function getRoomShapes(roomId) {
    return roomState.get(roomId)?.shapes ?? [];
  }

  function setRoomShapes(roomId, shapes) {
    const clean = validShapeEntries(shapes).slice(-MAX_ROOM_SHAPES);
    if (!roomState.has(roomId) && roomState.size >= MAX_ROOMS) {
      roomState.delete(roomState.keys().next().value); // evict oldest room
    }
    roomState.set(roomId, { shapes: clean, updatedAt: Date.now() });
  }

  /** Fold a validated mutation into the room snapshot (no-op for others). */
  function trackRoomMutation(roomId, event, data) {
    try {
      const prev = getRoomShapes(roomId);
      const next = applyRoomMutation(prev, event, data);
      if (next !== prev) setRoomShapes(roomId, next);
    } catch {
      // snapshot tracking is best-effort; relay already succeeded
    }
  }

  function presenceFor(roomId) {
    return [...(roomPresence.get(roomId) || [])].map((entry) => ({ ...entry }));
  }

  function broadcastPresence(roomId) {
    io.to(roomId).emit("presence:update", {
      roomId,
      users: presenceFor(roomId),
    });
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
          // Late-joiner convergence: deliver the current snapshot even on
          // idempotent rejoins (client merges; empty local boards adopt).
          socket.emit("canvas:sync-init", {
            roomId: payload.roomId,
            shapes: getRoomShapes(payload.roomId),
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
        // Emission order matters (fixes presence-race flakes): the join's
        // `presence:update` broadcast goes out BEFORE the `room:joined`
        // ack. Socket.io preserves per-socket send order, so any listener
        // attached after observing `room:joined` can never catch this
        // stale join broadcast — it only sees subsequent events (leaves,
        // disconnects, later joins). Snapshot delivery stays last: it is
        // joiner-only and order-independent.
        broadcastPresence(payload.roomId);
        socket.emit("room:joined", {
          roomId: payload.roomId,
          presence: presenceFor(payload.roomId),
        });
        // Late-joiner convergence: current snapshot goes ONLY to the
        // joiner (not a room broadcast) so existing peers are undisturbed.
        socket.emit("canvas:sync-init", {
          roomId: payload.roomId,
          shapes: getRoomShapes(payload.roomId),
        });
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

          // Track legacy whiteboard ops in the room snapshot (code/cursor
          // payloads are ignored by the reducer).
          if (event === "canvas:update") {
            trackRoomMutation(socket.data.roomId, event, payload.data);
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

    // In-progress pen-stroke streaming: broadcast incremental points to
    // all OTHER clients in the room without sending back to the sender.
    // The relay itself is a single async emit (never blocks the loop);
    // validation above is O(points) with an early cap, no stringify.
    // Definitive room matching: relay on the VERIFIED payload roomId, with
    // membership decided by the adapter-level `socket.rooms` set (ground
    // truth) rather than the app-level `socket.data.roomId` tracker alone.
    // If the tracker diverged it is re-synced instead of dropping the
    // packet; sockets that never joined the room are still rejected, so
    // room-spoofing stays impossible (no blind auto-join on claim).
    // Self-instrumenting pipeline probe (audit): structured TRACE lines
    // for every stroke event. Enable with SYNCSPACE_STROKE_DEBUG=1 — kept
    // behind the flag so the ~30Hz hot path never spams production logs
    // (unconditional per-flush logging would itself add latency).
    const strokeDebugOn = process.env.SYNCSPACE_STROKE_DEBUG === "1";
    const traceServer = (...args) => {
      if (strokeDebugOn) console.log("[TRACE:SERVER]", ...args);
    };
    const traceServerError = (...args) => {
      if (strokeDebugOn) console.error("[TRACE:SERVER_ERROR]", ...args);
    };
    for (const event of STROKE_STREAM_EVENTS) {
      socket.on(event, (payload) => {
        try {
          // TRACE: incoming vs outgoing identity — pinpoints routing breaks.
          traceServer(`In-progress stroke received from ${socket.id}`, {
            event,
            payloadRoomId: payload?.roomId,
            socketJoinedRooms: Array.from(socket.rooms || []),
            trackedRoomId: socket.data.roomId ?? null,
            pointCount: payload?.data?.points?.length,
          });
          if (!payload?.roomId) {
            traceServerError("Missing payload.roomId!");
            throw new Error("payload must include a valid roomId");
          }
          assertStrokeStreamPayload(payload, event);
          const targetRoom = payload.roomId;
          let member = false;
          try {
            member =
              socket.rooms && typeof socket.rooms.has === "function"
                ? socket.rooms.has(targetRoom)
                : socket.data.roomId === targetRoom;
          } catch {
            member = socket.data.roomId === targetRoom;
          }
          if (!member) {
            // TRACE: sender not in the target room — packet must NOT relay
            // (blind force-join here would let any client inject into any
            // room, breaking room isolation; see stroke-streaming tests).
            traceServerError(
              `Sender ${socket.id} not in room "${targetRoom}" (joined: [${Array.from(socket.rooms || []).join(", ")}]) — packet dropped, spoofing rejected`
            );
            throw new Error("socket does not belong to this room");
          }
          if (socket.data.roomId !== targetRoom) {
            socket.data.roomId = targetRoom;
          }

          // Relay strictly to all other peers in the target room.
          // Stroke completions also fold into the room snapshot (the
          // authoritative commit op follows and dedupes by id).
          if (event === "draw:stroke-complete") {
            trackRoomMutation(targetRoom, event, payload.data);
          }
          socket.to(targetRoom).emit(event, {
            roomId: targetRoom,
            data: payload.data,
            socketId: socket.id,
          });
          traceServer(`Relayed ${event} to room "${targetRoom}" excluding sender ${socket.id}`);
        } catch (error) {
          traceServerError(`${event} from=${socket.id}: ${error.message}`);
          sendError(socket, event, error.message);
        }
      });
    }

    // Unified live-collaboration relay: ephemeral previews/cursors AND
    // committed mutations share one hardened path — verified roomId,
    // adapter-level membership (tracker re-synced on divergence, spoofers
    // rejected with connection:error), peers-only broadcast, TRACE probe.
    for (const event of LIVE_COLLAB_EVENTS) {
      socket.on(event, (payload) => {
        try {
          traceServer(`Live-collab received from ${socket.id}`, {
            event,
            payloadRoomId: payload?.roomId,
            socketJoinedRooms: Array.from(socket.rooms || []),
            trackedRoomId: socket.data.roomId ?? null,
          });
          assertLiveCollabPayload(payload, event);
          const targetRoom = payload.roomId;
          let member = false;
          try {
            member =
              socket.rooms && typeof socket.rooms.has === "function"
                ? socket.rooms.has(targetRoom)
                : socket.data.roomId === targetRoom;
          } catch {
            member = socket.data.roomId === targetRoom;
          }
          if (!member) {
            traceServerError(
              `Sender ${socket.id} not in room "${targetRoom}" (joined: [${Array.from(socket.rooms || []).join(", ")}]) — packet dropped, spoofing rejected`
            );
            throw new Error("socket does not belong to this room");
          }
          if (socket.data.roomId !== targetRoom) {
            socket.data.roomId = targetRoom;
          }

          // Ephemeral previews & cursor moves: broadcast only to other peers.
          // Committed mutations: broadcast to other peers (sender already
          // applied locally — loop-free by construction). Committed
          // mutations also fold into the room snapshot for late joiners;
          // ephemeral streams never touch it.
          if (
            event === "shapes:commit" ||
            event === "shapes:update-batch" ||
            event === "shapes:delete" ||
            event === "canvas:clear" ||
            event === "canvas:history-sync"
          ) {
            trackRoomMutation(targetRoom, event, payload.data);
          }
          socket.to(targetRoom).emit(event, {
            roomId: targetRoom,
            data: payload.data,
            socketId: socket.id,
          });
          traceServer(`Relayed ${event} to room "${targetRoom}" excluding sender ${socket.id}`);
        } catch (error) {
          traceServerError(`${event} from=${socket.id}: ${error.message}`);
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

  return { io, roomPresence, roomState, applyRoomMutation };
}

module.exports = { createSocketServer, isValidRoomId, applyRoomMutation };
