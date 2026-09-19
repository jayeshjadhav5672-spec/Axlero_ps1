/**
 * room.js — Integration Engineer (core integration)
 *
 * Room + identity helpers. No React, no networking — safe to import from
 * tests. The ROOM_PATTERN intentionally mirrors the backend
 * (server/socket.cjs) so invalid ids fail fast client-side with the same rule.
 */

export const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const DEFAULT_ROOM_ID = 'lobby';
export const IDENTITY_STORAGE_KEY = 'syncspace:identity';
export const AUTH_STORAGE_KEY = 'syncspace:auth';

const PRESENCE_PALETTE = [
  '#0f766e',
  '#4f46e5',
  '#059669',
  '#d97706',
  '#e11d48',
  '#0284c7',
  '#7c3aed',
  '#db2777',
];

export function isValidRoomId(roomId) {
  return typeof roomId === 'string' && ROOM_PATTERN.test(roomId);
}

/** Room id from `?room=`; falls back to DEFAULT_ROOM_ID when absent/invalid. */
export function getRoomIdFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (isValidRoomId(room)) return room;
  } catch {
    // non-browser (tests) — fall through to default
  }
  return DEFAULT_ROOM_ID;
}

function randomIdentity() {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return { userId: `user-${Math.random().toString(36).slice(2, 10)}`, displayName: `Guest-${suffix}` };
}

/**
 * Stable per-browser identity, persisted in localStorage.
 *
 * Authenticated users defer to their account identity (from the stored
 * auth session) when a valid, unexpired token exists; everyone else
 * falls back to the random Guest flow, which keeps working unchanged.
 */
export function getOrCreateIdentity() {
  const authed = getAuthenticatedIdentity();
  if (authed) return authed;
  try {
    const raw = localStorage.getItem(IDENTITY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.userId === 'string' &&
        parsed.userId.length > 0 &&
        typeof parsed.displayName === 'string' &&
        parsed.displayName.length > 0
      ) {
        return { userId: parsed.userId, displayName: parsed.displayName };
      }
    }
    const fresh = randomIdentity();
    localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  } catch {
    return randomIdentity();
  }
}

/**
 * Stored auth session shape: { token, user } where user is
 * { id, name, email, username, role }. Written at login/signup, cleared
 * at logout. Never holds passwords or secrets beyond the JWT itself.
 */
export function getStoredAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.token !== 'string' || !parsed.token || !parsed.user) return null;
    return { token: parsed.token, user: parsed.user };
  } catch {
    return null;
  }
}

export function setStoredAuth(session) {
  try {
    if (!session?.token || !session?.user) return;
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token: session.token, user: session.user }));
  } catch {
    // storage unavailable — session simply won't persist
  }
}

export function clearStoredAuth() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function isTokenFresh(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.exp !== 'number') return true;
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

/**
 * Account identity when a valid (unexpired) token exists, else null.
 * Carries the authenticated userId/displayName the socket layer and
 * presence mapping consume; extra fields (username, role) ride along
 * for the profile and lobby-role checks.
 */
export function getAuthenticatedIdentity() {
  const session = getStoredAuth();
  if (!session || !isTokenFresh(session.token)) return null;
  const user = session.user;
  if (!user || (typeof user.id !== 'string' && typeof user.id !== 'number')) return null;
  const displayName =
    (typeof user.username === 'string' && user.username.trim()) ||
    (typeof user.name === 'string' && user.name.trim()) ||
    null;
  if (!displayName) return null;
  return {
    userId: String(user.id),
    displayName,
    username: user.username ?? null,
    role: user.role ?? null,
  };
}

/** Deterministic avatar color for a presence id (stable across renders). */
export function colorForId(id) {
  const key = String(id ?? '');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return PRESENCE_PALETTE[hash % PRESENCE_PALETTE.length];
}

/**
 * Map Arun's presence entries [{ socketId, userId, displayName }]
 * to Avantee's PresenceList shape [{ id, name, color, isActive }].
 */
export function presenceToUsers(presence) {
  if (!Array.isArray(presence)) return [];
  return presence.map((entry) => {
    const id = entry?.userId || entry?.socketId || 'unknown';
    const rawName = typeof entry?.displayName === 'string' ? entry.displayName.trim() : '';
    return {
      id: String(id),
      name: rawName || '?',
      color: colorForId(id),
      isActive: true,
    };
  });
}

