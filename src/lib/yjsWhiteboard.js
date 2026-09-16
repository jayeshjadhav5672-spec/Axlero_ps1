/**
 * yjsWhiteboard.js — Shree (Yjs / CRDT collaboration), Phase 2
 *
 * CRDT-safe collaborative whiteboard model on top of the Phase 1
 * room-scoped Y.Doc (see src/lib/yjsProvider.js).
 *
 * Model (per room Y.Doc):
 *   shapes → Y.Map   shapeId → Y.Map(properties)   (property-level CRDT)
 *   zOrder → Y.Array [shapeId, ...]                 (ordering only, no objects)
 *
 * Phase 1 structures (`canvas` Y.Array, `code` Y.Text, `metadata` Y.Map)
 * are intentionally left untouched.
 *
 * Shape schema: plain serializable objects owned by Sayon's whiteboard
 * (src/components/canvas/utils/shapes.js). Validation + JSON boundaries
 * reuse `isValidShape` / `serializeShape` so the whiteboard never needs to
 * understand Y.Map / Y.Array internals.
 *
 * Whiteboard callback parity (mirrors useWhiteboardState / collabOps ops):
 *   createShape(doc, shape)        ← onShapeCreate(shape)
 *   updateShape(doc, id, changes)  ← onShapeUpdate(shapeId, changes)
 *   deleteShape(doc, id)           ← onShapeDelete(shapeId)
 *   clearCanvas(doc)               ← onCanvasClear()
 *   setZOrder(doc, orderedIds)     ← onShapesReorder(nextShapes) order part
 *   getSharedShapes(doc)           → serializable array for the whiteboard
 *   subscribeToShapeChanges(doc, cb) → observer → whiteboard state
 *
 * Results follow the collabOps.js convention: functions return
 * `{ applied: boolean, ... }` and never throw for invalid input
 * (malformed ops are no-ops with a `reason`, never crashes).
 *
 * Loop safety: local writes run inside `doc.transact(fn, ORIGIN_LOCAL)`.
 * The subscriber receives `meta.local === true` for those, so a future
 * binding can apply remote state without writing it back into Yjs.
 * The subscriber itself is strictly read-only — it never mutates the doc.
 *
 * Transport-agnostic: multi-doc sync in tests uses Yjs state/update APIs
 * directly. No sockets, no awareness, no persistence here.
 */

import * as Y from 'yjs';
import { isValidShape, serializeShape } from '../components/canvas/utils/shapes.js';

export const SHAPES_KEY = 'shapes';
export const ZORDER_KEY = 'zOrder';

/** Transaction origin marking writes that came from the local whiteboard. */
export const ORIGIN_LOCAL = 'shree-yjs-local';

/** Lazily return (creating if needed) the room doc's shared shape registry. */
export function getShapesMap(doc) {
  return doc.getMap(SHAPES_KEY);
}

/** Lazily return (creating if needed) the room doc's shared z-order array. */
export function getZOrderArray(doc) {
  return doc.getArray(ZORDER_KEY);
}

function isDocLike(doc) {
  return !!doc && typeof doc.getMap === 'function' && typeof doc.getArray === 'function' && typeof doc.transact === 'function';
}

function isShapeIdLike(id) {
  return typeof id === 'string' && id.length > 0;
}

function isChangesLike(changes) {
  return !!changes && typeof changes === 'object' && !Array.isArray(changes) && Object.keys(changes).length > 0;
}

/** Plain-object snapshot of a shape Y.Map (JSON-safe; null when absent). */
function shapeMapToObject(shapeMap, shapeId) {
  if (!(shapeMap instanceof Y.Map)) return null;
  const out = {};
  for (const [key, value] of shapeMap.entries()) {
    out[key] = value;
  }
  let clean;
  try {
    clean = JSON.parse(JSON.stringify(out));
  } catch {
    return null;
  }
  if (typeof clean.id !== 'string' || clean.id.length === 0) clean.id = shapeId;
  return clean;
}

/**
 * Create a collaborative shape: one Y.Map per shapeId + id appended to
 * zOrder, all in a single transaction. Duplicate creates (same stable
 * shapeId re-delivered) are ignored — first writer wins, no duplicates.
 */
