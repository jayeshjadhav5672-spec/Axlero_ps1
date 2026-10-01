/**
 * rotated-anchors.test.mjs — rotation-aware arrow anchors (no DOM).
 *
 * getShapeAnchors() must track the Konva-rendered geometry: ShapeRenderer
 * applies `shape.rotation` (degrees, clockwise) at the node with no center
 * offset, so the visual shape is the at-rest geometry rotated about the
 * node position — top-left for box-likes, the center for circles/ellipses.
 * Rotated values use float trig, so assertions below are approximate
 * (epsilon 1e-9); rotation = 0 stays exactly backward compatible.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findSnapAnchor,
  getShapeAnchors,
  rotatePoint,
} from '../src/components/canvas/utils/shapes.js';

const EPS = 1e-9;

function assertPoint(actual, x, y, label) {
  assert.ok(
    Math.abs(actual.x - x) < EPS && Math.abs(actual.y - y) < EPS,
    `${label}: expected (${x}, ${y}), got (${actual.x}, ${actual.y})`,
  );
}

function byAnchor(list) {
  return new Map(list.map((a) => [a.anchor, a]));
}

describe('rotatePoint', () => {
  it('identity at 0 degrees and full turns', () => {
    assert.deepEqual(rotatePoint(60, 20, 10, 20, 0), { x: 60, y: 20 });
    assertPoint(rotatePoint(60, 20, 10, 20, 360), 60, 20, '360deg');
    assertPoint(rotatePoint(60, 20, 10, 20, -0), 60, 20, '-0deg');
  });

  it('rotates clockwise in screen coords (verified against Konva getCenter algebra)', () => {
    // (60,20) about pivot (10,20) by +90° clockwise → (10,70).
    assertPoint(rotatePoint(60, 20, 10, 20, 90), 10, 70, '90deg');
    assertPoint(rotatePoint(60, 20, 10, 20, -90), 10, -30, '-90deg');
    assertPoint(rotatePoint(60, 20, 10, 20, 180), -40, 20, '180deg');
  });

  it('returns null on non-finite input (non-finite degrees mean 0)', () => {
    assert.equal(rotatePoint(NaN, 0, 0, 0, 0), null);
    assert.equal(rotatePoint(0, 0, NaN, 0, 0), null);
    assert.deepEqual(rotatePoint(5, 5, 0, 0, NaN), { x: 5, y: 5 });
  });
});

describe('rotation-aware anchors', () => {
  it('rotation = 0 (and missing rotation) preserves existing coordinates', () => {
    const rect = { id: 'shape-r', type: 'rectangle', x: 10, y: 20, width: 100, height: 50 };
    assert.deepEqual(getShapeAnchors(rect), [
      { x: 60, y: 20, anchor: 'top' },
      { x: 110, y: 45, anchor: 'right' },
      { x: 60, y: 70, anchor: 'bottom' },
      { x: 10, y: 45, anchor: 'left' },
      { x: 60, y: 45, anchor: 'center' },
    ]);
    assert.deepEqual(getShapeAnchors({ ...rect, rotation: 0 }), getShapeAnchors(rect));
  });

  it('rotated rectangle anchors track the rendered box', () => {
    // 100x50 at (10,20), +90° about top-left pivot (10,20):
    // box spans x[-40,10], y[20,120]; center (-15,70).
    const anchors = byAnchor(
      getShapeAnchors({ id: 'shape-r', type: 'rectangle', x: 10, y: 20, width: 100, height: 50, rotation: 90 }),
    );
    assertPoint(anchors.get('top'), 10, 70, 'top');
    assertPoint(anchors.get('right'), -15, 120, 'right');
    assertPoint(anchors.get('bottom'), -40, 70, 'bottom');
    assertPoint(anchors.get('left'), -15, 20, 'left');
    assertPoint(anchors.get('center'), -15, 70, 'center');
  });

  it('rotated diamond anchors track the rendered diamond', () => {
    const anchors = byAnchor(
      getShapeAnchors({ id: 'shape-d', type: 'diamond', x: 10, y: 20, width: 100, height: 50, rotation: 90 }),
    );
    // Same box layout as the rectangle case (edge midpoints rotate rigidly).
    assertPoint(anchors.get('top'), 10, 70, 'top');
    assertPoint(anchors.get('center'), -15, 70, 'center');
  });

  it('rotated ellipse anchors stay on the visual perimeter about the center', () => {
    // Center (60,45), rx=30, ry=10, +90°: top (60,35) → (70,45); right (90,45) → (60,75).
    const anchors = byAnchor(
      getShapeAnchors({ id: 'shape-e', type: 'circle', x: 60, y: 45, radiusX: 30, radiusY: 10, rotation: 90 }),
    );
    assertPoint(anchors.get('top'), 70, 45, 'top');
    assertPoint(anchors.get('right'), 60, 75, 'right');
    assertPoint(anchors.get('bottom'), 50, 45, 'bottom');
    assertPoint(anchors.get('left'), 60, 15, 'left');
    // Pivot IS the center: exact, no trig drift.
    assert.deepEqual(anchors.get('center'), { x: 60, y: 45, anchor: 'center' });
  });

  it('rotated circle keeps the exact center and rotates cardinals', () => {
    const anchors = byAnchor(
      getShapeAnchors({ id: 'shape-c', type: 'circle', x: 60, y: 45, radius: 25, rotation: 45 }),
    );
    assert.deepEqual(anchors.get('center'), { x: 60, y: 45, anchor: 'center' });
    // Top (60,20) rotated 45° clockwise about (60,45) → (77.68, 27.32).
    assertPoint(anchors.get('top'), 77.67766952966369, 27.32233047033631, 'top');
  });

  it('rotated target snapping uses rotated coordinates', () => {
    const rect = { id: 'shape-r', type: 'rectangle', x: 10, y: 20, width: 100, height: 50, rotation: 90 };
    // Rotated top anchor sits at (10,70); a point just beside it must snap there.
    const hit = findSnapAnchor(12, 72, [rect]);
    assert.ok(hit, 'expected a snap');
    assert.equal(hit.shapeId, 'shape-r');
    assert.equal(hit.anchor, 'top');
    assertPoint(hit, 10, 70, 'snap point');
    // The OLD at-rest top (60,20) is far from every rotated anchor → no snap.
    assert.equal(findSnapAnchor(60, 20, [rect], { threshold: 5 }), null);
  });

  it('moving a rotated bound target keeps the binding descriptor intact', () => {
    const moved = { id: 'shape-r', type: 'rectangle', x: 40, y: 30, width: 100, height: 50, rotation: 90 };
    const anchors = byAnchor(getShapeAnchors(moved));
    // Descriptor shape { shapeId, anchor } is structural — rotation only
    // moves coordinates, never renames anchors.
    assert.deepEqual(
      [...anchors.keys()].sort(),
      ['bottom', 'center', 'left', 'right', 'top'],
    );
    assertPoint(anchors.get('right'), 15, 130, 'right');
  });

  it('non-finite rotation is treated as 0', () => {
    const rect = { id: 'shape-r', type: 'rectangle', x: 10, y: 20, width: 100, height: 50, rotation: NaN };
    assert.deepEqual(getShapeAnchors(rect), getShapeAnchors({ ...rect, rotation: undefined }));
  });
});
