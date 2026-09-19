import { isFiniteNum } from './shapes.js';
import { toFlatPoints } from './strokeStream.js';

/**
 * liveSync.js — pure helpers for universal real-time collaborative sync.
 * No Konva / socket deps; safe to import from tests.
 *
 * Two channel classes (relayed by `server/socket.cjs` LIVE_COLLAB_EVENTS):
 * - Ephemeral peer-to-peer streams (high-frequency, never persisted):
 *   `shape:preview-progress` { draftId, shape } — live creation-drag
 *   previews for EVERY tool (rect, circle, diamond, arrow, line, frame;
 *   pen keeps its dedicated `draw:stroke-*` points channel),
 *   `shape:preview-cancel` { draftId } — cancelled/degenerate drag,
 *   `cursor:move` { x, y, user?, tool? }, `eraser:trail` { eraserId, points }.
 * - Committed mutations (persisted; sender already applied locally):
 *   `shapes:commit` { shape }, `shapes:delete` { shapeIds|shapeId },
 *   `shapes:update-batch` { shapes }, `canvas:clear` ({}), 
 *   `canvas:history-sync` { shapes }.
 *
 * Preview lifecycle on peers: progress upserts a `remotePreview`-flagged
 * shape into renderShapes; cancel (or the authoritative committed op,
 * deduped by id) removes it. Committed ops keep flowing through the
 * existing `canvas:update` channel — these validators cover peers that
 * speak the unified protocol directly.
 */

export const LIVE_SYNC_INTERVAL_MS = 35;
export const LIVE_PREVIEW_EVENTS = ['shape:preview-progress', 'shape:preview-cancel'];
export const LIVE_COMMIT_EVENTS = ['shapes:commit', 'shapes:delete', 'shapes:update-batch', 'canvas:clear', 'canvas:history-sync'];
export const SELECTION_EVENT = 'collab:selection';
export const MAX_PREVIEW_JSON = 64 * 1024;
export const MAX_BATCH_SHAPES = 500;
/** Peer selections older than this are expired (no explicit leave event). */
export const SELECTION_STALE_MS = 30000;

function isIdString(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= 128;
}

function jsonSizeOk(value, cap) {
  try {
    return JSON.stringify(value).length <= cap;
  } catch {
    return false;
  }
}

function cleanShapeDescriptor(shape) {
  if (!shape || typeof shape !== 'object') return null;
  if (typeof shape.id !== 'string' || !shape.id) return null;
  if (typeof shape.type !== 'string' || !shape.type) return null;
  let clean;
  try {
    clean = JSON.parse(JSON.stringify(shape));
  } catch {
    return null;
  }
  // Points-like payloads always normalize to flat finite pairs so the
  // renderer can never receive a shape Konva silently refuses to paint.
  if (clean.points !== undefined) clean.points = toFlatPoints(clean.points);
  return clean;
}

/** Build a throttled creation-preview payload from the in-flight draft. */
export function buildPreviewProgressPayload({ draftId, shape }) {
  if (!isIdString(draftId)) return null;
  const clean = cleanShapeDescriptor(shape);
  if (!clean) return null;
  if (!jsonSizeOk({ draftId, shape: clean }, MAX_PREVIEW_JSON)) return null;
  return { draftId, shape: clean };
}

/** Validate inbound `shape:preview-progress` data. */
export function isValidPreviewProgress(data) {
  if (!data || typeof data !== 'object') return false;
  if (!isIdString(data.draftId)) return false;
  const clean = cleanShapeDescriptor(data.shape);
  if (!clean) return false;
  return jsonSizeOk({ draftId: data.draftId, shape: clean }, MAX_PREVIEW_JSON);
}

/** Validate inbound `cursor:move` data { x, y, user?, tool?}. Mirrors the server length caps. */
export function isValidCursorMove(data) {
  if (!data || typeof data !== 'object') return false;
  if (!isFiniteNum(data.x) || !isFiniteNum(data.y)) return false;
  if (data.user !== undefined && (typeof data.user !== 'string' || data.user.length > 128)) return false;
  if (data.tool !== undefined && (typeof data.tool !== 'string' || data.tool.length > 32)) return false;
  return true;
}

