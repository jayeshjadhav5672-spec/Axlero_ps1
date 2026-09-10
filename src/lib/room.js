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
 * Vaishnavi's auth will replace the displayName/userId source; callers
 * already pass identity through, so the swap is contained here.
 */
export function getOrCreateIdentity() {
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
    return {
      id: String(id),
      name: entry?.displayName || 'Guest',
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
