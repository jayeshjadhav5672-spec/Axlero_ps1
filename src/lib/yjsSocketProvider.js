/**
 * yjsSocketProvider.js — Shree (Yjs / CRDT collaboration), Phase 3
 *
 * Binds the Phase 1 room Y.Doc + Phase 3 room Awareness to the EXISTING
 * Socket.io room transport (Arun's server relay, `server/socket.cjs`).
 *
 * Contract (server change: "yjs:update" + "yjs:awareness" added to the
 * existing COLLABORATION_EVENTS allowlist — same validation, membership
 * enforcement, size cap and room routing as canvas/code/cursor updates):
 *
 *   emit   yjs:update    { roomId, data: { protocol, kind, update?, stateVector? } }
 *   emit   yjs:awareness { roomId, data: { protocol, kind: 'awareness', update } }
 *   kinds: 'update' (incremental doc update) | 'sync-request' (join bootstrap,
 *          carries requester's state vector) | 'sync-state' (diff reply) |
 *          'awareness' (ephemeral presence — never in the Y.Doc)
 *
 * Binary travels as base64 inside the JSON envelope so the server's
 * JSON size check and room routing keep working unchanged.
 *
 * Echo prevention: remote bytes are applied with ORIGIN_REMOTE; the local
 * doc/awareness update handlers skip anything carrying that origin, so a
 * received update is never rebroadcast. Local writes (incl. Phase 2 CRUD
 * with ORIGIN_LOCAL) emit exactly once.
 *
 * Room lifecycle reuse (no second room system): attach AFTER the existing
 * room:join flow (useRoomConnection), detach BEFORE/WITH room:leave. Socket
 * room membership itself stays owned by the existing code — this module
 * only owns Yjs listeners + awareness state.
 */

import * as Y from 'yjs';
import { encodeStateAsUpdate, encodeStateVector, applyUpdate } from 'yjs';
import { encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';
import { isValidRoomId } from './room.js';
import { getYDoc } from './yjsProvider.js';
import {
  getAwareness,
  destroyAwareness,
  resetAwarenessForTests,
  setLocalUser,
  setLocalPresence,
  removeLocalAwareness,
} from './yjsAwareness.js';

export const PROTOCOL = 'syncspace-yjs-1';
export const YJS_UPDATE_EVENT = 'yjs:update';
export const YJS_AWARENESS_EVENT = 'yjs:awareness';
/** Mapping-only event: registers this socket's awareness clientID per room
 * so the server can broadcast awareness removal on abrupt disconnect. */
export const YJS_HELLO_EVENT = 'yjs:hello';
/** Origin marking updates applied from the socket (never rebroadcast). */
export const ORIGIN_REMOTE = 'remote-socket';
export const ORIGIN_LOCAL_SYNC = 'local-socket';
/** Mirrors the server's MAX_PAYLOAD_BYTES for the whole JSON envelope. */
export const MAX_YJS_MESSAGE_BYTES = 256 * 1024;

const KINDS = new Set(['update', 'sync-request', 'sync-state', 'awareness']);

// roomId → attachment record (attach is idempotent per room).
const _attached = new Map();

/** Portable Uint8Array → base64 (browser + node, chunked for large updates). */
export function updateToBase64(update) {
  if (!(update instanceof Uint8Array)) return null;
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < update.length; i += CHUNK) {
    binary += String.fromCharCode(...update.subarray(i, i + CHUNK));
  }
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(binary, 'binary').toString('base64');
}

