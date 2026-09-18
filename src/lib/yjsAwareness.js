/**
 * yjsAwareness.js — Shree (Yjs / CRDT collaboration), Phase 3
 *
 * Room-scoped Yjs Awareness (ephemeral presence: user / cursor / selection).
 * Awareness NEVER touches the persistent Y.Doc structures (`shapes`,
 * `zOrder`, `code`, `metadata`) — it travels on its own channel
 * (see yjsSocketProvider.js).
 *
 * Identity reuse (no duplicate identity logic):
 *   user id    ← getOrCreateIdentity().userId (room.js, owned by integrator)
 *   user name  ← getOrCreateIdentity().displayName
 *   user color ← colorForId(userId) (same palette as presenceToUsers)
 *
 * UI shape compatibility: getConnectedUsers() returns entries shaped like
 * presenceToUsers() output ({ id, name, color, isActive }) plus cursor /
 * selection, so Avantee's UI can consume awareness without learning Yjs.
 *
 * Transport-agnostic: encode/apply helpers wrap y-protocols; the socket
 * provider moves the bytes. Invalid input is rejected safely (never throws
 * into socket handlers for remote data).
 */

import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { isValidRoomId, getOrCreateIdentity, colorForId } from './room.js';
import { getYDoc } from './yjsProvider.js';

/** Hard cap for a single awareness field blob (mirrors server payload cap). */
export const MAX_AWARENESS_FIELD_BYTES = 64 * 1024;

// clientId → not used; registry is roomId → Awareness.
const _awareness = new Map();

function isPlainJsonObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function sanitizeString(value, fallback = '') {
  return typeof value === 'string' ? value.slice(0, 256) : fallback;
}

