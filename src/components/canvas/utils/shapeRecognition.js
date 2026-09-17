import { createShapeId, isFiniteNum } from './shapes.js';

/**
 * shapeRecognition.js — Sayon (Week 2: "Draw to Shape" / Auto-straighten)
 *
 * Analyzes a finished freehand stroke (flat absolute world points) and,
 * when confident, returns a clean replacement shape descriptor
 * ({ type, ...geometry } — caller attaches id/style). Returns null when
 * the stroke matches nothing (caller keeps the raw freehand stroke).
 *
 * Detectors (tried in order: line -> rectangle -> circle):
 * - Straight Line: max perpendicular deviation from the start→end vector
 *   is minimal relative to segment length.
 * - Rectangle: 4 distinct direction changes (corner count) and the
 *   bounding-box fill ratio looks box-like.
 * - Circle/Ellipse: start≈end (closed) and radial variance from the
 *   centroid is within tolerance (<20%).
 */

function toPairs(points) {
  const pts = Array.isArray(points) ? points.filter((v) => isFiniteNum(v)) : [];
  const out = [];
  for (let i = 0; i + 1 < pts.length; i += 2) out.push({ x: pts[i], y: pts[i + 1] });
  return out;
}

function boundsOf(pairs) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pairs) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function strokeLength(pairs) {
  let len = 0;
  for (let i = 1; i < pairs.length; i += 1) {
    len += Math.hypot(pairs[i].x - pairs[i - 1].x, pairs[i].y - pairs[i - 1].y);
  }
  return len;
}

/** Max perpendicular distance of interior points to the start→end line. */
export function lineDeviation(pairs) {
  if (pairs.length < 2) return Infinity;
  const a = pairs[0];
  const b = pairs[pairs.length - 1];
  const segLen = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(segLen > 0)) return Infinity;
  let max = 0;
  for (let i = 1; i < pairs.length - 1; i += 1) {
    const p = pairs[i];
    const area = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y));
    const dist = area / segLen;
    if (dist > max) max = dist;
  }
  return { max, segLen, ratio: max / segLen };
}

/** Count sharp direction changes (corners) along a resampled polyline. */
export function countCorners(pairs) {
  if (pairs.length < 8) return 0;
  // Resample to ~16 evenly spaced samples to suppress hand jitter.
  const total = strokeLength(pairs);
  if (!(total > 0)) return 0;
  const N = 16;
  const samples = [pairs[0]];
  let acc = 0;
  let target = total / N;
  let prev = pairs[0];
  for (let i = 1; i < pairs.length; i += 1) {
    const d = Math.hypot(pairs[i].x - prev.x, pairs[i].y - prev.y);
    acc += d;
    prev = pairs[i];
    if (acc >= target && samples.length < N) {
      samples.push(pairs[i]);
      target = (total / N) * (samples.length);
    }
  }
  samples.push(pairs[pairs.length - 1]);
  let corners = 0;
  for (let i = 1; i < samples.length - 1; i += 1) {
    const v1 = { x: samples[i].x - samples[i - 1].x, y: samples[i].y - samples[i - 1].y };
    const v2 = { x: samples[i + 1].x - samples[i].x, y: samples[i + 1].y - samples[i].y };
    const m1 = Math.hypot(v1.x, v1.y);
    const m2 = Math.hypot(v2.x, v2.y);
    if (m1 < 1e-6 || m2 < 1e-6) continue;
    const cos = (v1.x * v2.x + v1.y * v2.y) / (m1 * m2);
    // >~35° turn counts as a corner.
    if (cos < 0.82) corners += 1;
  }
  return corners;
}

function centroid(pairs) {
  let sx = 0;
  let sy = 0;
  for (const p of pairs) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pairs.length, y: sy / pairs.length };
}

/**
 * recognizeStroke(points) -> { kind: 'line'|'rectangle'|'circle', ...geom } | null
 * Geometry is expressed in world coords, style-free (caller merges style).
 */
