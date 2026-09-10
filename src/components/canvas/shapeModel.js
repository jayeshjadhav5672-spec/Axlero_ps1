/**
 * shapeModel.js — Sayon (Whiteboard / Konva.js Engineer)
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

export function isValidShape(shape) {
  if (!shape || typeof shape !== 'object') return false;
  if (typeof shape.id !== 'string' || !shape.id.startsWith('shape-')) return false;
  if (!SHAPE_TYPES.includes(shape.type)) {
    // Back-compat: legacy 'line' freehand blobs are accepted elsewhere.
    if (shape.type !== 'line') return false;
  }
  return true;
}
