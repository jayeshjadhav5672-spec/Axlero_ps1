import { getShapeBounds } from './shapes.js';

export const SNAP_THRESHOLD = 5;

/**
 * snapping.js — pure geometric snapping computations (no Konva deps).
 *
 * During `onDragMove` of any shape, the moving shape's edges and center
 * (x, y, x + width/2, x + width, y + height/2, y + height) are compared
 * against all other visible shapes. Within SNAP_THRESHOLD (5px) the
 * moving coordinate snaps to the target edge/center and a snap line
 * descriptor `{ orientation: 'vertical' | 'horizontal', position: number }`
 * is returned for the guidelines layer.
 */

function verticalGuidesOf(bounds) {
  if (!bounds) return [];
  return [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width];
}

function horizontalGuidesOf(bounds) {
  if (!bounds) return [];
  return [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height];
}

function isFiniteBounds(b) {
  return (
    b &&
    Number.isFinite(b.x) &&
    Number.isFinite(b.y) &&
    Number.isFinite(b.width) &&
    Number.isFinite(b.height)
  );
}

/**
 * Compute snap offsets for a moving bounds box against sibling bounds.
 *
 * @param {{x,y,width,height}} movingBounds - moving shape bounds at its
 *   current (unsnapped) drag position, in world coords.
 * @param {Array<{x,y,width,height}>} otherBoundsList - sibling bounds.
 * @param {number} threshold - snap threshold in px (default 5).
 * @returns {{ dx: number, dy: number, lines: Array<{orientation, position}> }}
 */
export function getSnapLines(movingBounds, otherBoundsList, threshold = SNAP_THRESHOLD) {
  const lines = [];
  if (!isFiniteBounds(movingBounds)) return { dx: 0, dy: 0, lines };
  const tol = Number.isFinite(threshold) ? threshold : SNAP_THRESHOLD;

  const moveV = verticalGuidesOf(movingBounds);
  const moveH = horizontalGuidesOf(movingBounds);

  let bestDX = 0;
  let bestDY = 0;
  let bestDistX = Infinity;
  let bestDistY = Infinity;
  let snapX = null;
  let snapY = null;

  for (const other of otherBoundsList ?? []) {
    if (!isFiniteBounds(other)) continue;
    const otherV = verticalGuidesOf(other);
    const otherH = horizontalGuidesOf(other);
    for (const mv of moveV) {
      if (!Number.isFinite(mv)) continue;
      for (const ov of otherV) {
        if (!Number.isFinite(ov)) continue;
        const dist = Math.abs(mv - ov);
        if (dist <= tol && dist < bestDistX) {
          bestDistX = dist;
          bestDX = ov - mv;
          snapX = ov;
        }
      }
    }
    for (const mh of moveH) {
      if (!Number.isFinite(mh)) continue;
      for (const oh of otherH) {
        if (!Number.isFinite(oh)) continue;
        const dist = Math.abs(mh - oh);
        if (dist <= tol && dist < bestDistY) {
          bestDistY = dist;
          bestDY = oh - mh;
          snapY = oh;
        }
      }
    }
  }

  if (snapX !== null) lines.push({ orientation: 'vertical', position: snapX });
  if (snapY !== null) lines.push({ orientation: 'horizontal', position: snapY });
  return { dx: bestDX, dy: bestDY, lines };
}

/**
 * Convenience: snap a moving shape (descriptor + drag position) against
 * sibling shape descriptors. Resolves bounds via `getShapeBounds`.
 *
 * @param {object} movingShape - the dragged shape descriptor.
 * @param {{x:number,y:number}} dragPos - current node position (world px
 *   for positioned shapes; offset for absolute-points shapes).
 * @param {Array<object>} siblingShapes - all other visible shapes.
 * @param {number} threshold
 * @returns {{ dx, dy, lines, movingBounds }}
 */
export function snapMovingShape(movingShape, dragPos, siblingShapes, threshold = SNAP_THRESHOLD) {
  if (!movingShape) return { dx: 0, dy: 0, lines: [], movingBounds: null };
  const base = getShapeBounds(movingShape);
  if (!base) return { dx: 0, dy: 0, lines: [], movingBounds: null };

  // Positioned shapes (rect/circle/diamond/text/image/frame): bounds move
  // with the node. Absolute-points shapes (freehand/line/arrow): bounds
  // shift by the node offset.
  const isPointBased =
    movingShape.type === 'freehand' ||
    movingShape.type === 'pen' ||
    movingShape.type === 'line' ||
    movingShape.type === 'arrow';
  let movingBounds;
  if (isPointBased) {
    const dx = Number.isFinite(dragPos?.x) ? dragPos.x : 0;
    const dy = Number.isFinite(dragPos?.y) ? dragPos.y : 0;
    movingBounds = { ...base, x: base.x + dx, y: base.y + dy };
  } else {
    const nx = Number.isFinite(dragPos?.x) ? dragPos.x : base.x;
    const ny = Number.isFinite(dragPos?.y) ? dragPos.y : base.y;
    movingBounds = { ...base, x: nx, y: ny };
  }

  const others = (siblingShapes ?? [])
    .map((s) => getShapeBounds(s))
    .filter(isFiniteBounds);
  const { dx, dy, lines } = getSnapLines(movingBounds, others, threshold);
  return { dx, dy, lines, movingBounds };
}
