export const SHAPE_TYPES = [
  'freehand',
  'rectangle',
  'circle',
  'diamond',
  'line',
  'arrow',
  'text',
  'image',
  'frame',
  'group',
];

/** Excalidraw-parity option lists (shared by sidebar + defaults). */
export const ROUGHNESS_CHOICES = [
  { value: 0, label: 'Architect' },
  { value: 1, label: 'Artist' },
  { value: 2, label: 'Cartoonist' },
];

export const ROUNDNESS_CHOICES = [
  { value: 'sharp', label: 'Sharp' },
  { value: 'round', label: 'Round' },
];

export const ARROWHEAD_CHOICES = [
  { value: 'none', label: 'None' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'dot', label: 'Dot' },
];

/** Arrow path-shape choices: straight vector, curved Bezier, elbow orthogonal. */
export const ARROW_TYPE_CHOICES = [
  { value: 'straight', label: 'Straight' },
  { value: 'curved', label: 'Curved' },
  { value: 'elbow', label: 'Elbow' },
];

export const FONT_FAMILY_CHOICES = [
  { value: 'hand', label: 'Hand-drawn' },
  { value: 'normal', label: 'Normal' },
  { value: 'code', label: 'Code' },
  { value: 'serif', label: 'Serif' },
];

export const FONT_FAMILIES = {
  hand: 'Virgil, cursive',
  normal: 'sans-serif',
  code: 'monospace',
  serif: 'serif',
};

/** Legacy full font stacks (pre-task values) — still resolve for old docs. */
export const LEGACY_FONT_FAMILIES = {
  hand: 'Virgil, "Comic Sans MS", "Segoe Print", "Bradley Hand", cursive',
  normal: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  code: 'monospace, "Fira Code", "JetBrains Mono", Menlo, Consolas, "Courier New"',
  serif: 'serif, Georgia, "Times New Roman", serif',
};

/** Resolve any stored fontFamily (picker key, canonical CSS, or legacy stack). */
export function resolveFontFamily(rawFont) {
  if (typeof rawFont !== 'string' || !rawFont) return FONT_FAMILIES.hand;
  return FONT_FAMILIES[rawFont] ?? LEGACY_FONT_FAMILIES[rawFont] ?? rawFont;
}

export const FONT_SIZE_CHOICES = [
  { value: 16, label: 'S' },
  { value: 20, label: 'M' },
  { value: 28, label: 'L' },
  { value: 36, label: 'XL' },
];

export const TEXT_ALIGN_CHOICES = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];

/** Stable collaborator-safe id: always `shape-<uuid>`. */
export function createShapeId(prefix = 'shape') {
  const rand = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${rand()}`;
}

/** Image-shape id per the Week-2 spec: `img-<ts>-<rand5>`. */
export function createImageId() {
  return `img-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
}