export function recognizeStroke(points) {
  const pairs = toPairs(points);
  if (pairs.length < 6) return null;
  const bounds = boundsOf(pairs);
  if (!(bounds.width >= 0 && bounds.height >= 0)) return null;
  if (Math.max(bounds.width, bounds.height) < 12) return null;

  const first = pairs[0];
  const last = pairs[pairs.length - 1];
  const diag = Math.hypot(bounds.width, bounds.height) || 1;

  // 1) Straight line: deviation < 4% of segment length (min 3px slack).
  const dev = lineDeviation(pairs);
  if (dev !== Infinity && dev.ratio < 0.04 && dev.max < Math.max(3, dev.segLen * 0.04)) {
    return {
      kind: 'line',
      points: [first.x, first.y, last.x, last.y],
    };
  }

  // 2) Rectangle: closed-ish or 4 corners, box-like extents.
  const corners = countCorners(pairs);
  const closedGap = Math.hypot(last.x - first.x, last.y - first.y);
  const isClosed = closedGap < diag * 0.3;
  if (corners >= 3 && corners <= 6 && bounds.width > 10 && bounds.height > 10) {
    // Aspect sanity: stroke length should be near the box perimeter
    // (within 0.5x–1.8x) so scribbles don't become boxes.
    const len = strokeLength(pairs);
    const perimeter = 2 * (bounds.width + bounds.height);
    if (len > perimeter * 0.4 && len < perimeter * 2.2) {
      return {
        kind: 'rectangle',
        x: bounds.minX,
        y: bounds.minY,
        width: bounds.width,
        height: bounds.height,
      };
    }
  }

  // 3) Circle / ellipse: closed + radial variance < 20%.
  if (isClosed || closedGap < diag * 0.35) {
    const c = centroid(pairs);
    const radii = pairs.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
    const mean = radii.reduce((a, r) => a + r, 0) / radii.length;
    if (mean > 6) {
      const variance = radii.reduce((a, r) => a + Math.abs(r - mean), 0) / radii.length;
      if (variance / mean < 0.2) {
        const rx = bounds.width / 2;
        const ry = bounds.height / 2;
        // Near-uniform -> circle; stretched -> ellipse radii.
        const uniform = Math.abs(rx - ry) / Math.max(rx, ry, 1e-9) < 0.25;
        if (uniform) {
          return { kind: 'circle', x: c.x, y: c.y, radius: (rx + ry) / 2 };
        }
        return { kind: 'circle', x: c.x, y: c.y, radius: (rx + ry) / 2, radiusX: rx, radiusY: ry };
      }
    }
  }

  return null;
}

/**
 * Convert a finished freehand shape into a recognized shape when possible.
 * Returns a NEW plain shape object (fresh `shape-*` id carried from the
 * caller) or null when nothing was recognized. Style fields are copied
 * from the source stroke.
 */
export function autoStraightenStroke(freehandShape, styleDefaults = {}) {
  if (!freehandShape || (freehandShape.type !== 'freehand' && freehandShape.type !== 'pen')) {
    return null;
  }
  const hit = recognizeStroke(freehandShape.points);
  if (!hit) return null;
  const base = {
    id: createShapeId(),
    stroke: freehandShape.stroke ?? styleDefaults.color ?? '#1e1e1e',
    strokeWidth: freehandShape.strokeWidth ?? styleDefaults.strokeWidth ?? 4,
    strokeStyle: freehandShape.strokeStyle ?? styleDefaults.strokeStyle ?? 'solid',
    opacity: freehandShape.opacity ?? styleDefaults.opacity ?? 1,
    roughness: freehandShape.roughness ?? styleDefaults.roughness ?? 0,
    rotation: 0,
  };
  if (hit.kind === 'line') {
    return {
      ...base,
      type: 'line',
      x: 0,
      y: 0,
      points: hit.points,
      startArrowhead: 'none',
      endArrowhead: 'none',
      lineCap: 'round',
    };
  }
  if (hit.kind === 'rectangle') {
    return {
      ...base,
      type: 'rectangle',
      x: hit.x,
      y: hit.y,
      width: Math.max(2, hit.width),
      height: Math.max(2, hit.height),
      fill: styleDefaults.fill ?? 'transparent',
      roundness: styleDefaults.roundness ?? 'sharp',
    };
  }
  // circle / ellipse
  const out = {
    ...base,
    type: 'circle',
    x: hit.x,
    y: hit.y,
    radius: Math.max(2, hit.radius),
    fill: styleDefaults.fill ?? 'transparent',
    roundness: styleDefaults.roundness ?? 'sharp',
  };
  if (hit.radiusX !== undefined) {
    out.radiusX = Math.max(2, hit.radiusX);
    out.radiusY = Math.max(2, hit.radiusY);
  }
  return out;
}
