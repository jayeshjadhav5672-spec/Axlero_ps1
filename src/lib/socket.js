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

export function getSocket() {
  if (!socket) {
    socket = io(SERVER_URL, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 2,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 3000,
    });
  }
  return socket;
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
