/**
 * utils/shapes.js — Sayon (Whiteboard / Konva.js Engineer)
 *
 * CANONICAL shape utilities for the SyncSpace whiteboard.
 * (Previously `../shapeModel.js`, now kept as a re-export shim.)
 *
 * Plain serializable canvas data model. No Konva nodes ever enter state.
 * All coordinates are WORLD coordinates (viewport-independent). The Stage
 * applies scale/position on top; stored shapes never change on zoom/pan.
 */

export const SHAPE_TYPES = [
  'freehand',
  'rectangle',
  'circle',
  'line',
  'arrow',
  'text',
];

/** Stable collaborator-safe id: always `shape-<uuid>`. */
export function createShapeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `shape-${crypto.randomUUID()}`;
  }
  return `shape-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const DEFAULTS = {
  strokeWidth: 4,
  fontSize: 20,
  fontFamily: 'Inter, sans-serif',
};

/** Factory for a new shape in WORLD coordinates. */
export function createShape(type, worldPoint, { color = '#0f766e', strokeWidth = DEFAULTS.strokeWidth } = {}) {
  const id = createShapeId();
  switch (type) {
    case 'freehand':
      return {
        id,
        type: 'freehand',
        x: 0,
        y: 0,
        points: [worldPoint.x, worldPoint.y],
        stroke: color,
        strokeWidth,
        lineCap: 'round',
        lineJoin: 'round',
        rotation: 0,
      };
    case 'rectangle':
      return {
        id,
        type: 'rectangle',
        x: worldPoint.x,
        y: worldPoint.y,
        width: 0,
        height: 0,
        stroke: color,
        strokeWidth,
        fill: 'transparent',
        rotation: 0,
      };
    case 'circle':
      return {
        id,
        type: 'circle',
        x: worldPoint.x, // center X
        y: worldPoint.y, // center Y
        radius: 0,
        stroke: color,
        strokeWidth,
        fill: 'transparent',
        rotation: 0,
      };
    case 'line':
      return {
        id,
        type: 'line',
        x: 0,
        y: 0,
        points: [worldPoint.x, worldPoint.y, worldPoint.x, worldPoint.y],
        stroke: color,
        strokeWidth,
        lineCap: 'round',
        rotation: 0,
      };
    case 'arrow':
      return {
        id,
        type: 'arrow',
        x: 0,
        y: 0,
        points: [worldPoint.x, worldPoint.y, worldPoint.x, worldPoint.y],
        stroke: color,
        strokeWidth,
        fill: color,
        lineCap: 'round',
        lineJoin: 'round',
        rotation: 0,
      };
    case 'text':
      return {
        id,
        type: 'text',
        x: worldPoint.x,
        y: worldPoint.y,
        text: '',
        fontSize: DEFAULTS.fontSize,
        fontFamily: DEFAULTS.fontFamily,
        fill: color,
        rotation: 0,
      };
    default:
      return null;
  }
}

/** Normalize rectangle drag (any direction) -> positive w/h, top-left x/y. */
export function normalizeRect(x0, y0, x1, y1) {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
}

/** Circle from center + pointer: radius is Euclidean distance. */
export function circleRadius(cx, cy, px, py) {
  return Math.hypot(px - cx, py - cy);
}

/**
 * Axis-aligned bounding box of a shape in WORLD coordinates.
 * Used for viewport culling, remote-selection highlights, and replay framing.
 * Returns { x, y, width, height } or null for unknown shapes.
 */
export function getShapeBounds(shape) {
  if (!shape || typeof shape !== 'object') return null;
  switch (shape.type) {
    case 'rectangle':
      return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
    case 'circle': {
      const r = Math.max(0, shape.radius ?? 0);
      return { x: shape.x - r, y: shape.y - r, width: r * 2, height: r * 2 };
    }
    case 'freehand':
    case 'line':
    case 'arrow': {
      const pts = shape.points ?? [];
      if (pts.length < 2) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const px = pts[i];
        const py = pts[i + 1];
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
      const pad = (shape.strokeWidth ?? DEFAULTS.strokeWidth) / 2;
      return {
        x: minX - pad,
        y: minY - pad,
        width: Math.max(1, maxX - minX + pad * 2),
        height: Math.max(1, maxY - minY + pad * 2),
      };
    }
    case 'text': {
      // Approximate (no canvas measurement here): width ~ 0.6 * fontSize per char.
      const fontSize = shape.fontSize ?? DEFAULTS.fontSize;
      const text = shape.text ?? '';
      const longestLine = text.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
      const lines = text.split('\n').length;
      return {
        x: shape.x,
        y: shape.y,
        width: Math.max(fontSize * 0.6, longestLine * fontSize * 0.6),
        height: Math.max(fontSize, lines * fontSize * 1.2),
      };
    }
    default:
      return null;
  }
}

/**
 * Per-type normalization pass: clamps degenerate values and repairs
 * legacy blobs (e.g. old `{ type: 'line' }` freehand strokes stay valid).
 * Returns a cleaned shape (same reference if already clean).
 */
export function normalizeShape(shape) {
  if (!isValidShape(shape)) return shape;
  if (shape.type === 'rectangle') {
    if (shape.width < 0 || shape.height < 0) {
      const norm = normalizeRect(shape.x, shape.y, shape.x + shape.width, shape.y + shape.height);
      return { ...shape, ...norm };
    }
  }
  if (shape.type === 'circle') {
    if ((shape.radius ?? 0) < 0) return { ...shape, radius: Math.abs(shape.radius) };
  }
  if ((shape.type === 'freehand' || shape.type === 'line' || shape.type === 'arrow') && !Array.isArray(shape.points)) {
    return { ...shape, points: [] };
  }
  if (shape.type === 'text' && typeof shape.text !== 'string') {
    return { ...shape, text: String(shape.text ?? '') };
  }
  return shape;
}

/**
 * Bake a Konva drag offset into the data model so stored coords stay
 * normalized (no leftover dx/dy for shapes that keep absolute points).
 * - rect/circle/text: node x/y ARE the model x/y -> take directly.
 * - freehand/line/arrow: points are absolute, node x/y is transient drag
 *   offset -> add offset into every point, reset x/y to 0.
 */
export function bakeDragEnd(shape, nodeX, nodeY) {
  if (shape.type === 'freehand' || shape.type === 'line' || shape.type === 'arrow') {
    const dx = nodeX - (shape.x ?? 0);
    const dy = nodeY - (shape.y ?? 0);
    if (dx === 0 && dy === 0) return null;
    const points = shape.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
    return { x: 0, y: 0, points };
  }
  if (nodeX === shape.x && nodeY === shape.y) return null;
  return { x: nodeX, y: nodeY };
}

/**
 * Bake Konva Transformer scale/rotation into the data model.
 * Must be called on transformend; caller must reset node scale to 1
 * after reading it (handled in CanvasStage).
 */
export function bakeTransform(shape, { scaleX, scaleY, rotation }) {
  const changes = {};
  if (typeof rotation === 'number' && rotation !== (shape.rotation ?? 0)) {
    changes.rotation = rotation;
  }
  const sx = scaleX ?? 1;
  const sy = scaleY ?? 1;
  if (sx === 1 && sy === 1) return Object.keys(changes).length ? changes : null;

  if (shape.type === 'rectangle') {
    changes.width = Math.max(1, Math.abs(shape.width * sx));
    changes.height = Math.max(1, Math.abs(shape.height * sy));
  } else if (shape.type === 'circle') {
    const uniform = Math.max(Math.abs(sx), Math.abs(sy));
    changes.radius = Math.max(1, shape.radius * uniform);
  } else if (shape.type === 'text') {
    const uniform = (Math.abs(sx) + Math.abs(sy)) / 2;
    changes.fontSize = Math.max(8, Math.round((shape.fontSize ?? DEFAULTS.fontSize) * uniform));
  } else if (shape.type === 'freehand' || shape.type === 'line' || shape.type === 'arrow') {
    // Scale absolute points around origin, reset node offset.
    changes.points = shape.points.map((v, i) => (i % 2 === 0 ? v * sx : v * sy));
    changes.x = 0;
    changes.y = 0;
  }
  return Object.keys(changes).length ? changes : null;
}

/** Strip anything non-serializable; returns a JSON-safe clone or null. */
export function serializeShape(shape) {
  try {
    return JSON.parse(JSON.stringify(shape));
  } catch {
    return null;
  }
}

/** JSON-safe clone of a whole shape array; drops invalid entries. */
export function serializeShapes(shapes) {
  if (!Array.isArray(shapes)) return [];
  const out = [];
  for (const shape of shapes) {
    if (!isValidShape(shape)) continue;
    const clean = serializeShape(normalizeShape(shape));
    if (clean) out.push(clean);
  }
  return out;
}

export function isValidShape(shape) {
  if (!shape || typeof shape !== 'object') return false;
  if (typeof shape.id !== 'string' || !shape.id.startsWith('shape-')) return false;
  if (!SHAPE_TYPES.includes(shape.type)) {
    // Back-compat: legacy freehand blobs were stored as type 'line'.
    if (shape.type !== 'line') return false;
  }
  return true;
}
