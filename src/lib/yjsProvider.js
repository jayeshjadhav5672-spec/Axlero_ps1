/**
 * yjsProvider.js — Shree (Yjs / CRDT collaboration)
 *
 * Room-scoped Y.Doc lifecycle. Exactly one Y.Doc per active roomId.
 * Room isolation is provided by the separate Y.Doc instance per roomId, not
 * by the Map container itself — the Map is just the lookup structure.
 *
 * Public API:
 *   getYDoc(roomId)     — return (or lazily create) the Y.Doc for a room
 *   destroyYDoc(roomId) — destroy and remove the Y.Doc for a room
 *   hasYDoc(roomId)     — check whether a Y.Doc is currently live
 *
 * Shared structure inside every Y.Doc:
 *   canvas   → Y.Array  — whiteboard shape JSON (same objects as today's shapes)
 *   code     → Y.Text   — collaborative code text; replaces the LWW relay
 *   metadata → Y.Map    — room-level key/value metadata (title, language, etc.)
 *
 * Phase boundary: this module is transport-agnostic. It does not touch
 * socket.js, socket events, or awareness. Those are Phase 2+ concerns.
 */

import * as Y from 'yjs';
import { isValidRoomId } from './room.js';

// One entry per active room: roomId → Y.Doc.
// The Map holds strong references — a Y.Doc is retained until destroyYDoc()
// or resetForTests() explicitly removes it. Callers own the lifecycle.
const _docs = new Map();

/**
 * Return the live Y.Doc for roomId, creating one if it does not exist yet.
 * Throws for invalid room IDs so callers fail loudly rather than silently
 * creating orphaned documents.
 */
export function getYDoc(roomId) {
  if (!isValidRoomId(roomId)) {
    throw new Error(`[yjsProvider] Invalid roomId "${roomId}". Must match /^[A-Za-z0-9_-]{1,64}$/`);
  }

  if (_docs.has(roomId)) {
    return _docs.get(roomId);
  }

  const doc = new Y.Doc();

  // Pre-initialize the shared structures so consumers can always access
  // them without checking for existence. The names are the canonical keys
  // documented in docs/INTEGRATION.md §3.
  doc.getArray('canvas');   // Y.Array — whiteboard shapes
  doc.getText('code');      // Y.Text  — code editor content
  doc.getMap('metadata');   // Y.Map   — room-level metadata

  _docs.set(roomId, doc);
  return doc;
}

/**
 * Destroy the Y.Doc for roomId and remove it from the registry.
 * Idempotent: calling on a room that has no live doc is a no-op.
 * Must be called when leaving a room so memory is reclaimed and the next
 * getYDoc() starts from a clean slate (important for room switching).
 */
export function destroyYDoc(roomId) {
  const doc = _docs.get(roomId);
  if (!doc) return;
  doc.destroy();
  _docs.delete(roomId);
}

/**
 * Return true if a Y.Doc is currently live for roomId.
 * Useful for guards in hooks that should not proceed before the doc exists.
 */
export function hasYDoc(roomId) {
  return _docs.has(roomId);
}

/**
 * Test/dev escape hatch — destroys every retained doc and clears the
 * registry so no cross-test state leaks. The app itself never calls this.
 */
export function resetForTests() {
  for (const doc of _docs.values()) {
    try { doc.destroy(); } catch { /* ignore */ }
  }
  _docs.clear();
}
