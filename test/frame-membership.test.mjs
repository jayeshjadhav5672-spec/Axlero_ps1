/**
 * frame-membership.test.mjs — rotation-aware frame membership (no DOM).
 *
 * shapeCenter() must track the Konva-rendered geometry: ShapeRenderer sets
 * `rotation` (degrees, clockwise) on every node with NO offset, so
 * positioned shapes (rectangle/diamond/image/text/frame/group) rotate about
 * their position — top-left (x, y) — while circles pivot about their center
 * (invariant). Membership (isShapeInsideFrame / frameMembers /
 * computeFrameDropBatch) therefore uses the ROTATED visible center, so a
 * frame drag moves exactly the shapes visibly inside it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeFrameDropBatch,
  frameMembers,
  isShapeInsideFrame,
  rotatePoint,
  shapeCenter,
} from '../src/components/canvas/utils/shapes.js';

function close(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

function closePoint(actual, expected, label) {
  close(actual.x, expected.x, `${label}.x`);
  close(actual.y, expected.y, `${label}.y`);
}

describe('rotation-aware shapeCenter', () => {
  it('90° rectangle center rotates about the top-left pivot', () => {
    // At-rest center (60,45) about pivot (10,20) by +90° → (-15,70).
    const c = shapeCenter({
      id: 'shape-r', type: 'rectangle', x: 10, y: 20, width: 100, height: 50, rotation: 90,
    });
    closePoint(c, { x: -15, y: 70 }, 'center90');
  });

  it('45° rectangle center matches rotatePoint about top-left', () => {
    const rect = {
      id: 'shape-r', type: 'rectangle', x: 100, y: 100, width: 100, height: 50, rotation: 45,
    };
    const expected = rotatePoint(150, 125, 100, 100, 45);
    closePoint(shapeCenter(rect), expected, 'center45');
    // Sanity: the rotated center genuinely left the at-rest box center.
    assert.ok(Math.abs(shapeCenter(rect).x - 150) > 1, 'moved in x');
    assert.ok(Math.abs(shapeCenter(rect).y - 125) > 1, 'moved in y');
  });

  it('diamond and image share the top-left pivot', () => {
    for (const type of ['diamond', 'image']) {
      const c = shapeCenter({
        id: `shape-${type}`, type, x: 10, y: 20, width: 100, height: 50, rotation: 90,
      });
      closePoint(c, { x: -15, y: 70 }, `${type}90`);
      const c45 = shapeCenter({
        id: `shape-${type}`, type, x: 100, y: 100, width: 100, height: 50, rotation: 45,
      });
      closePoint(c45, rotatePoint(150, 125, 100, 100, 45), `${type}45`);
    }
  });

  it('unrotated behavior is unchanged (missing / 0 rotation, circle, text)', () => {
    const rect = { id: 'shape-r', type: 'rectangle', x: 10, y: 20, width: 100, height: 50 };
    assert.deepEqual(shapeCenter(rect), { x: 60, y: 45 });
    assert.deepEqual(shapeCenter({ ...rect, rotation: 0 }), { x: 60, y: 45 });
    // Circle pivots about its own center: rotation-invariant by construction.
    assert.deepEqual(
      shapeCenter({ id: 'shape-c', type: 'circle', x: 60, y: 45, radius: 25, rotation: 45 }),
      { x: 60, y: 45 },
    );
    // Text rotates about top-left like boxes: unrotated text is untouched.
    assert.deepEqual(
      shapeCenter({ id: 'shape-t', type: 'text', x: 10, y: 20, text: 'hi', fontSize: 20 }),
      shapeCenter({ id: 'shape-t', type: 'text', x: 10, y: 20, text: 'hi', fontSize: 20, rotation: 0 }),
    );
  });

  it('point-path shapes keep stored-geometry centers (no origin-swing)', () => {
    const stroke = { id: 'shape-s', type: 'freehand', points: [20, 20, 40, 60] };
    assert.deepEqual(shapeCenter(stroke), { x: 30, y: 40 });
    // Even with a rotation key present, membership follows the stored world
    // points (nodes pin at the stage origin; see shapeCenter docs).
    assert.deepEqual(shapeCenter({ ...stroke, rotation: 45 }), { x: 30, y: 40 });
  });
});

describe('rotation-aware frame membership (visible-geometry-wins)', () => {
  const RECT90 = {
    id: 'shape-r', type: 'rectangle', x: 10, y: 20, width: 100, height: 50, rotation: 90,
  };

  it('membership follows visible geometry, not the at-rest box', () => {
    // Rotated center (-15,70); at-rest center (60,45).
    const hitFrame = { id: 'frame-hit', type: 'frame', x: -30, y: 55, width: 30, height: 30 };
    const missFrame = { id: 'frame-miss', type: 'frame', x: 40, y: 30, width: 40, height: 30 };
    assert.equal(isShapeInsideFrame(RECT90, hitFrame), true);
    assert.equal(isShapeInsideFrame(RECT90, missFrame), false);
    assert.deepEqual(frameMembers([RECT90, hitFrame], hitFrame).map((s) => s.id), ['shape-r']);
    assert.deepEqual(frameMembers([RECT90, missFrame], missFrame), []);
  });

  it('near-boundary: edge-inclusive center vs just-outside exclusion', () => {
    const rect = {
      id: 'shape-r', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 45,
    };
    const c = shapeCenter(rect);
    // Frame corner ~exactly on the rotated center → inside (edges are
    // inclusive). The +1e-9 slack absorbs float-trig dust: (c.x-5)+5 is not
    // bit-identical to c.x in doubles, and the dust (~1e-15) is orders of
    // magnitude below any real geometry.
    const edge = { id: 'frame-e', type: 'frame', x: c.x - 5, y: c.y - 5, width: 5 + 1e-9, height: 5 + 1e-9 };
    assert.equal(isShapeInsideFrame(rect, edge), true);
    // The same frame does NOT contain the at-rest center (5,5): the
    // boundary discriminates rotated vs unrotated geometry.
    assert.equal(isShapeInsideFrame({ ...rect, rotation: 0 }, edge), false);
    // Frame starting a hair past the rotated center → outside.
    const outside = { id: 'frame-o', type: 'frame', x: c.x + 1e-6, y: c.y - 5, width: 5, height: 5 };
    assert.equal(isShapeInsideFrame(rect, outside), false);
  });

  it('multi-frame determinism: first frame in array order wins ties', () => {
    const frameA = { id: 'frame-a', type: 'frame', x: -50, y: 50, width: 100, height: 50 };
    const frameB = { id: 'frame-b', type: 'frame', x: -30, y: 60, width: 100, height: 50 };
    // Both frames contain the rotated center (-15,70).
    assert.equal(isShapeInsideFrame(RECT90, frameA), true);
    assert.equal(isShapeInsideFrame(RECT90, frameB), true);
    assert.deepEqual(frameMembers([RECT90, frameA, frameB], frameA).map((s) => s.id), ['shape-r']);
    assert.deepEqual(frameMembers([RECT90, frameA, frameB], frameB).map((s) => s.id), ['shape-r']);
    // Renderer-equivalent host resolution (ShapeRenderer FrameGroupNode
    // partition): first containing frame in array order claims the shape.
    const hostOf = (frames) => frames.find((f) => frameMembers([RECT90], f).length > 0).id;
    assert.equal(hostOf([frameA, frameB]), 'frame-a');
    assert.equal(hostOf([frameB, frameA]), 'frame-b');
  });

  it('frame drag moves only visible members (pure batch)', () => {
    const frame = { id: 'frame-1', type: 'frame', x: 0, y: 0, width: 200, height: 200 };
    const rectIn = { id: 'shape-in', type: 'rectangle', x: 10, y: 10, width: 40, height: 40 };
    // At-rest center (50,175) is inside, but the visible center (0,205)
    // rotated 90° about top-left (10,165) falls outside → NOT a member.
    const rectEdge = {
      id: 'shape-edge', type: 'rectangle', x: 10, y: 165, width: 80, height: 20, rotation: 90,
    };
    assert.ok(shapeCenter(rectEdge) !== null);
    closePoint(shapeCenter(rectEdge), { x: 0, y: 205 }, 'edge center');
    assert.equal(isShapeInsideFrame(rectEdge, frame), false);
    // At-rest center (230,60) is outside, but the visible center (180,90)
    // rotated 90° about (190,50) lands inside → IS a member.
    const rectSpin = {
      id: 'shape-spin', type: 'rectangle', x: 190, y: 50, width: 80, height: 20, rotation: 90,
    };
    closePoint(shapeCenter(rectSpin), { x: 180, y: 90 }, 'spin center');
    assert.equal(isShapeInsideFrame(rectSpin, frame), true);
    const batch = computeFrameDropBatch({
      frame, dx: 10, dy: 5, shapes: [frame, rectIn, rectEdge, rectSpin],
    });
    assert.deepEqual(batch, [
      { id: 'frame-1', changes: { x: 10, y: 5 } },
      { id: 'shape-in', changes: { x: 20, y: 15 } },
      { id: 'shape-spin', changes: { x: 200, y: 55 } },
    ]);
  });

  it('frames and previews are still never members (rotated or not)', () => {
    const frame = { id: 'frame-1', type: 'frame', x: 0, y: 0, width: 200, height: 200 };
    const inner = { id: 'frame-2', type: 'frame', x: 10, y: 10, width: 20, height: 20 };
    const ghost = {
      id: 'shape-g', type: 'rectangle', x: 10, y: 10, width: 40, height: 40, rotation: 45,
      remotePreview: true,
    };
    const spin = {
      id: 'shape-s', type: 'rectangle', x: 10, y: 10, width: 40, height: 40, rotation: 45,
    };
    assert.deepEqual(
      frameMembers([spin, ghost, inner, frame], frame).map((s) => s.id),
      ['shape-s'],
    );
  });
});