/** Portable base64 → Uint8Array. Null for malformed input. Size-capped. */
export function base64ToUpdate(base64, maxBytes = MAX_YJS_MESSAGE_BYTES) {
  if (typeof base64 !== 'string' || base64.length === 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return null;
  try {
    let binary;
    if (typeof atob === 'function') {
      binary = atob(base64);
    } else {
      binary = Buffer.from(base64, 'base64').toString('binary');
    }
    if (binary.length === 0 || binary.length > maxBytes) return null;
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * Structural validation for an inbound Yjs envelope (doc or awareness).
 * Returns the envelope on success, null on any violation — callers drop
 * invalid payloads without throwing and never rebroadcast them.
 */
export function isValidYjsEnvelope(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.protocol !== PROTOCOL) return null;
  if (typeof data.kind !== 'string' || !KINDS.has(data.kind)) return null;
  if (data.kind === 'sync-request') {
    if (typeof data.stateVector !== 'string') return null;
    return data;
  }
  if (typeof data.update !== 'string' || data.update.length === 0) return null;
  return data;
}

function emitEnvelope(socket, event, roomId, envelope) {
  try {
    if (!socket || socket.connected === false) return false;
    socket.emit(event, { roomId, data: envelope });
    return true;
  } catch {
    return false;
  }
}

/**
 * Attach Yjs sync for a room to an already-joined socket.
 * Idempotent: re-attaching returns the live attachment. Emits a
 * sync-request bootstrap immediately (peers answer with diffs).
 * `identity` ({ userId, displayName }) seeds local awareness user info.
 */
export function attachRoomSync({ socket, roomId, identity } = {}) {
  if (!socket || typeof socket.on !== 'function' || typeof socket.emit !== 'function') {
    throw new Error('[yjsSocketProvider] attachRoomSync requires a socket.io socket');
  }
  if (!isValidRoomId(roomId)) {
    throw new Error(`[yjsSocketProvider] Invalid roomId "${roomId}". Must match /^[A-Za-z0-9_-]{1,64}$/`);
  }
  if (_attached.has(roomId)) {
    const existing = _attached.get(roomId);
    if (existing.socket === socket) return existing;
    // Same room re-attached on a NEW socket object (e.g. client recreated
    // the socket after an abrupt disconnect): silently drop the old
    // listeners and rebind. The Awareness instance survives, so the client
    // keeps its clientID — reconnecting never creates duplicate entries.
    // No removal broadcast here: this client is still present.
    silentDetach(roomId);
  }

  const doc = getYDoc(roomId);
  const awareness = getAwareness(roomId);
  if (identity && (identity.userId || identity.displayName)) {
    setLocalUser(roomId, { id: identity.userId, name: identity.displayName });
  }
  if (!awareness.getLocalState()) setLocalPresence(roomId, 'online');

  const sendDocUpdate = (update) => {
    const b64 = updateToBase64(update);
    if (!b64 || b64.length > MAX_YJS_MESSAGE_BYTES) return false;
    return emitEnvelope(socket, YJS_UPDATE_EVENT, roomId, { protocol: PROTOCOL, kind: 'update', update: b64 });
  };

  const onDocUpdate = (update, origin) => {
    if (origin === ORIGIN_REMOTE) return;
    sendDocUpdate(update);
  };

  const onAwarenessUpdate = ({ added, updated, removed }, origin) => {
    if (origin === ORIGIN_REMOTE) return;
    const changed = [...added, ...updated, ...removed];
    if (changed.length === 0) return;
    let encoded;
    try {
      encoded = encodeAwarenessUpdate(awareness, changed);
    } catch {
      return;
    }
    const b64 = updateToBase64(encoded);
    if (!b64 || b64.length > MAX_YJS_MESSAGE_BYTES) return;
    emitEnvelope(socket, YJS_AWARENESS_EVENT, roomId, { protocol: PROTOCOL, kind: 'awareness', update: b64 });
  };

  const applyRemoteDocUpdate = (bytes) => {
    try {
      applyUpdate(doc, bytes, ORIGIN_REMOTE);
      return true;
    } catch {
      return false;
    }
  };

  const answerSyncRequest = (vectorBytes) => {
    let diff;
    try {
      diff = encodeStateAsUpdate(doc, vectorBytes);
    } catch {
      return;
    }
    if (!diff || diff.length === 0) return;
    const b64 = updateToBase64(diff);
    if (!b64 || b64.length > MAX_YJS_MESSAGE_BYTES) return;
    emitEnvelope(socket, YJS_UPDATE_EVENT, roomId, { protocol: PROTOCOL, kind: 'sync-state', update: b64 });
  };

  const onRemoteDocEvent = (payload) => {
    try {
      if (!payload || payload.roomId !== roomId) return;
      const envelope = isValidYjsEnvelope(payload.data);
      if (!envelope) return;
      if (envelope.kind === 'sync-request') {
        const vector = base64ToUpdate(envelope.stateVector);
        if (vector) answerSyncRequest(vector);
        return;
      }
      const bytes = base64ToUpdate(envelope.update);
      if (bytes) applyRemoteDocUpdate(bytes);
    } catch { /* never let a bad payload break the handler */ }
  };

  const onRemoteAwarenessEvent = (payload) => {
    try {
      if (!payload || payload.roomId !== roomId) return;
      const envelope = isValidYjsEnvelope(payload.data);
      if (!envelope || envelope.kind !== 'awareness') return;
      const bytes = base64ToUpdate(envelope.update);
      if (!bytes) return;
      try {
        applyAwarenessUpdate(awareness, bytes, ORIGIN_REMOTE);
      } catch { /* malformed awareness bytes — drop */ }
    } catch { /* never let a bad payload break the handler */ }
  };

  const requestSync = () => {
    let vector;
    try {
      vector = encodeStateVector(doc);
    } catch {
      return false;
    }
    const b64 = updateToBase64(vector);
    if (!b64) return false;
    return emitEnvelope(socket, YJS_UPDATE_EVENT, roomId, { protocol: PROTOCOL, kind: 'sync-request', stateVector: b64 });
  };

  const sendHello = () => emitEnvelope(socket, YJS_HELLO_EVENT, roomId, {
    protocol: PROTOCOL,
    kind: 'hello',
    clientId: awareness.clientID,
  });

  const onReconnect = () => {
    // Same socket object re-emits: refresh local awareness broadcast so
    // peers re-list us, re-register the hello mapping (the server drops it
    // with the old connection state), then re-request current state.
    try {
      const local = awareness.getLocalState();
      if (local) awareness.setLocalState({ ...local });
    } catch { /* ignore */ }
    sendHello();
    requestSync();
  };

  const onRoomJoined = (payload) => {
    // Existing room lifecycle (useRoomConnection) owns joining; hook into
    // it so hello + bootstrap survive the join/rejoin race on reconnect.
    if (!payload || payload.roomId !== roomId) return;
    sendHello();
    requestSync();
  };

  doc.on('update', onDocUpdate);
  awareness.on('update', onAwarenessUpdate);
  socket.on(YJS_UPDATE_EVENT, onRemoteDocEvent);
  socket.on(YJS_AWARENESS_EVENT, onRemoteAwarenessEvent);
  socket.on('connect', onReconnect);
  socket.on('room:joined', onRoomJoined);

  const attachment = {
    roomId,
    doc,
    awareness,
    socket,
    requestSync,
    sendHello,
    _onDocUpdate: onDocUpdate,
    _listeners: [
      [YJS_UPDATE_EVENT, onRemoteDocEvent],
      [YJS_AWARENESS_EVENT, onRemoteAwarenessEvent],
      ['connect', onReconnect],
      ['room:joined', onRoomJoined],
    ],
  };
  _attached.set(roomId, attachment);
  sendHello();
  requestSync();
  return attachment;
}

/** True iff Yjs sync is currently attached for the room. */
export function isRoomAttached(roomId) {
  return _attached.has(roomId);
}

/**
 * Drop an attachment's listeners WITHOUT broadcasting removal and WITHOUT
 * destroying Awareness. Used when rebinding the same room to a new socket
 * object (the client is still present — removal would wrongly evict it).
 */
function silentDetach(roomId) {
  const attachment = _attached.get(roomId);
  if (!attachment) return;
  _attached.delete(roomId);
  try {
    attachment.doc.off('update', attachment._onDocUpdate);
  } catch { /* ignore */ }
  if (attachment._listeners && attachment.socket && typeof attachment.socket.off === 'function') {
    for (const [event, handler] of attachment._listeners) {
      try {
        attachment.socket.off(event, handler);
      } catch { /* ignore */ }
    }
  }
}

/**
 * Detach Yjs sync for a room: broadcast local awareness removal (so peers
 * drop this client), remove all doc/socket listeners, destroy the room
 * Awareness. The Y.Doc itself is NOT destroyed (Phase 1 lifecycle owns it —
 * destroyYDoc on leave as before). Safe/idempotent.
 */
export function detachRoomSync(roomId) {
  const attachment = _attached.get(roomId);
  if (!attachment) return false;
  const { socket } = attachment;
  _attached.delete(roomId);
  try {
    // Removal broadcast goes out while listeners are still attached, so
    // peers drop this client from awareness.
    removeLocalAwareness(roomId, ORIGIN_LOCAL_SYNC);
  } catch { /* ignore */ }
  try {
    attachment.doc.off('update', attachment._onDocUpdate);
  } catch { /* ignore */ }
  if (attachment._listeners && socket && typeof socket.off === 'function') {
    for (const [event, handler] of attachment._listeners) {
      try {
        socket.off(event, handler);
      } catch { /* ignore */ }
    }
  }
  destroyAwareness(roomId);
  return true;
}

/**
 * Test/dev escape hatch — detach everything without network broadcast.
 * Does NOT destroy Y.Docs (use resetForTests) — docs are Phase 1 owned.
 */
export function resetSyncForTests() {
  for (const [roomId, attachment] of _attached.entries()) {
    try {
      if (attachment._listeners && attachment.socket && typeof attachment.socket.off === 'function') {
        for (const [event, handler] of attachment._listeners) {
          try {
            attachment.socket.off(event, handler);
          } catch { /* ignore */ }
        }
      }
      attachment.doc.off('update', attachment._onDocUpdate);
    } catch { /* ignore */ }
    _attached.delete(roomId);
  }
  resetAwarenessForTests();
}