function sanitizeField(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 4096);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (isPlainJsonObject(value)) {
    try {
      const json = JSON.stringify(value);
      if (json.length > MAX_AWARENESS_FIELD_BYTES) return null;
      return JSON.parse(json);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    try {
      const json = JSON.stringify(value);
      if (json.length > MAX_AWARENESS_FIELD_BYTES) return null;
      return JSON.parse(json);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Return the live Awareness for a room, creating one bound to the room's
 * Phase 1 Y.Doc on first call. Throws for invalid room IDs (same rule as
 * the document provider).
 */
export function getAwareness(roomId) {
  if (!isValidRoomId(roomId)) {
    throw new Error(`[yjsAwareness] Invalid roomId "${roomId}". Must match /^[A-Za-z0-9_-]{1,64}$/`);
  }
  if (!_awareness.has(roomId)) {
    _awareness.set(roomId, new Awareness(getYDoc(roomId)));
  }
  return _awareness.get(roomId);
}

/** True iff a live Awareness exists for the room. */
export function hasAwareness(roomId) {
  return _awareness.has(roomId);
}

/**
 * Destroy the room's Awareness (timers + listeners) and drop it from the
 * registry. Call on room leave AFTER broadcasting local removal so peers
 * stop listing this client. Safe/idempotent.
 */
export function destroyAwareness(roomId) {
  const awareness = _awareness.get(roomId);
  if (!awareness) return;
  try {
    awareness.destroy();
  } catch { /* ignore */ }
  _awareness.delete(roomId);
}

/** Test/dev escape hatch — destroys every Awareness (timers included). */
export function resetAwarenessForTests() {
  for (const awareness of _awareness.values()) {
    try {
      awareness.destroy();
    } catch { /* ignore */ }
  }
  _awareness.clear();
}

function setLocalField(roomId, field, value) {
  const awareness = getAwareness(roomId);
  const current = awareness.getLocalState() || {};
  const clean = sanitizeField(value);
  // null clears the field (cursor/selection leave); undefined-ish invalid
  // values are dropped without clobbering existing state.
  if (clean === null && value !== null) return false;
  awareness.setLocalState({ ...current, [field]: clean });
  return true;
}

/**
 * Seed local user info. Defaults come from the repo's shared identity
 * (getOrCreateIdentity) so no second identity system is introduced.
 * Pass explicit values to override (e.g. tests).
 */
export function setLocalUser(roomId, { id, name, color } = {}) {
  let identity = null;
  try {
    identity = getOrCreateIdentity();
  } catch {
    identity = null;
  }
  const userId = sanitizeString(id ?? identity?.userId, '');
  if (!userId) return false;
  const user = {
    id: userId,
    name: sanitizeString(name ?? identity?.displayName, 'Guest'),
    color: sanitizeString(color ?? colorForId(userId), '#0f766e'),
  };
  return setLocalField(roomId, 'user', user);
}

/** Local presence status, e.g. "online" | "away". Defaults to "online". */
export function setLocalPresence(roomId, presence = 'online') {
  return setLocalField(roomId, 'presence', sanitizeString(presence, 'online') || 'online');
}

/** Local cursor ({ x, y, ... }) or null to clear. Invalid → ignored. */
export function setLocalCursor(roomId, cursor) {
  if (cursor !== null && !isPlainJsonObject(cursor)) return false;
  return setLocalField(roomId, 'cursor', cursor);
}

/** Local selection (array of shapeIds) or null to clear. Invalid → ignored. */
export function setLocalSelection(roomId, selection) {
  if (selection !== null && !Array.isArray(selection)) return false;
  if (Array.isArray(selection) && !selection.every((id) => typeof id === 'string')) return false;
  return setLocalField(roomId, 'selection', selection);
}

/** Raw local awareness state (null until first setLocal* call). */
export function getLocalState(roomId) {
  return getAwareness(roomId).getLocalState() || null;
}

/** This client's awareness clientID (equals the room doc's clientID). */
export function getLocalClientId(roomId) {
  return getAwareness(roomId).clientID;
}

function sanitizeRemoteUser(raw) {
  if (!isPlainJsonObject(raw)) return { id: '', name: 'Guest', color: '#0f766e' };
  const id = typeof raw.id === 'string' ? raw.id.slice(0, 256) : '';
  return {
    id,
    name: sanitizeString(raw.name, 'Guest') || 'Guest',
    color: sanitizeString(raw.color, id ? colorForId(id) : '#0f766e') || '#0f766e',
  };
}

/**
 * Connected users for UI lists — shaped like presenceToUsers() output
 * ({ clientId, id, name, color, presence, self, isActive }), including the
 * local client (same as server presence, which includes self). Null/remote
 * states are skipped; malformed user blobs get safe fallbacks.
 */
export function getConnectedUsers(roomId) {
  const awareness = getAwareness(roomId);
  const out = [];
  for (const [clientId, state] of awareness.getStates().entries()) {
    if (!state) continue;
    const user = sanitizeRemoteUser(state.user);
    out.push({
      clientId,
      id: user.id,
      name: user.name,
      color: user.color,
      presence: typeof state.presence === 'string' ? state.presence : 'online',
      self: clientId === awareness.clientID,
      isActive: true,
    });
  }
  return out;
}

/**
 * Remote cursors/selections for canvas overlays. Local client excluded
 * (you don't need your own cursor echoed). Entries without a cursor AND
 * without a selection are skipped.
 */
export function getRemoteCursors(roomId) {
  const awareness = getAwareness(roomId);
  const out = [];
  for (const [clientId, state] of awareness.getStates().entries()) {
    if (!state || clientId === awareness.clientID) continue;
    const cursor = state.cursor !== undefined ? sanitizeField(state.cursor) : null;
    const selection = Array.isArray(state.selection)
      ? state.selection.filter((id) => typeof id === 'string').slice(0, 1024)
      : null;
    if (cursor === null && selection === null) continue;
    const user = sanitizeRemoteUser(state.user);
    out.push({ clientId, id: user.id, name: user.name, color: user.color, cursor, selection });
  }
  return out;
}

/**
 * Snapshot for UI subscribers: { users, cursors } via the two getters.
 * Pure read — safe to call from any observer.
 */
export function getAwarenessSnapshot(roomId) {
  return { users: getConnectedUsers(roomId), cursors: getRemoteCursors(roomId) };
}

/**
 * Subscribe to awareness changes. Callback receives getAwarenessSnapshot().
 * Strictly read-only — never writes, so no feedback loops. Returns
 * unsubscribe. Remote-origin info is not needed here (all awareness states
 * are symmetric), so only the snapshot is passed.
 */
export function subscribeToAwareness(roomId, callback) {
  const awareness = getAwareness(roomId);
  if (typeof callback !== 'function') throw new Error('[yjsAwareness] subscribeToAwareness requires a callback function');
  const handler = () => {
    callback(getAwarenessSnapshot(roomId));
  };
  awareness.on('update', handler);
  return () => {
    try {
      awareness.off('update', handler);
    } catch { /* ignore */ }
  };
}

/**
 * Encode an awareness update for transport. clientIds defaults to all
 * known clients. Returns Uint8Array or null when there is nothing to send.
 */
export function encodeAwarenessUpdateFor(roomId, clientIds) {
  const awareness = getAwareness(roomId);
  const ids = Array.isArray(clientIds) ? clientIds.filter((id) => Number.isInteger(id)) : [...awareness.getStates().keys()];
  if (ids.length === 0) return null;
  try {
    return encodeAwarenessUpdate(awareness, ids);
  } catch {
    return null;
  }
}

/**
 * Apply a received awareness update. Returns true on success, false for
 * malformed data (never throws into socket handlers). `origin` is
 * forwarded so the transport layer can skip re-emitting remote updates.
 */
export function applyAwarenessUpdateTo(roomId, update, origin) {
  if (!(update instanceof Uint8Array) || update.length === 0 || update.length > MAX_AWARENESS_FIELD_BYTES * 4) return false;
  try {
    applyAwarenessUpdate(getAwareness(roomId), update, origin);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove the local client's awareness state (leave/disconnect path).
 * Broadcast the resulting update via the normal awareness 'update' channel
 * BEFORE destroying (the socket provider emits it, then cleans up).
 */
export function removeLocalAwareness(roomId, origin) {
  if (!_awareness.has(roomId)) return false;
  try {
    removeAwarenessStates(getAwareness(roomId), [getAwareness(roomId).clientID], origin);
    return true;
  } catch {
    return false;
  }
}
