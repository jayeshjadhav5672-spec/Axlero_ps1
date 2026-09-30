import { isFiniteNum } from './shapes.js';

/**
 * strokeStream.js — pure helpers for real-time in-progress pen stroke
 * streaming. No Konva / socket deps; safe to import from tests.
 *
 * Wire protocol (room-scoped, relayed by `server/socket.cjs`):
 * - `draw:stroke-progress` { roomId, data: { strokeId, points, stroke,
 *   strokeWidth, opacity } } — throttled (~30ms) while the pen is down.
 * - `draw:stroke-complete` { roomId, data: { strokeId, shape } } — final
 *   committed shape on pointerup (authoritative copy follows via the
 *   normal `canvas:update` create op).
 * - `draw:stroke-cancel` { roomId, data: { strokeId } } — degenerate
 *   stroke discarded; peers drop the preview.
 */

export const STROKE_STREAM_INTERVAL_MS = 30;
export const STROKE_STREAM_EVENTS = ['draw:stroke-progress', 'draw:stroke-complete', 'draw:stroke-cancel'];
/** Cheap per-message cap (flat [x, y, ...] numbers) — no JSON.stringify needed. */
export const MAX_STREAM_POINTS = 20000;

/**
 * Gated diagnostic logger for the streaming pipeline. Silent unless the
 * operator opts in from the devtools console:
 *   window.__SYNCSPACE_STROKE_DEBUG = true
 * Checkpoints (emission → server relay → ingestion → render) log under the
 * `[stroke-stream]` prefix so a live session isolates the break in seconds.
 * Never throws; never fires when the flag is off (zero hot-path cost).
 */
export function strokeDebug(...args) {
  try {
    if (typeof window !== 'undefined' && window.__SYNCSPACE_STROKE_DEBUG) {
      console.log('[stroke-stream]', ...args);
    }
  } catch {
    // diagnostics must never break drawing
  }
}

function isStrokeId(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= 128;
}

function isValidPoints(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_STREAM_POINTS) return false;
  if (points.length % 2 !== 0) return false;
  return points.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e7);
}

/**
 * Definitive points-format normalization (failure mode 3): accept BOTH the
 * canonical flat format `[x1, y1, x2, y2, ...]` AND the nested object
 * format `[{ x, y }, ...]` on ingest, always producing flat finite pairs.
 * Filtering is PAIR-WISE atomic — a pair with any non-finite member is
 * dropped whole (pending slot reset), so a bad value can never shift the
 * alignment of subsequent coordinates; trailing orphans are trimmed. The
 * renderer can therefore never receive a shape Konva silently refuses to
 * paint. The wire validators normalize-then-check, so either format flows.
 */
export function toFlatPoints(points) {
  if (!Array.isArray(points)) return [];
  const finiteNum = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e7;
  const flat = [];
  for (let i = 0; i < points.length && flat.length < MAX_STREAM_POINTS; i++) {
    const p = points[i];
    if (typeof p === 'number') {
      // Flat form is positional: indices (2k, 2k+1) are a pair. A pair
      // with any non-finite member is dropped whole (both slots
      // consumed) so alignment of later pairs never shifts.
      const q = points[i + 1];
      if (finiteNum(p) && finiteNum(q)) flat.push(p, q);
      i++;
    } else if (p && typeof p === 'object') {
      // Nested form is self-delimiting: map atomically, consume one slot.
      const x = p.x ?? p[0];
      const y = p.y ?? p[1];
      if (finiteNum(x) && finiteNum(y)) {
        flat.push(x, y);
      }
    } else {
      // Junk consumes its pair slot (alignment safety).
      i++;
    }
  }
  return flat;
}

/** Build a throttled progress payload from the in-flight stroke ref. */
export function buildStrokeProgressPayload({ strokeId, points, stroke, strokeWidth, opacity }) {
  // toFlatPoints subsumes sanitizePoints (finite-filter + orphan trim) and
  // additionally tolerates nested [{ x, y }] input — never pre-strip
  // objects before it runs.
  const clean = toFlatPoints(points);
  if (!isStrokeId(strokeId) || clean.length < 2) return null;
  return {
    strokeId,
    points: clean,
    stroke: typeof stroke === 'string' ? stroke : '#1e1e1e',
    strokeWidth: isFiniteNum(strokeWidth) ? strokeWidth : 4,
    opacity: isFiniteNum(opacity) ? opacity : 1,
  };
}