/** Frame id per the Week-2 spec: `frame-<ts>[-<rand>]`. */
export function createFrameId() {
  return `frame-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Factory for an image shape from a base64 data URL.
 * Plain serializable JSON — no Konva nodes, no socket/Yjs deps.
 */
export function createImageShape(
  src,
  { x = 0, y = 0, width = 320, height = 240, rotation = 0 } = {},
) {
  if (typeof src !== 'string' || !src.startsWith('data:image')) return null;
  if (!isFiniteNum(x) || !isFiniteNum(y)) return null;
  const w = isFiniteNum(width) && width > 0 ? width : 320;
  const h = isFiniteNum(height) && height > 0 ? height : 240;
  return {
    id: createImageId(),
    type: 'image',
    src,
    x,
    y,
    width: w,
    height: h,
    rotation: isFiniteNum(rotation) ? rotation : 0,
  };
}

/**
 * Factory for a frame / slide-container shape (drag-to-create bounds).
 * `count` seeds the human-readable `Frame N` title.
 */
export function createFrameShape({ x = 0, y = 0, width = 0, height = 0, count = 1 } = {}) {
  if (!isFiniteNum(x) || !isFiniteNum(y)) return null;
  const norm = normalizeRect(x, y, x + width, y + height);
  return {
    id: createFrameId(),
    type: 'frame',
    title: `Frame ${count}`,
    x: norm.x,
    y: norm.y,
    width: norm.width,
    height: norm.height,
    fill: 'rgba(241, 245, 249, 0.35)',
    stroke: '#94a3b8',
    dash: [6, 6],
    rotation: 0,
  };
}

export const DEFAULTS = {
  strokeWidth: 4,
  fontSize: 20,
  fontFamily: 'Virgil, cursive',
  fontFamilyKey: 'hand',
  textAlign: 'left',
  fill: 'transparent',
  opacity: 1,
  strokeStyle: 'solid',
  roughness: 0,
  roundness: 'sharp',
  startArrowhead: 'none',
  endArrowhead: 'arrow',
  arrowType: 'straight',
};

/** Excalidraw-style stroke-style -> Konva dash mapping (scaled by width). */
export function dashForStyle(strokeStyle, strokeWidth = DEFAULTS.strokeWidth) {
  const w = strokeWidth ?? DEFAULTS.strokeWidth;
  switch (strokeStyle) {
    case 'dashed':
      return [Math.max(8, w * 3), Math.max(5, w * 1.75)];
    case 'dotted':
      return [Math.max(1.5, w * 0.5), Math.max(4, w * 1.5)];
    default:
      return undefined;
  }
}

/** Factory for a new shape in WORLD coordinates. */
export function createShape(
  type,
  worldPoint,
  {
    color = '#1e1e1e',
    strokeWidth = DEFAULTS.strokeWidth,
    fill = DEFAULTS.fill,
    strokeStyle = DEFAULTS.strokeStyle,
    opacity = DEFAULTS.opacity,
    roughness = DEFAULTS.roughness,
    roundness = DEFAULTS.roundness,
    startArrowhead = DEFAULTS.startArrowhead,
    endArrowhead = DEFAULTS.endArrowhead,
    arrowType = DEFAULTS.arrowType,
    fontFamily = DEFAULTS.fontFamily,
    fontFamilyKey = DEFAULTS.fontFamilyKey,
    fontSize = DEFAULTS.fontSize,
    textAlign = DEFAULTS.textAlign,
  } = {},
) {
  // Never seed a shape from a non-finite pointer (e.g. pointerup with no
  // drag / uninitialized coords) — that NaN would flow into Konva props.
  if (!worldPoint || !isFiniteNum(worldPoint.x) || !isFiniteNum(worldPoint.y)) return null;
  const id = createShapeId();
  switch (type) {
    case 'pen':
    case 'freehand':
      return {
        id,
        type: 'freehand',
        x: 0,
        y: 0,
        points: [worldPoint.x, worldPoint.y],
        stroke: color,
        strokeWidth,
        strokeStyle,
        opacity,
        roughness,
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
        strokeStyle,
        opacity,
        roughness,
        roundness,
        fill,
        rotation: 0,
      };
    case 'diamond':
      return {
        id,
        type: 'diamond',
        x: worldPoint.x,
        y: worldPoint.y,
        width: 0,
        height: 0,
        stroke: color,
        strokeWidth,
        strokeStyle,
        opacity,
        roughness,
        roundness,
        fill,
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
        strokeStyle,
        opacity,
        roughness,
        roundness,
        fill,
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
        strokeStyle,
        opacity,
        roughness,
        // Excalidraw parity: a simple Line NEVER carries arrowheads —
        // arrowheads belong strictly to the Arrow tool. Forcing 'none'
        // here (ignoring ambient arrow defaults) keeps new lines rendering
        // as pure `<Line />` paths with no pointer markers or dots.
        // Keys are preserved for Yjs/CRDT JSON compatibility.
        startArrowhead: 'none',
        endArrowhead: 'none',
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
        strokeStyle,
        opacity,
        roughness,
        startArrowhead,
        endArrowhead,
        arrowType,
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
        fontSize,
        fontFamily,
        fontFamilyKey,
        textAlign,
        align: textAlign,
        fill: color,
        opacity,
        rotation: 0,
      };
    default:
      return null;
  }
}

/** True only for real numbers Konva can render (rejects NaN/Infinity). */
export function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Normalize rectangle drag (any direction) -> positive w/h, top-left x/y. */
export function normalizeRect(x0, y0, x1, y1) {
  if (!isFiniteNum(x0) || !isFiniteNum(y0) || !isFiniteNum(x1) || !isFiniteNum(y1)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
}

/** Circle from center + pointer: radius is Euclidean distance. */
export function circleRadius(cx, cy, px, py) {
  if (!isFiniteNum(cx) || !isFiniteNum(cy) || !isFiniteNum(px) || !isFiniteNum(py)) return 0;
  const r = Math.hypot(px - cx, py - cy);
  return Number.isFinite(r) ? r : 0;
}

/** Diamond vertices for a bounding box (top, right, bottom, left). */
export function diamondPoints(x, y, width, height) {
  const sx = isFiniteNum(x) ? x : 0;
  const sy = isFiniteNum(y) ? y : 0;
  const sw = isFiniteNum(width) ? Math.max(1, width) : 1;
  const sh = isFiniteNum(height) ? Math.max(1, height) : 1;
  const cx = sx + sw / 2;
  const cy = sy + sh / 2;
  return [cx, sy, sx + sw, cy, cx, sy + sh, sx, cy];
}

/**
 * Corner radius for a rounded diamond — scales with the smaller side
 * (same spirit as the rectangle's min(w,h)/4 clamp).
 */
export function diamondCornerRadius(width, height) {
  const m = Math.min(Math.abs(width ?? 0), Math.abs(height ?? 0));
  return Math.max(2, Math.min(16, m * 0.12));
}

/**
 * Rounded-diamond polyline: each sharp vertex is cut by `radius` along
 * both incident edges, yielding 8 points (2 per corner). Rendered with
 * `lineJoin: 'round'` the cut corners read as visibly rounded while
 * edges stay straight. Falls back to diamondPoints() for tiny shapes.
 */
export function roundedDiamondPoints(x, y, width, height, radius) {
  if (!isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(width) || !isFiniteNum(height)) {
    return diamondPoints(0, 0, 1, 1);
  }
  const rr = isFiniteNum(radius) ? radius : diamondCornerRadius(width, height);
  const r = Math.max(0, rr);
  if (!(r > 0)) return diamondPoints(x, y, width, height);
  const cx = x + width / 2;
  const cy = y + height / 2;
  const verts = [
    [cx, y],
    [x + width, cy],
    [cx, y + height],
    [x, cy],
  ];
  const edgeLen = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const out = [];
  for (let i = 0; i < 4; i += 1) {
    const prev = verts[(i + 3) % 4];
    const cur = verts[i];
    const next = verts[(i + 1) % 4];
    const lenPrev = edgeLen(prev, cur);
    const lenNext = edgeLen(cur, next);
    const cut = Math.min(r, lenPrev / 2, lenNext / 2);
    if (cut <= 0) {
      out.push(cur[0], cur[1]);
      continue;
    }
    const pA = lerp(cur, prev, cut / lenPrev);
    const pB = lerp(cur, next, cut / lenNext);
    out.push(pA[0], pA[1], pB[0], pB[1]);
  }
  return out;
}

/**
 * Effective X/Y radii of a circle/ellipse shape.
 * Back-compat: legacy shapes carry only `radius` (uniform circle).
 * Scaled ellipses carry `radiusX`/`radiusY`.
 */
export function circleRadii(shape) {
  const legacyRaw = shape?.radius ?? 0;
  const legacy = isFiniteNum(legacyRaw) ? Math.max(0, legacyRaw) : 0;
  const rxRaw = shape?.radiusX ?? legacy;
  const ryRaw = shape?.radiusY ?? legacy;
  const rx = isFiniteNum(rxRaw) ? Math.max(0, rxRaw) : 0;
  const ry = isFiniteNum(ryRaw) ? Math.max(0, ryRaw) : 0;
  return { rx, ry };
}

/** Keep only finite numbers from a flat points array. */
export function sanitizePoints(points) {
  if (!Array.isArray(points)) return [];
  return points.filter((v) => isFiniteNum(v));
}

/**
 * Elbow (orthogonal right-angle) points for an arrow.
 * Straight 2-point input [x0,y0,x1,y1] becomes a 3-point orthogonal
 * path [start, corner, end] via the horizontal-then-vertical corner.
 * Already-bent arrows (>2 points) keep their committed bend points —
 * only degenerate 2-point arrows are orthogonalized.
 */
export function elbowPoints(points) {
  if (!Array.isArray(points) || points.length < 4) return points;
  if (points.length > 4) return points;
  const [x0, y0, x1, y1] = points;
  if (!isFiniteNum(x0) || !isFiniteNum(y0) || !isFiniteNum(x1) || !isFiniteNum(y1)) return points;
  return [x0, y0, x1, y0, x1, y1];
}

/**
 * Display points for a Konva <Arrow /> given its stored `arrowType`:
 * - 'elbow': orthogonalized via elbowPoints()
 * - 'curved' / 'straight': stored points verbatim (curvature comes from
 *   Konva `tension`, see ShapeRenderer tensionForArrowType)
 */
export function displayPointsForArrow(shape) {
  const pts = Array.isArray(shape?.points) ? shape.points : [];
  if ((shape?.arrowType ?? 'straight') === 'elbow') return elbowPoints(pts);
  return pts;
}

/** Konva tension for an arrow path shape (curved = smooth Bezier). */
export function tensionForArrowType(arrowType, pointCount = 4) {
  if (arrowType === 'elbow') return 0;
  if (arrowType === 'curved') return 0.5;
  // Straight 2-point arrows: no smoothing. Bent arrows keep a slight
  // curve so midpoint handles render smoothly.
  return pointCount > 4 ? 0.35 : 0;
}

/**
 * Arrow endpoint snapping (Sayon — connectors).
 *
 * World-space snap threshold for arrow tip/tail magnets. An endpoint
 * dragged within this radius of a target anchor snaps onto it.
 */
export const ARROW_SNAP_THRESHOLD = 14;

/**
 * Candidate connection anchors of a shape in WORLD coordinates.
 * Edge midpoints (+ center) for box-like shapes; the four vertices (+
 * center) for diamonds; the cardinal perimeter points (+ center) for
 * ellipses. Returns [] for shapes arrows cannot snap to (other arrows,
 * lines, freehand strokes, groups, unknown types).
 *
 * Each entry: { x, y, anchor: 'top' | 'right' | 'bottom' | 'left' | 'center' }.
 * Coordinates assume the at-rest convention (positioned shapes store world
 * x/y; point-path shapes store world points with the node pinned at 0).
 */
export function getShapeAnchors(shape) {
  if (!shape || typeof shape !== 'object') return [];
  if (shape.type === 'circle') {
    if (!isFiniteNum(shape.x) || !isFiniteNum(shape.y)) return [];
    const { rx, ry } = circleRadii(shape);
    const cx = shape.x;
    const cy = shape.y;
    return [
      { x: cx, y: cy - ry, anchor: 'top' },
      { x: cx + rx, y: cy, anchor: 'right' },
      { x: cx, y: cy + ry, anchor: 'bottom' },
      { x: cx - rx, y: cy, anchor: 'left' },
      { x: cx, y: cy, anchor: 'center' },
    ];
  }
  if (
    shape.type === 'rectangle' ||
    shape.type === 'diamond' ||
    shape.type === 'frame' ||
    shape.type === 'image'
  ) {
    if (
      !isFiniteNum(shape.x) ||
      !isFiniteNum(shape.y) ||
      !isFiniteNum(shape.width) ||
      !isFiniteNum(shape.height)
    ) {
      return [];
    }
    const { x, y, width, height } = shape;
    return [
      { x: x + width / 2, y, anchor: 'top' },
      { x: x + width, y: y + height / 2, anchor: 'right' },
      { x: x + width / 2, y: y + height, anchor: 'bottom' },
      { x, y: y + height / 2, anchor: 'left' },
      { x: x + width / 2, y: y + height / 2, anchor: 'center' },
    ];
  }
  return [];
}

/**
 * Nearest snap anchor to a world point across candidate shapes.
 * Skips the dragged arrow itself (`excludeId`), remote-preview ghosts,
 * and shapes without anchors. Returns
 * { x, y, shapeId, anchor } or null when nothing is within threshold.
 */
export function findSnapAnchor(worldX, worldY, shapes, opts = {}) {
  if (!isFiniteNum(worldX) || !isFiniteNum(worldY)) return null;
  const threshold = isFiniteNum(opts.threshold) ? Math.max(0, opts.threshold) : ARROW_SNAP_THRESHOLD;
  const excludeId = opts.excludeId ?? null;
  let best = null;
  let bestDist = Infinity;
  for (const s of shapes ?? []) {
    if (!s || s.remotePreview || s.id === excludeId) continue;
    for (const a of getShapeAnchors(s)) {
      const dist = Math.hypot(worldX - a.x, worldY - a.y);
      if (dist <= threshold && dist < bestDist) {
        bestDist = dist;
        best = { x: a.x, y: a.y, shapeId: s.id, anchor: a.anchor };
      }
    }
  }
  return best;
}

/**
 * New local points array with one arrow endpoint moved, middle bend
 * points preserved verbatim (curvature re-derives from the endpoints via
 * the stored tension/arrowType at render time).
 * `end` is 'start' (first pair) or 'end' (last pair). Returns null when
 * the input points or coordinates are unusable — callers must not commit.
 */
export function moveArrowEndpoint(points, end, x, y) {
  if (!Array.isArray(points) || points.length < 4) return null;
  if (!isFiniteNum(x) || !isFiniteNum(y)) return null;
  if (points.some((v) => !isFiniteNum(v))) return null;
  const next = [...points];
  if (end === 'start') {
    next[0] = x;
    next[1] = y;
  } else if (end === 'end') {
    next[next.length - 2] = x;
    next[next.length - 1] = y;
  } else {
    return null;
  }
  return next;
}

/**
 * Stored endpoint binding descriptor: { shapeId, anchor }.
 * Binds one arrow end to a target shape's named anchor so the arrow can
 * follow that shape on later moves. Null clears the binding.
 */
export function isValidBinding(binding) {
  if (binding === null || binding === undefined) return true;
  if (!binding || typeof binding !== 'object') return false;
  if (typeof binding.shapeId !== 'string' || !binding.shapeId) return false;
  return ['top', 'right', 'bottom', 'left', 'center'].includes(binding.anchor);
}

/**
 * Normalize a 0-100 opacity slider value to Konva 0-1.
 * Pass-through for already-normalized 0-1 values.
 */
export function konvaOpacity(opacity) {
  const v = opacity ?? DEFAULTS.opacity;
  if (typeof v !== 'number' || Number.isNaN(v)) return DEFAULTS.opacity;
  if (v > 1) return Math.min(1, Math.max(0, v / 100));
  return Math.min(1, Math.max(0, v));
}

/**
 * Deterministic text-width estimate in WORLD units (no canvas measurement,
 * so every Yjs collaborator computes the identical box from the same
 * text/fontSize): ~0.6 * fontSize per char of the longest line.
 * Used as the Konva <Text /> width fallback, the commit-time width seed,
 * and the bounds fallback for legacy shapes without a stored width.
 * Konva needs an explicit width for align (left/center/right) to have
 * any visible effect on multi-line text.
 */
export function estimateTextWidth(text, fontSize = DEFAULTS.fontSize) {
  const fs = isFiniteNum(fontSize) ? Math.max(1, fontSize) : DEFAULTS.fontSize;
  const longestLine = String(text ?? '')
    .split('\n')
    .reduce((m, l) => Math.max(m, l.length), 0);
  return Math.max(fs * 0.6, longestLine * fs * 0.6);
}

/**
 * Axis-aligned bounding box of a shape in WORLD coordinates.
 * Used for viewport culling, remote-selection highlights, and replay framing.
 * Returns { x, y, width, height } or null for unknown shapes.
 */
export function getShapeBounds(shape) {
  if (!shape || typeof shape !== 'object') return null;
  switch (shape.type) {
    case 'group': {
      // Composite group: prefer stored union bounds; fall back to the
      // union of children bounds (children stored relative to group origin).
      if (isFiniteNum(shape.width) && isFiniteNum(shape.height) && isFiniteNum(shape.x) && isFiniteNum(shape.y)) {
        return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
      }
      const kids = Array.isArray(shape.children) ? shape.children : [];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const ox = isFiniteNum(shape.x) ? shape.x : 0;
      const oy = isFiniteNum(shape.y) ? shape.y : 0;
      for (const k of kids) {
        const b = getShapeBounds(k);
        if (!b) continue;
        minX = Math.min(minX, ox + b.x);
        minY = Math.min(minY, oy + b.y);
        maxX = Math.max(maxX, ox + b.x + b.width);
        maxY = Math.max(maxY, oy + b.y + b.height);
      }
      if (!Number.isFinite(minX)) return null;
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    case 'rectangle':
    case 'diamond':
    case 'image':
    case 'frame':
      return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
    case 'circle': {
      const { rx, ry } = circleRadii(shape);
      return { x: shape.x - rx, y: shape.y - ry, width: rx * 2, height: ry * 2 };
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
      // Prefer the stored alignment-box width (committed at edit time);
      // fall back to the deterministic estimate for legacy shapes.
      const fontSize = shape.fontSize ?? DEFAULTS.fontSize;
      const text = shape.text ?? '';
      const lines = String(text).split('\n').length;
      const fs = isFiniteNum(fontSize) ? Math.max(1, fontSize) : DEFAULTS.fontSize;
      const width =
        isFiniteNum(shape.width) && shape.width >= 1
          ? shape.width
          : estimateTextWidth(text, fs);
      return {
        x: shape.x,
        y: shape.y,
        width,
        height: Math.max(fs, lines * fs * 1.2),
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
  // Morph hygiene: a JSON-merge update (`{ ...s, ...changes }`) cannot
  // delete keys, so a rectangle->circle morph would leave ghost
  // `width`/`height` (and circle->rectangle a ghost `radius*`). Strip
  // stale geometry here — every commit path normalizes — so morphed
  // shapes stay clean even for controlled/Yjs parents that merge.
  if (shape.type === 'circle' && (shape.width !== undefined || shape.height !== undefined)) {
    const { width, height, ...rest } = shape;
    void width;
    void height;
    return normalizeShape(rest);
  }
  if (
    shape.type === 'rectangle' &&
    (shape.radius !== undefined || shape.radiusX !== undefined || shape.radiusY !== undefined)
  ) {
    const { radius, radiusX, radiusY, ...rest } = shape;
    void radius;
    void radiusX;
    void radiusY;
    return normalizeShape(rest);
  }
  if (shape.type === 'rectangle' || shape.type === 'diamond' || shape.type === 'image' || shape.type === 'frame') {
    // Repair negatives AND non-finite geometry (NaN/Infinity from a
    // zero-distance pointer release) so Konva never sees bad attrs.
    const bad =
      !isFiniteNum(shape.x) ||
      !isFiniteNum(shape.y) ||
      !isFiniteNum(shape.width) ||
      !isFiniteNum(shape.height) ||
      shape.width < 0 ||
      shape.height < 0;
    if (bad) {
      const sx = isFiniteNum(shape.x) ? shape.x : 0;
      const sy = isFiniteNum(shape.y) ? shape.y : 0;
      const w = isFiniteNum(shape.width) ? shape.width : 0;
      const h = isFiniteNum(shape.height) ? shape.height : 0;
      const norm = normalizeRect(sx, sy, sx + w, sy + h);
      return { ...shape, ...norm };
    }
  }
  if (shape.type === 'circle') {
    const out = { ...shape };
    let dirty = false;
    if (!isFiniteNum(out.x)) {
      out.x = 0;
      dirty = true;
    }
    if (!isFiniteNum(out.y)) {
      out.y = 0;
      dirty = true;
    }
    if (!isFiniteNum(out.radius) || out.radius < 0) {
      out.radius = isFiniteNum(out.radius) ? Math.abs(out.radius) : 0;
      dirty = true;
    }
    if (out.radiusX !== undefined && (!isFiniteNum(out.radiusX) || out.radiusX < 0)) {
      out.radiusX = isFiniteNum(out.radiusX) ? Math.abs(out.radiusX) : out.radius;
      dirty = true;
    }
    if (out.radiusY !== undefined && (!isFiniteNum(out.radiusY) || out.radiusY < 0)) {
      out.radiusY = isFiniteNum(out.radiusY) ? Math.abs(out.radiusY) : out.radius;
      dirty = true;
    }
    return dirty ? out : shape;
  }
  if (shape.type === 'freehand' || shape.type === 'pen' || shape.type === 'line' || shape.type === 'arrow') {
    if (!Array.isArray(shape.points)) return { ...shape, points: [] };
    if (shape.points.some((v) => !isFiniteNum(v))) {
      return { ...shape, points: sanitizePoints(shape.points) };
    }
  }
  if (shape.type === 'arrow') {
    const t = shape.arrowType;
    if (t !== 'straight' && t !== 'curved' && t !== 'elbow') {
      return { ...shape, arrowType: DEFAULTS.arrowType };
    }
  }
  if (shape.type === 'image') {
    const out = { ...shape };
    let dirty = false;
    if (typeof out.src !== 'string' || !out.src.startsWith('data:')) return shape;
    for (const k of ['x', 'y']) {
      if (!isFiniteNum(out[k])) {
        out[k] = 0;
        dirty = true;
      }
    }
    for (const k of ['width', 'height']) {
      if (!isFiniteNum(out[k]) || out[k] <= 0) {
        out[k] = k === 'width' ? 320 : 240;
        dirty = true;
      }
    }
    if (!isFiniteNum(out.rotation)) {
      out.rotation = 0;
      dirty = true;
    }
    return dirty ? out : shape;
  }
  if (shape.type === 'frame') {
    const out = { ...shape };
    let dirty = false;
    if (typeof out.title !== 'string' || !out.title) {
      out.title = 'Frame';
      dirty = true;
    }
    for (const k of ['x', 'y', 'width', 'height']) {
      if (!isFiniteNum(out[k])) {
        out[k] = 0;
        dirty = true;
      }
    }
    if (out.width < 0) {
      out.width = Math.abs(out.width);
      dirty = true;
    }
    if (out.height < 0) {
      out.height = Math.abs(out.height);
      dirty = true;
    }
    if (!out.fill) {
      out.fill = 'rgba(241, 245, 249, 0.35)';
      dirty = true;
    }
    if (!out.stroke) {
      out.stroke = '#94a3b8';
      dirty = true;
    }
    if (!Array.isArray(out.dash)) {
      out.dash = [6, 6];
      dirty = true;
    }
    return dirty ? out : shape;
  }
  if (shape.type === 'group') {
    const out = { ...shape };
    let dirty = false;
    if (!Array.isArray(out.children)) {
      out.children = [];
      dirty = true;
    }
    for (const k of ['x', 'y', 'width', 'height']) {
      if (!isFiniteNum(out[k])) {
        out[k] = 0;
        dirty = true;
      }
    }
    if (out.width < 0) {
      out.width = Math.abs(out.width);
      dirty = true;
    }
    if (out.height < 0) {
      out.height = Math.abs(out.height);
      dirty = true;
    }
    return dirty ? out : shape;
  }
  if (shape.type === 'text') {
    const out = { ...shape };
    if (typeof out.text !== 'string') out.text = String(out.text ?? '');
    // `align` is the canonical Excalidraw-parity field; `textAlign` kept
    // as a back-compat alias. Normalize so both agree.
    const a = out.align ?? out.textAlign ?? DEFAULTS.textAlign;
    out.align = a;
    out.textAlign = a;
    // Alignment-box width: Konva needs an explicit width for align to
    // affect multi-line layout. Repair missing/non-finite widths with the
    // deterministic estimate so legacy shapes align too.
    if (!isFiniteNum(out.width) || out.width < 1) {
      out.width = estimateTextWidth(out.text, out.fontSize);
    }
    // `fontFamily` is canonical CSS string; `fontFamilyKey` is the picker key.
    if (typeof out.fontFamily !== 'string' || !out.fontFamily) {
      out.fontFamily = FONT_FAMILIES[out.fontFamilyKey] ?? DEFAULTS.fontFamily;
    }
    if (!out.fontFamilyKey && typeof out.fontFamily === 'string') {
      const hit =
        Object.entries(FONT_FAMILIES).find(([, css]) => css === out.fontFamily) ??
        Object.entries(LEGACY_FONT_FAMILIES).find(([, css]) => css === out.fontFamily);
      if (hit) out.fontFamilyKey = hit[0];
    }
    return out;
  }
  return shape;
}

/**
 * Bake a Konva drag offset into the data model so stored coords stay
 * normalized (no leftover dx/dy for shapes that keep absolute points).
 * - rect/circle/diamond/text: node x/y ARE the model x/y -> take directly.
 *   (Diamond points are origin-relative, so drag commits ONLY x/y and
 *   never mutates the points array — no double transform.)
 * - freehand/pen/line/arrow: points are ABSOLUTE world coords and the node
 *   is pinned at (0, 0) at rest (see ShapeRenderer), so the drag offset IS
 *   the node position: newPoints = points + (nodeX, nodeY), reset x/y to 0.
 *   NEVER subtract shape.x/shape.y here — a stale origin in the store
 *   would otherwise double-apply and teleport the stroke.
 */
export function bakeDragEnd(shape, nodeX, nodeY) {
  if (!isFiniteNum(nodeX) || !isFiniteNum(nodeY)) return null;
  if (shape.type === 'freehand' || shape.type === 'pen' || shape.type === 'line' || shape.type === 'arrow') {
    const dx = nodeX;
    const dy = nodeY;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    if (dx === 0 && dy === 0) return null;
    const src = sanitizePoints(shape.points);
    if (src.length < 4) return null;
    const points = src.map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
    if (points.some((v) => !Number.isFinite(v))) return null;
    return { x: 0, y: 0, points };
  }
  if (nodeX === shape.x && nodeY === shape.y) return null;
  return { x: nodeX, y: nodeY };
}

/**
 * Bake Konva Transformer scale/rotation into the data model.
 */
export function bakeTransform(shape, { scaleX, scaleY, rotation }) {
  const changes = {};
  if (isFiniteNum(rotation) && rotation !== (shape.rotation ?? 0)) {
    changes.rotation = rotation;
  }
  const sx = isFiniteNum(scaleX) ? scaleX : 1;
  const sy = isFiniteNum(scaleY) ? scaleY : 1;
  if (sx === 1 && sy === 1) return Object.keys(changes).length ? changes : null;

  if (shape.type === 'rectangle' || shape.type === 'diamond' || shape.type === 'image' || shape.type === 'frame' || shape.type === 'group') {
    const w = isFiniteNum(shape.width) ? shape.width : 0;
    const h = isFiniteNum(shape.height) ? shape.height : 0;
    const nw = Math.abs(w * sx);
    const nh = Math.abs(h * sy);
    if (!Number.isFinite(nw) || !Number.isFinite(nh)) {
      return Object.keys(changes).length ? changes : null;
    }
    changes.width = Math.max(1, nw);
    changes.height = Math.max(1, nh);
  } else if (shape.type === 'circle') {
    // Ellipse-aware scaling: uniform drags keep the legacy `radius`
    // circle; non-uniform drags bake into `radiusX`/`radiusY` so a
    // circle can become an ellipse (and back) without visual jumps.
    const ax = Math.abs(sx);
    const ay = Math.abs(sy);
    const { rx, ry } = circleRadii(shape);
    const nextRx = Math.max(1, rx * ax);
    const nextRy = Math.max(1, ry * ay);
    const uniform = Math.abs(ax - ay) / Math.max(ax, ay, 1e-9) < 0.02;
    if (uniform && shape.radiusX === undefined && shape.radiusY === undefined) {
      const base = isFiniteNum(shape.radius) ? shape.radius : 0;
      const scaled = base * Math.max(ax, ay);
      if (Number.isFinite(scaled)) changes.radius = Math.max(1, scaled);
    } else if (uniform && Math.abs(nextRx - nextRy) / Math.max(nextRx, nextRy, 1e-9) < 0.02) {
      // Ellipse scaled back to (near-)uniform: collapse to a circle.
      // (Keep radiusX/radiusY present-but-equal — JSON merge can't
      // delete keys, and equal radii render as a circle.)
      const r = Math.max(1, (nextRx + nextRy) / 2);
      changes.radius = r;
      changes.radiusX = r;
      changes.radiusY = r;
    } else {
      changes.radiusX = nextRx;
      changes.radiusY = nextRy;
      // Keep legacy `radius` in sync (mean) for old readers.
      changes.radius = Math.max(1, (nextRx + nextRy) / 2);
    }
  } else if (shape.type === 'text') {
    const uniform = (Math.abs(sx) + Math.abs(sy)) / 2;
    const base = isFiniteNum(shape.fontSize) ? shape.fontSize : DEFAULTS.fontSize;
    const next = Math.round(base * uniform);
    if (Number.isFinite(next)) changes.fontSize = Math.max(8, next);
    // Keep the alignment box in sync with the font scale so multi-line
    // align keeps working after a transformer resize.
    const curW = isFiniteNum(shape.width) ? shape.width : estimateTextWidth(shape.text, base);
    if (Number.isFinite(curW * uniform)) changes.width = Math.max(8, curW * uniform);
  } else if (shape.type === 'freehand' || shape.type === 'pen' || shape.type === 'line' || shape.type === 'arrow') {
    // Scale absolute points around origin, reset node offset.
    const src = sanitizePoints(shape.points);
    if (src.length < 4) return Object.keys(changes).length ? changes : null;
    const scaled = src.map((v, i) => (i % 2 === 0 ? v * sx : v * sy));
    if (scaled.some((v) => !Number.isFinite(v))) {
      return Object.keys(changes).length ? changes : null;
    }
    changes.points = scaled;
    changes.x = 0;
    changes.y = 0;
  }
  return Object.keys(changes).length ? changes : null;
}

/**
 * Morphs a shape into a target type while preserving its visual bounding box,
 * style properties (stroke, fill, opacity, rotation), and unique ID.
 *
 * Konva's geometric models differ per type (rectangles use top-left origin
 * + width/height; circles use center origin + radius), so the morph always
 * routes through the source's visual bounding box [x, y, width, height] —
 * simply flipping `shape.type` would collapse or offset the shape.
 * The result is built fresh from shared `base` props, so no stale
 * geometry keys (`width` on circles, `radius` on rectangles) survive to
 * pollute JSON-merge updates.
 */
export function morphShape(shape, targetType) {
  if (!shape || shape.type === targetType) return shape;

  // 1. Calculate the standard visual bounding box [x, y, width, height] of the source shape
  let x = shape.x ?? 0;
  let y = shape.y ?? 0;
  let width = shape.width ?? 100;
  let height = shape.height ?? 100;

  if (shape.type === 'circle') {
    const rx = shape.radiusX ?? shape.radius ?? 50;
    const ry = shape.radiusY ?? shape.radius ?? 50;
    x = shape.x - rx;
    y = shape.y - ry;
    width = rx * 2;
    height = ry * 2;
  }

  if (
    !isFiniteNum(x) ||
    !isFiniteNum(y) ||
    !isFiniteNum(width) ||
    !isFiniteNum(height) ||
    !(width > 0) ||
    !(height > 0)
  ) {
    return shape;
  }

  // Base shared properties to keep intact
  const base = {
    id: shape.id,
    type: targetType,
    stroke: shape.stroke ?? '#1e1e1e',
    strokeWidth: shape.strokeWidth ?? 2,
    fill: shape.fill ?? 'transparent',
    opacity: shape.opacity ?? 1,
    rotation: shape.rotation ?? 0,
    dash: shape.dash,
    strokeStyle: shape.strokeStyle,
  };

  // 2. Build target shape structure according to Konva's renderer schema
  switch (targetType) {
    case 'circle': {
      const radius = Math.max(1, Math.min(width, height) / 2);
      return {
        ...base,
        x: x + width / 2,
        y: y + height / 2,
        radius,
        radiusX: Math.max(1, width / 2),
        radiusY: Math.max(1, height / 2),
      };
    }

    case 'rectangle':
    case 'frame': {
      return {
        ...base,
        x,
        y,
        width,
        height,
        roundness: shape.roundness ?? 'sharp',
      };
    }

    case 'diamond': {
      return {
        ...base,
        x,
        y,
        width,
        height,
      };
    }

    default:
      console.warn(`[Morph] Unsupported morph target: ${targetType}`);
      return shape;
  }
}

/**
 * In-place morph between rectangle <-> circle.
 * Thin wrapper over `morphShape` preserving the original contract:
 * returns a NEW plain shape object, or null for unsupported conversions
 * (use `morphShape` directly for diamond/frame targets).
 */
export function convertShapeType(shape, targetType) {
  if (!shape || typeof shape !== 'object') return null;
  const target = typeof targetType === 'string' ? targetType.toLowerCase() : '';
  const normTarget = target === 'ellipse' ? 'circle' : target === 'rect' ? 'rectangle' : target;
  if (normTarget !== 'rectangle' && normTarget !== 'circle') return null;
  const source = typeof shape.type === 'string' ? shape.type.toLowerCase() : '';
  if (source !== 'rectangle' && source !== 'circle') return null;
  if (source === normTarget) return { ...shape, type: normTarget };
  const morphed = morphShape(shape, normTarget);
  return morphed === shape ? null : morphed;
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
  // Canonical `shape-<uuid>` plus Week-2 `img-*` / `frame-*` ids.
  if (typeof shape.id !== 'string' || !shape.id) return false;
  const okId =
    shape.id.startsWith('shape-') || shape.id.startsWith('img-') || shape.id.startsWith('frame-');
  if (!okId) return false;
  if (!SHAPE_TYPES.includes(shape.type)) {
    // Back-compat: legacy freehand blobs were stored as type 'line',
    // and some callers emit type 'pen' for the freehand tool.
    if (shape.type !== 'line' && shape.type !== 'pen') return false;
  }
  return true;
}

/**
 * Center point of a shape in WORLD coordinates (for frame containment).
 * Point-path shapes use their bounding-box center; positioned shapes use
 * their geometric center.
 */
export function shapeCenter(shape) {
  if (!shape || typeof shape !== 'object') return null;
  if (
    shape.type === 'freehand' ||
    shape.type === 'pen' ||
    shape.type === 'line' ||
    shape.type === 'arrow'
  ) {
    const b = getShapeBounds(shape);
    if (!b) return null;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  if (shape.type === 'circle') {
    return isFiniteNum(shape.x) && isFiniteNum(shape.y) ? { x: shape.x, y: shape.y } : null;
  }
  if (shape.type === 'text') {
    const b = getShapeBounds(shape);
    if (!b) return null;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  // rectangle / diamond / image / frame: x/y is top-left.
  if (!isFiniteNum(shape.x) || !isFiniteNum(shape.y)) return null;
  return {
    x: shape.x + (isFiniteNum(shape.width) ? shape.width : 0) / 2,
    y: shape.y + (isFiniteNum(shape.height) ? shape.height : 0) / 2,
  };
}

/** True when a shape's center falls inside a frame's bounds. */
export function isShapeInsideFrame(shape, frame) {
  const c = shapeCenter(shape);
  if (!c || !frame || frame.type !== 'frame') return false;
  if (!isFiniteNum(frame.x) || !isFiniteNum(frame.y)) return false;
  if (!isFiniteNum(frame.width) || !isFiniteNum(frame.height)) return false;
  return (
    c.x >= frame.x &&
    c.x <= frame.x + frame.width &&
    c.y >= frame.y &&
    c.y <= frame.y + frame.height
  );
}

/**
 * Clone a shape for duplicate: fresh `shape-<uuid>` id + slight
 * (+16,+16 world px) offset so the copy is visible next to the original.
 * The offset is applied EXACTLY once per representation:
 * - freehand/pen/line/arrow carry ABSOLUTE points with the node pinned at
 *   (0, 0), so only the points shift (x/y forced back to 0). Offsetting
 *   both would double-apply and teleport the copy.
 * - rect/circle/diamond/text are positioned by x/y (diamond points are
 *   origin-relative), so only x/y shift — points are never touched.
 */
export function duplicateShape(shape, offset = 16) {
  const clone = serializeShape(shape);
  if (!clone) return null;
  clone.id = createShapeId();
  if (clone.type === 'group' && Array.isArray(clone.children)) {
    // Deep-clone children with fresh ids, shifted with the group origin.
    clone.children = clone.children.map((k) => {
      const kc = serializeShape(k);
      if (!kc) return k;
      if (typeof kc.id === 'string') kc.id = createShapeId();
      return kc;
    });
    if (typeof clone.x === 'number') clone.x += offset;
    if (typeof clone.y === 'number') clone.y += offset;
    return clone;
  }
  if (
    (clone.type === 'freehand' ||
      clone.type === 'pen' ||
      clone.type === 'line' ||
      clone.type === 'arrow') &&
    Array.isArray(clone.points)
  ) {
    clone.points = clone.points.map((v) => v + offset);
    clone.x = 0;
    clone.y = 0;
  } else {
    if (typeof clone.x === 'number') clone.x += offset;
    if (typeof clone.y === 'number') clone.y += offset;
  }
  return clone;
}

/** Axis-aligned rect intersection test (marquee selection). */
export function boxesIntersect(a, b) {
  if (!a || !b) return false;
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  return a.x <= bx2 && ax2 >= b.x && a.y <= by2 && ay2 >= b.y;
}

/** Normalize a marquee drag into a positive w/h rect (world coords). */
export function normalizeSelectBox(x0, y0, x1, y1) {
  return normalizeRect(x0, y0, x1, y1);
}

/** Squared distance from point P to segment AB (flat numbers). */
function pointSegDistSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 0) t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/**
 * Eraser contact test: true when a world-space point touches the shape.
 * Closed shapes hit anywhere inside their (tolerance-expanded) bounds;
 * path shapes hit within strokeWidth/2 + tolerance of any segment;
 * groups translate the point into child-local coords and test children.
 * Pure — drives drag-erase in useCanvasDrawing.
 */
export function isShapeIntersectingPoint(shape, point, tolerance = 8) {
  if (!shape || typeof shape !== 'object') return false;
  if (!point || !isFiniteNum(point.x) || !isFiniteNum(point.y)) return false;
  const tol = isFiniteNum(tolerance) && tolerance >= 0 ? tolerance : 8;
  const { x: px, y: py } = point;

  if (shape.type === 'group') {
    const kids = Array.isArray(shape.children) ? shape.children : [];
    const ox = isFiniteNum(shape.x) ? shape.x : 0;
    const oy = isFiniteNum(shape.y) ? shape.y : 0;
    return kids.some((k) => isShapeIntersectingPoint(k, { x: px - ox, y: py - oy }, tol));
  }

  if (shape.type === 'circle') {
    if (!isFiniteNum(shape.x) || !isFiniteNum(shape.y)) return false;
    const { rx, ry } = circleRadii(shape);
    const r = Math.max(rx, ry) + tol;
    return Math.hypot(px - shape.x, py - shape.y) <= r;
  }

  if (
    shape.type === 'freehand' ||
    shape.type === 'pen' ||
    shape.type === 'line' ||
    shape.type === 'arrow'
  ) {
    const pts = sanitizePoints(shape.points);
    if (pts.length < 2) return false;
    const sw = isFiniteNum(shape.strokeWidth) ? shape.strokeWidth : DEFAULTS.strokeWidth;
    const hitSq = (sw / 2 + tol) * (sw / 2 + tol);
    if (pts.length === 2) {
      // Single-point stroke: radial hit around the dot.
      return Math.hypot(px - pts[0], py - pts[1]) <= Math.sqrt(hitSq);
    }
    for (let i = 0; i + 3 < pts.length + 1; i += 2) {
      if (pointSegDistSq(px, py, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]) <= hitSq) return true;
    }
    return false;
  }

  // rectangle / diamond / image / frame / text: expanded-bounds contact.
  const b = getShapeBounds(shape);
  if (!b || !isFiniteNum(b.x) || !isFiniteNum(b.y)) return false;
  const w = isFiniteNum(b.width) ? Math.abs(b.width) : 0;
  const h = isFiniteNum(b.height) ? Math.abs(b.height) : 0;
  const nx = Math.min(b.x, b.x + b.width);
  const ny = Math.min(b.y, b.y + b.height);
  return px >= nx - tol && px <= nx + w + tol && py >= ny - tol && py <= ny + h + tol;
}

/**
 * Group selected shapes into a composite group. Children are re-based
 * relative to the group's top-left origin so the Group node owns placement;
 * drags of the group move x/y only. Returns the group shape (caller removes
 * the originals and commits the group), or null when < 2 shapes.
 */
export function createGroupShape(shapes) {
  const list = (shapes ?? []).filter(Boolean);
  if (list.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const boundsOf = new Map();
  for (const s of list) {
    const b = getShapeBounds(s);
    if (!b) return null;
    boundsOf.set(s.id, b);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!Number.isFinite(minX)) return null;
  const children = list.map((s) => {
    const c = serializeShape(s);
    if (!c) return null;
    const b = boundsOf.get(s.id);
    // Re-base positioned children relative to the group origin; point-path
    // children shift their absolute points by (-minX, -minY).
    if (
      (c.type === 'freehand' || c.type === 'pen' || c.type === 'line' || c.type === 'arrow') &&
      Array.isArray(c.points)
    ) {
      c.points = c.points.map((v, i) => (i % 2 === 0 ? v - minX : v - minY));
      c.x = 0;
      c.y = 0;
    } else if (c.type === 'circle') {
      if (isFiniteNum(c.x)) c.x -= minX;
      if (isFiniteNum(c.y)) c.y -= minY;
    } else {
      if (isFiniteNum(c.x)) c.x -= minX;
      if (isFiniteNum(c.y)) c.y -= minY;
    }
    void b;
    return c;
  }).filter(Boolean);
  return {
    id: createShapeId(),
    type: 'group',
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    rotation: 0,
    children,
  };
}

/**
 * Ungroup a composite group back into world-coord children with fresh
 * validity (same ids preserved so collab deletes stay idempotent).
 * Children positions are restored by adding the group origin back.
 */
export function ungroupShape(group) {
  if (!group || group.type !== 'group' || !Array.isArray(group.children)) return [];
  const ox = isFiniteNum(group.x) ? group.x : 0;
  const oy = isFiniteNum(group.y) ? group.y : 0;
  return group.children.map((k) => {
    const c = serializeShape(k);
    if (!c) return null;
    if (
      (c.type === 'freehand' || c.type === 'pen' || c.type === 'line' || c.type === 'arrow') &&
      Array.isArray(c.points)
    ) {
      c.points = c.points.map((v, i) => (i % 2 === 0 ? v + ox : v + oy));
      c.x = 0;
      c.y = 0;
    } else {
      if (isFiniteNum(c.x)) c.x += ox;
      if (isFiniteNum(c.y)) c.y += oy;
    }
    return c;
  }).filter(Boolean);
}
