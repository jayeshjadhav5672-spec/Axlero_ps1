const { Server } = require("socket.io");

const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const COLLABORATION_EVENTS = ["canvas:update", "code:update", "cursor:update"];

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

module.exports = { createSocketServer, isValidRoomId };