/** Validate inbound `draw:stroke-progress` data (peer preview). */
export function isValidStrokeProgress(data) {
  if (!data || typeof data !== 'object') return false;
  if (!isStrokeId(data.strokeId)) return false;
  // Input-side cap first: oversized payloads reject before normalization.
  if (!Array.isArray(data.points) || data.points.length > MAX_STREAM_POINTS) return false;
  // Normalize-then-check: flat and nested [{ x, y }] formats both flow.
  if (!isValidPoints(toFlatPoints(data.points))) return false;
  if (data.stroke !== undefined && typeof data.stroke !== 'string') return false;
  if (data.strokeWidth !== undefined && !isFiniteNum(data.strokeWidth)) return false;
  if (data.opacity !== undefined && !isFiniteNum(data.opacity)) return false;
  return true;
}

/** Validate inbound `draw:stroke-complete` data (finalized shape). */
export function isValidStrokeComplete(data) {
  if (!data || typeof data !== 'object') return false;
  if (!isStrokeId(data.strokeId)) return false;
  const shape = data.shape;
  if (shape !== null && shape !== undefined) {
    if (typeof shape !== 'object') return false;
    if (typeof shape.id !== 'string' || !shape.id) return false;
  }
  return true;
}

/**
 * Convert a validated progress payload into a renderable preview shape.
 * Flagged `remotePreview` so the renderer keeps it non-interactive and
 * stores/exports skip it. Carries every key Konva's freehand branch
 * requires (`type`, `points` flat, `stroke`, `strokeWidth`, `x/y` pinned
 * at origin for absolute-points rendering) plus sane style defaults, so a
 * sparse sender can never produce a shape the canvas silently drops.
 */
export function progressToPreviewShape(data, actorId = null) {
  const clean = toFlatPoints(data?.points);
  const strokeWidth = isFiniteNum(data?.strokeWidth) && data.strokeWidth > 0 ? data.strokeWidth : 4;
  return {
    id: data.strokeId,
    type: 'freehand',
    x: 0,
    y: 0,
    points: clean,
    stroke: typeof data?.stroke === 'string' && data.stroke ? data.stroke : '#1e1e1e',
    strokeWidth,
    strokeStyle: 'solid',
    opacity: isFiniteNum(data?.opacity) ? Math.min(1, Math.max(0, data.opacity)) : 1,
    lineCap: 'round',
    lineJoin: 'round',
    rotation: 0,
    remotePreview: true,
    previewActorId: actorId,
    // Freshness marker for stale-preview expiry (an active stroke
    // re-upserts every ~30ms, so only orphaned ghosts age out).
    receivedAt: Date.now(),
  };
}

/** Drop previews older than `staleMs` (same ref when none expire). */
export function expireRemotePreviews(prevMap, now = Date.now(), staleMs = 20000) {
  const prev = prevMap ?? {};
  const keys = Object.keys(prev).filter((k) => now - (prev[k]?.receivedAt ?? 0) > staleMs);
  if (keys.length === 0) return prev;
  const next = { ...prev };
  for (const k of keys) delete next[k];
  return next;
}

/**
 * Pure reducer for the remote-preview map: `{ [strokeId]: shape }`.
 * Returns the next map (same ref when nothing changes).
 */
export function applyRemoteStrokeEvent(prevMap, event, data, actorId = null) {
  const prev = prevMap ?? {};
  if (event === 'draw:stroke-progress') {
    if (!isValidStrokeProgress(data)) return prev;
    return { ...prev, [data.strokeId]: progressToPreviewShape(data, actorId) };
  }
  if (event === 'draw:stroke-complete') {
    if (!isValidStrokeComplete(data)) return prev;
    if (!(data.strokeId in prev)) return prev;
    if (data.shape && typeof data.shape === 'object') {
      // Hold the finalized shape under the preview flag until the
      // authoritative `canvas:update` create op lands (render layer
      // dedupes by id, so no double-draw either way). Backfill the Konva
      // keys a sparse foreign shape might omit so the hold always paints.
      const held = { ...data.shape, remotePreview: true, previewActorId: actorId };
      if (!held.type) held.type = 'freehand';
      if (!Array.isArray(held.points)) held.points = toFlatPoints(prev[data.strokeId]?.points);
      if (typeof held.stroke !== 'string' || !held.stroke) held.stroke = '#1e1e1e';
      if (!isFiniteNum(held.strokeWidth) || held.strokeWidth <= 0) held.strokeWidth = 4;
      if (!isFiniteNum(held.opacity)) held.opacity = 1;
      if (!isFiniteNum(held.x)) held.x = 0;
      if (!isFiniteNum(held.y)) held.y = 0;
      held.receivedAt = Date.now();
      return { ...prev, [data.strokeId]: held };
    }
    const next = { ...prev };
    delete next[data.strokeId];
    return next;
  }
  if (event === 'draw:stroke-cancel') {
    if (!data || !isStrokeId(data.strokeId)) return prev;
    if (!(data.strokeId in prev)) return prev;
    const next = { ...prev };
    delete next[data.strokeId];
    return next;
  }
  return prev;
}
