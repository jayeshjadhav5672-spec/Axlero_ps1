/**
 * socket.js — Integration Engineer (core integration)
 *
 * Singleton socket.io client. Exactly one connection per page, shared by
 * every collaboration hook — hooks must never call io() themselves.
 *
 * URL resolution: VITE_WS_URL when set (production / CI), otherwise
 * VITE_BACKEND_URL when set (production / CI),
 * then VITE_SYNCSPACE_SERVER_URL (legacy alias),
 * otherwise http://localhost:3000 (local `npm run dev:server`).
 */

import { io } from 'socket.io-client';

function normalizeSocketUrl(url) {
  // socket.io-client speaks http(s) (it upgrades to WebSocket itself), so
  // map documented ws(s):// overrides to their http(s) equivalents.
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (/^wss:\/\//i.test(trimmed)) return `https://${trimmed.slice(6)}`;
  if (/^ws:\/\//i.test(trimmed)) return `http://${trimmed.slice(5)}`;
  return trimmed;
}

function resolveServerUrl() {
  try {
    const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
    const raw =
      env.VITE_WS_URL ||
      env.VITE_BACKEND_URL ||
      env.VITE_SYNCSPACE_SERVER_URL ||
      'http://localhost:3000';
    return normalizeSocketUrl(raw) || 'http://localhost:3000';
  } catch {
    return 'http://localhost:3000';
  }
}

const SERVER_URL = resolveServerUrl();

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(SERVER_URL, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 10000,
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
