/**
 * handshake.cjs — Socket.IO handshake identity middleware factory.
 *
 * Verifies an optional handshake JWT into `socket.user` so presence/room
 * logic can attribute authenticated users. Guests (no token, invalid
 * token) connect exactly as before — authentication is additive and never
 * rejects the transport.
 *
 * Extracted as a unit so socket handshake attribution is covered by
 * automated tests against the real middleware (not a test-local copy).
 */

function createHandshakeMiddleware({ verifyToken } = {}) {
  if (typeof verifyToken !== "function") {
    throw new Error("createHandshakeMiddleware requires a verifyToken function.");
  }
  return function handshakeMiddleware(socket, next) {
    try {
      const token =
        socket && socket.handshake && socket.handshake.auth ? socket.handshake.auth.token : null;
      if (typeof token === "string" && token.trim().length > 0) {
        const payload = verifyToken(token);
        socket.user = {
          id: String(payload.sub),
          displayName: payload.displayName || payload.email || "Guest",
        };
      }
    } catch {
      // Invalid token: stay anonymous rather than refusing the connection.
    }
    return next();
  };
}

module.exports = { createHandshakeMiddleware };