/** Shareable URL for a room (used by the invite/copy-link button). */
export function buildRoomUrl(roomId) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    return url.toString();
  } catch {
    return `?room=${roomId}`;
  }
}

/**
 * Frontend-only room id generator for the Dashboard "Create New Room"
 * action. No backend involved: ids only need to satisfy the shared
 * ROOM_PATTERN (mirrored by server/socket.cjs); the realtime layer owns
 * actual room creation/joining on `room:join`.
 */
export function generateRoomId() {
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  const time = Date.now().toString(36).slice(-4);
  return `room-${time}-${rand}`;
}

/**
 * Browser-local recent rooms (Dashboard display only — NOT backend
 * persistence, NOT shared across devices). Stored as a JSON string array
 * under RECENT_ROOMS_STORAGE_KEY, most-recent first, capped at
 * RECENT_ROOMS_LIMIT. All access is try/catch guarded so non-browser
 * environments (tests) safely fall back to memory/empty.
 */
export const RECENT_ROOMS_STORAGE_KEY = 'syncspace:recent-rooms';
export const RECENT_ROOMS_LIMIT = 8;

function readRecentRoomsRaw() {
  try {
    const raw = localStorage.getItem(RECENT_ROOMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Validated recent room ids, most-recent first (browser-local only). */
export function getRecentRooms() {
  const seen = new Set();
  const rooms = [];
  for (const entry of readRecentRoomsRaw()) {
    const id = typeof entry === 'string' ? entry : entry?.roomId;
    if (!isValidRoomId(id) || seen.has(id)) continue;
    seen.add(id);
    rooms.push(id);
    if (rooms.length >= RECENT_ROOMS_LIMIT) break;
  }
  return rooms;
}

/** Prepend a room id to the browser-local recent list (dedupe + cap). */
export function recordRecentRoom(roomId) {
  if (!isValidRoomId(roomId)) return getRecentRooms();
  const next = [roomId, ...getRecentRooms().filter((id) => id !== roomId)].slice(0, RECENT_ROOMS_LIMIT);
  try {
    localStorage.setItem(RECENT_ROOMS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable (private mode/tests) — caller still gets the list
  }
  return next;
}

/** Most-recent browser-local room id, or null when none is stored. */
export function getLastRoom() {
  return getRecentRooms()[0] ?? null;
}

/**
 * Address-bar hygiene for the Dashboard ↔ Workspace views (no navigation).
 * Pure string in/out so they stay unit-testable without a browser:
 * - urlForDashboardView(href): drop `?room=` so a reload/bookmark of the
 *   Dashboard opens the Dashboard, not the last room. Other params and
 *   the hash are preserved.
 * - urlForWorkspaceView(href, roomId): stamp a valid `?room=` so a refresh
 *   while in the Workspace stays in the same room. Invalid ids leave the
 *   URL untouched.
 */
export function urlForDashboardView(href) {
  try {
    const url = new URL(href);
    url.searchParams.delete('room');
    return url.toString();
  } catch {
    return href;
  }
}

export function urlForWorkspaceView(href, roomId) {
  try {
    if (!isValidRoomId(roomId)) return href;
    const url = new URL(href);
    url.searchParams.set('room', roomId);
    return url.toString();
  } catch {
    return href;
  }
}

/**
 * Entry state for the Landing → Dashboard flow (MEDIUM-1 reload fix).
 *
 * First visit to a room-free URL shows Landing; once the user enters the
 * app, a session-scoped flag is set so a reload of a room-free URL
 * restores the Dashboard instead of Landing. sessionStorage is used so
 * the flag survives reloads in the same tab but a fresh tab/window
 * still starts on Landing. Direct room URLs (`?room=…`) always bypass
 * Landing regardless of this flag.
 *
 * All access is try/catch guarded so non-browser environments (tests,
 * private mode) safely fall back to "not entered".
 */
export const ENTERED_APP_STORAGE_KEY = 'syncspace:entered-app';

export function hasEnteredApp() {
  try {
    return sessionStorage.getItem(ENTERED_APP_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markEnteredApp() {
  try {
    sessionStorage.setItem(ENTERED_APP_STORAGE_KEY, '1');
  } catch {
    // storage unavailable — view state is unaffected
  }
}

/**
 * Pure entry-view decision, unit-testable without a browser:
 * a valid `?room=` never shows Landing; otherwise Landing shows only
 * before the user has entered the app in this session.
 */
export function shouldShowLanding(hasRoom, entered) {
  if (hasRoom) return false;
  return !entered;
}