/** Validate inbound `eraser:trail` data { eraserId, points }. */
export function isValidEraserTrail(data) {
  if (!data || typeof data !== 'object') return false;
  if (!isIdString(data.eraserId)) return false;
  if (!Array.isArray(data.points) || data.points.length > 5000) return false;
  return data.points.every((v) => isFiniteNum(v));
}

/**
 * Convert a validated preview payload into a renderable shape, flagged
 * `remotePreview` (non-interactive; skipped by stores/exports) with the
 * Konva keys a sparse descriptor might omit backfilled.
 */
export function previewToShape(data, actorId = null) {
  const clean = cleanShapeDescriptor(data?.shape) ?? {
    id: data?.draftId,
    type: 'freehand',
    x: 0,
    y: 0,
    points: [],
  };
  if (typeof clean.stroke !== 'string' || !clean.stroke) clean.stroke = '#1e1e1e';
  if (!isFiniteNum(clean.strokeWidth) || clean.strokeWidth <= 0) clean.strokeWidth = 2;
  if (!isFiniteNum(clean.opacity)) clean.opacity = 1;
  if (!isFiniteNum(clean.x)) clean.x = 0;
  if (!isFiniteNum(clean.y)) clean.y = 0;
  if (!isFiniteNum(clean.rotation)) clean.rotation = 0;
  return { ...clean, remotePreview: true, previewActorId: actorId, receivedAt: Date.now() };
}

/**
 * Pure reducer for the remote-preview map `{ [draftId]: shape }`.
 * Handles preview progress/cancel plus commit-side cleanup:
 * - `shapes:commit` drops the preview whose id matches (authoritative op
 *   carries the persisted copy — dedupe covers the rest).
 * - `shapes:delete` drops previews for deleted ids.
 * - `canvas:clear` / `canvas:history-sync` reset or reconcile the map.
 * Returns the same ref when nothing changes.
 */
export function applyRemotePreviewEvent(prevMap, event, data, actorId = null) {
  const prev = prevMap ?? {};
  if (event === 'shape:preview-progress') {
    if (!isValidPreviewProgress(data)) return prev;
    return { ...prev, [data.draftId]: previewToShape(data, actorId) };
  }
  if (event === 'shape:preview-cancel') {
    if (!data || !isIdString(data.draftId)) return prev;
    if (!(data.draftId in prev)) return prev;
    const next = { ...prev };
    delete next[data.draftId];
    return next;
  }
  if (event === 'shapes:commit') {
    // Accept both envelopes: { shape } (legacy) and { shapes: [] }.
    const list = Array.isArray(data?.shapes) ? data.shapes : data?.shape !== undefined ? [data.shape] : [];
    const ids = new Set(list.filter((s) => s && typeof s.id === 'string').map((s) => s.id));
    if (ids.size === 0) return prev;
    const keys = Object.keys(prev).filter((k) => ids.has(k) || (prev[k]?.id && ids.has(prev[k].id)));
    if (keys.length === 0) return prev;
    const next = { ...prev };
    for (const k of keys) delete next[k];
    return next;
  }
  if (event === 'shapes:delete') {
    const ids = Array.isArray(data?.shapeIds) ? data.shapeIds : data?.shapeId !== undefined ? [data.shapeId] : null;
    if (!ids) return prev;
    const idSet = new Set(ids.filter((id) => typeof id === 'string'));
    const keys = Object.keys(prev).filter((k) => idSet.has(k) || (prev[k]?.id && idSet.has(prev[k].id)));
    if (keys.length === 0) return prev;
    const next = { ...prev };
    for (const k of keys) delete next[k];
    return next;
  }
  if (event === 'canvas:clear') {
    return Object.keys(prev).length === 0 ? prev : {};
  }
  if (event === 'canvas:history-sync') {
    if (!data || !Array.isArray(data.shapes)) return prev;
    const liveIds = new Set(data.shapes.filter((s) => s && typeof s.id === 'string').map((s) => s.id));
    const keys = Object.keys(prev).filter((k) => prev[k]?.id && !liveIds.has(prev[k].id));
    if (keys.length === 0) return prev;
    const next = { ...prev };
    for (const k of keys) delete next[k];
    return next;
  }
  return prev;
}

