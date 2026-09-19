/**
 * socket.js — Integration Engineer (core integration)
 *
 * Singleton socket.io client. Exactly one connection per page, shared by
 * every collaboration hook — hooks must never call io() themselves.
 *
 * URL resolution: VITE_SYNCSPACE_SERVER_URL when set (production),
 * otherwise http://localhost:3000 (local `npm run dev:server`).
 */

import { io } from 'socket.io-client';

const SERVER_URL =
  (typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.VITE_SYNCSPACE_SERVER_URL) ||
  'http://localhost:3000';

let socket = null;
let authToken = null;

export function getSocket() {
  if (!socket) {
    socket = io(SERVER_URL, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      auth: authToken ? { token: authToken } : {},
    });
  }
  return socket;
}

/**
 * Auth handshake token for the socket connection. Applied to the shared
 * instance so the next (re)connect carries it in `auth.token`, where the
 * server middleware verifies it into socket.user. Null clears it back
 * to the anonymous Guest handshake.
 */
export function setSocketAuthToken(token) {
  authToken = token || null;
  if (socket) {
    socket.auth = authToken ? { token: authToken } : {};
  }
}

export function getSocketAuthToken() {
  return authToken;
}

/** Test/dev escape hatch — the app itself never needs this. */
export function resetSocketForTests() {
  try {
    socket?.disconnect();
  } catch {
    // ignore
  }
  socket = null;
}