export function createShape(doc, shape) {
  if (!isDocLike(doc)) return { applied: false, reason: 'invalid-doc' };
  if (!isValidShape(shape)) return { applied: false, reason: 'invalid-shape' };
  const clean = serializeShape(shape);
  if (!clean) return { applied: false, reason: 'unserializable-shape' };

  const shapes = getShapesMap(doc);
  const shapeId = clean.id;
  if (shapes.has(shapeId)) return { applied: false, reason: 'duplicate-shape', shapeId, duplicate: true };

  doc.transact(() => {
    const shapeMap = new Y.Map();
    for (const [key, value] of Object.entries(clean)) {
      if (value !== undefined) shapeMap.set(key, value);
    }
    shapes.set(shapeId, shapeMap);
    const zOrder = getZOrderArray(doc);
    if (!zOrder.toArray().includes(shapeId)) zOrder.push([shapeId]);
  }, ORIGIN_LOCAL);

  return { applied: true, shapeId };
}

/**
 * Granular property update: only the supplied keys are set on the shape's
 * Y.Map — the shape object is never replaced. Unknown shapes and empty /
 * malformed changes are safe no-ops. The `id` key is immutable and ignored.
 */
export function updateShape(doc, shapeId, changes) {
  if (!isDocLike(doc)) return { applied: false, reason: 'invalid-doc' };
  if (!isShapeIdLike(shapeId)) return { applied: false, reason: 'invalid-shape-id' };
  if (!isChangesLike(changes)) return { applied: false, reason: 'empty-changes' };

  const shapes = getShapesMap(doc);
  const shapeMap = shapes.get(shapeId);
  if (!(shapeMap instanceof Y.Map)) return { applied: false, reason: 'unknown-shape', shapeId };

  let clean;
  try {
    clean = JSON.parse(JSON.stringify(changes));
  } catch {
    return { applied: false, reason: 'unserializable-changes' };
  }
  const entries = Object.entries(clean).filter(([key, value]) => key !== 'id' && value !== undefined);
  if (entries.length === 0) return { applied: false, reason: 'empty-changes' };

  const updated = [];
  doc.transact(() => {
    for (const [key, value] of entries) {
      shapeMap.set(key, value);
      updated.push(key);
    }
  }, ORIGIN_LOCAL);

  return { applied: true, shapeId, updated };
}

/**
 * Delete a collaborative shape: removed from the shapes registry AND from
 * zOrder in one transaction. Deleting an absent shape is a safe no-op.
 */
export function deleteShape(doc, shapeId) {
  if (!isDocLike(doc)) return { applied: false, reason: 'invalid-doc' };
  if (!isShapeIdLike(shapeId)) return { applied: false, reason: 'invalid-shape-id' };

  const shapes = getShapesMap(doc);
  if (!shapes.has(shapeId)) return { applied: false, reason: 'unknown-shape', shapeId };

  doc.transact(() => {
    shapes.delete(shapeId);
    const zOrder = getZOrderArray(doc);
    const idx = zOrder.toArray().indexOf(shapeId);
    if (idx !== -1) zOrder.delete(idx, 1);
  }, ORIGIN_LOCAL);

  return { applied: true, shapeId };
}

/**
 * Remove every collaborative shape (registry + z-order) in one
 * transaction. Mirrors the whiteboard's onCanvasClear().
 */
export function clearCanvas(doc) {
  if (!isDocLike(doc)) return { applied: false, reason: 'invalid-doc' };
  const shapes = getShapesMap(doc);
  const zOrder = getZOrderArray(doc);
  if (shapes.size === 0 && zOrder.length === 0) return { applied: false, reason: 'already-empty' };
  const cleared = shapes.size;
  doc.transact(() => {
    shapes.clear();
    if (zOrder.length > 0) zOrder.delete(0, zOrder.length);
  }, ORIGIN_LOCAL);
  return { applied: true, cleared };
}