/**
 * Render merge: fold remote previews into the visible shape array for
 * display. Creation previews (unknown ids) append; previews whose id
 * matches a committed shape — live drag previews — REPLACE the committed
 * entry in place (same index, no duplication, no ghosting). Peers see the
 * shape glide live; on drop the authoritative update arrives and the
 * preview-cancel removes the overlay entry. Returns the input ref when
 * there is nothing to merge so React can skip re-renders.
 */
export function mergeRenderShapes(visibleShapes, remoteStrokes) {
  const base = Array.isArray(visibleShapes) ? visibleShapes : [];
  const previews = Object.values(remoteStrokes ?? {}).filter(Boolean);
  if (previews.length === 0) return base;
  const byId = new Map();
  for (const p of previews) {
    if (p && typeof p.id === 'string') byId.set(p.id, p);
  }
  if (byId.size === 0) return base;
  let changed = false;
  const next = base.map((s) => {
    const p = s && byId.get(s.id);
    if (p) {
      byId.delete(s.id);
      changed = true;
      return p;
    }
    return s;
  });
  if (byId.size > 0) {
    next.push(...byId.values());
    changed = true;
  }
  return changed ? next : base;
}

/** Build a `collab:selection` payload for peers (discrete emit). */
export function buildSelectionPayload({ userId, userName, color, shapeIds }) {
  const ids = Array.isArray(shapeIds) ? [...new Set(shapeIds.filter((id) => typeof id === 'string'))] : [];
  if (ids.length > MAX_BATCH_SHAPES) return null;
  const data = { shapeIds: ids };
  if (userId !== undefined) {
    if (!isIdString(userId)) return null;
    data.userId = userId;
  }
  if (userName !== undefined) data.userName = String(userName);
  if (color !== undefined) data.color = String(color);
  return data;
}

/** Validate inbound `collab:selection` data. Mirrors the server length caps. */
export function isValidSelection(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.shapeIds) || data.shapeIds.length > MAX_BATCH_SHAPES) return false;
  if (!data.shapeIds.every((id) => typeof id === 'string')) return false;
  if (data.userId !== undefined && !isIdString(data.userId)) return false;
  if (data.userName !== undefined && (typeof data.userName !== 'string' || data.userName.length > 128)) return false;
  if (data.color !== undefined && (typeof data.color !== 'string' || data.color.length > 64)) return false;
  return true;
}

/**
 * Pure reducer for peer selections `{ [peerKey]: { userId, userName,
 * color, shapeIds, lastSeen } }`. Keyed by userId with socketId fallback.
 * Unknown events and invalid payloads return the previous map untouched —
 * as do byte-identical duplicate payloads (same id set + meta), which
 * return the identical ref — so a double-emitted tap reconciles nothing
 * downstream. lastSeen refreshes only on genuine changes; quiet-peer
 * expiry is handled by expireRemoteSelections.
 */
export function applyRemoteSelectionEvent(prevMap, data, actorId = null, now = Date.now()) {
  const prev = prevMap ?? {};
  if (!isValidSelection(data)) return prev;
  const key = (typeof data.userId === 'string' && data.userId) || actorId || 'unknown';
  const shapeIds = [...new Set(data.shapeIds)];
  const userName = typeof data.userName === 'string' && data.userName ? data.userName : 'Guest';
  const color = typeof data.color === 'string' && data.color ? data.color : '#4f46e5';
  const existing = prev[key];
  if (
    existing &&
    existing.userName === userName &&
    existing.color === color &&
    existing.shapeIds.length === shapeIds.length &&
    existing.shapeIds.every((id, i) => id === shapeIds[i])
  ) {
    return prev;
  }
  return {
    ...prev,
    [key]: {
      userId: key,
      userName,
      color,
      shapeIds,
      lastSeen: now,
    },
  };
}

