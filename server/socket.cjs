const { Server } = require("socket.io");
const { verifyToken } = require("./auth.cjs");

const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const COLLABORATION_EVENTS = ["canvas:update", "code:update", "cursor:update"];

// Lobby-mode rooms: a two-person room (one instructor + one student).
// Scoped by room-id convention — ids starting with `lobby-` are lobbies,
// every other room keeps today's unrestricted behavior. Room ids are the
// existing addressing mechanism, so no new event/protocol is needed.
const LOBBY_ROOM_PREFIX = "lobby-";
const LOBBY_CAPACITY = 2;
const LOBBY_ROLES = ["instructor", "student"];
const LOBBY_FULL_MESSAGE = "Lobby is full. Only one instructor and one student can join.";

function isLobbyRoom(roomId) {
  return typeof roomId === "string" && roomId.startsWith(LOBBY_ROOM_PREFIX);
}

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

function createSocketServer(httpServer, options = {}) {
  const io = new Server(httpServer, {
    cors: options.cors || { origin: true, credentials: true },
    ...options.socket,
  });
  const roomPresence = new Map();

  // Auth handshake — the ONLY place socket.user is set. A valid JWT in
  // `auth.token` becomes socket.user; connections without a token stay
  // anonymous (Guest flow, unchanged). An invalid token refuses the
  // handshake rather than silently downgrading identity.
  io.use((socket, next) => {
    try {
      const token = socket.handshake?.auth?.token;
      if (!token) return next();
      const decoded = verifyToken(token);
      socket.user = {
        id: decoded.sub,
        displayName: decoded.name,
        username: decoded.username ?? null,
        role: decoded.role ?? null,
      };
      return next();
    } catch {
      return next(new Error("Invalid or expired auth token"));
    }
  });

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
    const entry = {
      socketId: socket.id,
      userId: identity.id || payload.userId,
      displayName: identity.displayName || payload.displayName,
      roomId,
    };
    // Authenticated extras only — never from client-sent fields.
    if (identity.username) entry.username = identity.username;
    if (identity.role) entry.role = identity.role;
    users.push(entry);
    roomPresence.set(roomId, users);
  }

  /**
   * Server-enforced two-person lobby rule. Returns the rejection message
   * when the join must be refused, or null when it may proceed. Reads the
   * incoming role from socket.user only — a client-provided role field is
   * never trusted. Pure w.r.t. roomPresence (no mutation) so the caller
   * runs it before touching any room state.
   */
  function lobbyJoinRejection(roomId, incomingRole) {
    const occupants = roomPresence.get(roomId) || [];
    if (occupants.length >= LOBBY_CAPACITY) return LOBBY_FULL_MESSAGE;
    if (
      LOBBY_ROLES.includes(incomingRole) &&
      occupants.some((entry) => entry.role === incomingRole)
    ) {
      return LOBBY_FULL_MESSAGE;
    }
    return null;
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

        // Lobby capacity/role gate — before any room state changes, so a
        // rejected joiner keeps whatever room they were in. Uses the
        // existing connection:error event with a machine-readable code.
        if (isLobbyRoom(payload.roomId)) {
          const rejection = lobbyJoinRejection(payload.roomId, socket.user?.role);
          if (rejection) {
            sendError(socket, "room:join", rejection, "LOBBY_FULL");
            return;
          }
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

module.exports = { createSocketServer, isValidRoomId, isLobbyRoom };