/**
 * Replace z-order wholesale (undo/redo restore path — mirrors the
 * `reorder` op in collabOps.js). Only ids present in the shapes registry
 * are kept, in the requested order; known ids missing from the request are
 * appended in current relative order so no shape is ever lost. Shape
 * properties are untouched — ordering lives only in the array.
 */
export function setZOrder(doc, orderedIds) {
  if (!isDocLike(doc)) return { applied: false, reason: 'invalid-doc' };
  if (!Array.isArray(orderedIds)) return { applied: false, reason: 'invalid-order' };

  const shapes = getShapesMap(doc);
  const zOrder = getZOrderArray(doc);
  const current = zOrder.toArray();
  const known = new Set([...shapes.keys()]);
  const seen = new Set();
  const next = [];
  for (const id of orderedIds) {
    if (typeof id !== 'string' || !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  for (const id of current) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      next.push(id);
    }
  }
  // Brand-new registry entries with no z-order presence yet (e.g. written
  // by a foreign client straight into the map): append in registry order.
  for (const id of known) {
    if (!seen.has(id)) {
      seen.add(id);
      next.push(id);
    }
  }

  if (JSON.stringify(next) === JSON.stringify(current)) {
    return { applied: false, reason: 'unchanged', zOrder: current };
  }
  doc.transact(() => {
    if (zOrder.length > 0) zOrder.delete(0, zOrder.length);
    if (next.length > 0) zOrder.push(next);
  }, ORIGIN_LOCAL);
  return { applied: true, zOrder: next };
}

/**
 * Serializable snapshot for the whiteboard: shapes in z-order, then any
 * registry entries missing from z-order (orphan-tolerant), skipping
 * z-order ids with no registry entry (tombstone-tolerant) and entries
 * that fail shape validation. Never exposes Yjs internals.
 */
export function getSharedShapes(doc) {
  if (!isDocLike(doc)) return [];
  const shapes = getShapesMap(doc);
  const zOrder = getZOrderArray(doc);
  const out = [];
  const seen = new Set();
  for (const id of zOrder.toArray()) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const obj = shapeMapToObject(shapes.get(id), id);
    if (obj && isValidShape(obj)) out.push(obj);
  }
  for (const [id, shapeMap] of shapes.entries()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const obj = shapeMapToObject(shapeMap, id);
    if (obj && isValidShape(obj)) out.push(obj);
  }
  return out;
}

/**
 * Observe shapes + zOrder. The callback receives
 * `(serializableShapes, meta)` with `meta = { local }` — `local` is true
 * when the change originated from this client's own CRUD calls
 * (ORIGIN_LOCAL) so a binding can skip echoing its own state back.
 *
 * The subscriber is strictly read-only: repeat notifications for one
 * transaction are collapsed (identical JSON content is not re-emitted),
 * and it never writes to the doc — synchronization loops are impossible
 * by construction. Returns an unsubscribe function.
 */
export function subscribeToShapeChanges(doc, callback) {
  if (!isDocLike(doc)) throw new Error('[yjsWhiteboard] subscribeToShapeChanges requires a Y.Doc-like object');
  if (typeof callback !== 'function') throw new Error('[yjsWhiteboard] subscribeToShapeChanges requires a callback function');

  const shapes = getShapesMap(doc);
  const zOrder = getZOrderArray(doc);
  let lastJson = null;

  const notify = (transaction) => {
    const origin = transaction ? transaction.origin : null;
    const snapshot = getSharedShapes(doc);
    let json;
    try {
      json = JSON.stringify(snapshot);
    } catch {
      return;
    }
    if (json === lastJson) return;
    lastJson = json;
    callback(snapshot, { local: origin === ORIGIN_LOCAL, origin: origin ?? null });
  };

  const onShapesDeep = (_events, transaction) => notify(transaction);
  const onZOrder = (_event, transaction) => notify(transaction);
  shapes.observeDeep(onShapesDeep);
  zOrder.observe(onZOrder);

  return () => {
    try {
      shapes.unobserveDeep(onShapesDeep);
    } catch { /* ignore */ }
    try {
      zOrder.unobserve(onZOrder);
    } catch { /* ignore */ }
  };
}