/** Drop peer selections older than SELECTION_STALE_MS (same ref if none). */
export function expireRemoteSelections(prevMap, now = Date.now(), staleMs = SELECTION_STALE_MS) {
  const prev = prevMap ?? {};
  const keys = Object.keys(prev).filter((k) => now - (prev[k]?.lastSeen ?? 0) > staleMs);
  if (keys.length === 0) return prev;
  const next = { ...prev };
  for (const k of keys) delete next[k];
  return next;
}

/**
 * Pure LERP step for remote viewport smoothing (receiver side). Advances
 * `current` { x, y, scale } toward `target` by `factor` per frame and
 * snaps (done: true) once within epsilon — snapping avoids infinite
 * asymptotic approach and guarantees convergence. Unit-testable without
 * Konva or rAF.
 */
export function lerpViewportStep(current, target, factor = 0.3, posEps = 0.5, scaleEps = 0.001) {
  const cx = Number.isFinite(current?.x) ? current.x : 0;
  const cy = Number.isFinite(current?.y) ? current.y : 0;
  const cs = Number.isFinite(current?.scale) && current.scale > 0 ? current.scale : 1;
  const tx = Number.isFinite(target?.x) ? target.x : cx;
  const ty = Number.isFinite(target?.y) ? target.y : cy;
  const ts = Number.isFinite(target?.scale) && target.scale > 0 ? target.scale : cs;
  const f = Math.min(1, Math.max(0, factor));
  const nx = Math.abs(tx - cx) <= posEps ? tx : cx + (tx - cx) * f;
  const ny = Math.abs(ty - cy) <= posEps ? ty : cy + (ty - cy) * f;
  const ns = Math.abs(ts - cs) <= scaleEps ? ts : cs + (ts - cs) * f;
  return { x: nx, y: ny, scale: ns, done: nx === tx && ny === ty && ns === ts };
}

/**
 * Normalize a drag-preview shape into direct Konva node attrs, or null
 * when the preview carries nothing paintable. Pure and unit-tested; the
 * receiver applies the result imperatively (node.position()/points())
 * instead of routing through React state, so per-packet work is O(1) DOM
 * writes with zero reconciliation. Positioned shapes move via x/y;
 * absolute-points shapes (pen/line/arrow) move via translated points.
 */
export function dragPreviewNodeUpdate(shape) {
  if (!shape || typeof shape !== 'object' || typeof shape.id !== 'string') return null;
  const out = {};
  if (
    shape.type === 'freehand' ||
    shape.type === 'pen' ||
    shape.type === 'line' ||
    shape.type === 'arrow'
  ) {
    const pts = toFlatPoints(shape.points);
    if (pts.length < 4) return null;
    out.x = 0;
    out.y = 0;
    out.points = pts;
  } else {
    if (!isFiniteNum(shape.x) || !isFiniteNum(shape.y)) return null;
    out.x = shape.x;
    out.y = shape.y;
  }
  if (isFiniteNum(shape.rotation)) out.rotation = shape.rotation;
  return out;
}

/**
 * Defensive viewport unpacking (schema compatibility): accept coordinates
 * in EITHER envelope — flat `{ stagePos, scale }` or nested
 * `{ data: { stagePos, scale } }` (full relay envelope) — and coerce
 * values to finite numbers. Missing scale is NOT an error (callers fall
 * back to the live stage scale); only genuinely non-numeric coordinates
 * yield nulls, which callers treat as "nothing to apply".
 */
export function unpackViewportPayload(input) {
  const src =
    input && typeof input === 'object' && input.data && typeof input.data === 'object'
      ? input.data
      : (input ?? {});
  const toNum = (v) => {
    if (typeof v === 'string') {
      if (v.trim() === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const pos = src.stagePos && typeof src.stagePos === 'object' ? src.stagePos : null;
  const x = pos ? toNum(pos.x) : null;
  const y = pos ? toNum(pos.y) : null;
  return {
    stagePos: x !== null && y !== null ? { x, y } : null,
    scale: toNum(src.scale),
  };
}
