import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ARROW_SNAP_THRESHOLD,
  findSnapAnchor,
  getShapeAnchors,
  isValidBinding,
  moveArrowEndpoint,
} from '../src/components/canvas/utils/shapes.js';
// shapeModel.js is the canonical shim — anchor helpers must be reachable
// through it as well (CanvasStage/BendHandles import surface).
import * as shapeModel from '../src/components/canvas/shapeModel.js';

const RECT = { id: 'shape-r1', type: 'rectangle', x: 10, y: 20, width: 100, height: 50 };
const DIAMOND = { id: 'shape-d1', type: 'diamond', x: 10, y: 20, width: 100, height: 50 };
const CIRCLE = { id: 'shape-c1', type: 'circle', x: 60, y: 45, radius: 25 };
const ELLIPSE = { id: 'shape-e1', type: 'circle', x: 60, y: 45, radiusX: 30, radiusY: 10 };
const ARROW = { id: 'shape-a1', type: 'arrow', points: [0, 0, 50, 50] };

describe('arrow endpoint anchors', () => {
  it('exposes anchor helpers through shapeModel.js', () => {
    assert.equal(typeof shapeModel.getShapeAnchors, 'function');
    assert.equal(typeof shapeModel.findSnapAnchor, 'function');
    assert.equal(typeof shapeModel.moveArrowEndpoint, 'function');
    assert.equal(typeof shapeModel.isValidBinding, 'function');
    assert.ok(shapeModel.ARROW_SNAP_THRESHOLD >= 12);
  });

  it('rectangle anchors are box edge midpoints + center', () => {
    const anchors = getShapeAnchors(RECT);
    assert.deepEqual(anchors, [
      { x: 60, y: 20, anchor: 'top' },
      { x: 110, y: 45, anchor: 'right' },
      { x: 60, y: 70, anchor: 'bottom' },
      { x: 10, y: 45, anchor: 'left' },
      { x: 60, y: 45, anchor: 'center' },
    ]);
  });

  it('diamond anchors are the four vertices + center', () => {
    const anchors = getShapeAnchors(DIAMOND);
    assert.deepEqual(anchors, [
      { x: 60, y: 20, anchor: 'top' },
      { x: 110, y: 45, anchor: 'right' },
      { x: 60, y: 70, anchor: 'bottom' },
      { x: 10, y: 45, anchor: 'left' },
      { x: 60, y: 45, anchor: 'center' },
    ]);
  });

  it('circle anchors are cardinal perimeter points + center', () => {
    assert.deepEqual(getShapeAnchors(CIRCLE), [
      { x: 60, y: 20, anchor: 'top' },
      { x: 85, y: 45, anchor: 'right' },
      { x: 60, y: 70, anchor: 'bottom' },
      { x: 35, y: 45, anchor: 'left' },
      { x: 60, y: 45, anchor: 'center' },
    ]);
  });

  it('ellipse honors radiusX/radiusY', () => {
    const anchors = getShapeAnchors(ELLIPSE);
    assert.deepEqual(anchors, [
      { x: 60, y: 35, anchor: 'top' },
      { x: 90, y: 45, anchor: 'right' },
      { x: 60, y: 55, anchor: 'bottom' },
      { x: 30, y: 45, anchor: 'left' },
      { x: 60, y: 45, anchor: 'center' },
    ]);
  });

  it('returns [] for arrows, lines, strokes, and malformed shapes', () => {
    assert.deepEqual(getShapeAnchors(ARROW), []);
    assert.deepEqual(getShapeAnchors({ ...ARROW, type: 'line' }), []);
    assert.deepEqual(getShapeAnchors({ ...ARROW, type: 'freehand' }), []);
    assert.deepEqual(getShapeAnchors(null), []);
    assert.deepEqual(getShapeAnchors({ id: 'shape-x', type: 'rectangle' }), []);
  });

  it('findSnapAnchor snaps within threshold and reports the binding', () => {
    const hit = findSnapAnchor(62, 24, [ARROW, RECT]);
    assert.deepEqual(hit, { x: 60, y: 20, shapeId: 'shape-r1', anchor: 'top' });
  });

  it('findSnapAnchor returns null beyond the threshold', () => {
    const hit = findSnapAnchor(200, 200, [RECT], { threshold: 10 });
    assert.equal(hit, null);
  });

  it('findSnapAnchor skips the dragged arrow and remote ghosts', () => {
    const ghost = { ...RECT, id: 'shape-g', remotePreview: true };
    assert.equal(findSnapAnchor(62, 24, [ARROW, ghost], { excludeId: 'shape-r1' }), null);
    // ...but finds the rect when it is not excluded
    const hit = findSnapAnchor(62, 24, [ARROW, RECT], { excludeId: 'shape-a1' });
    assert.equal(hit?.shapeId, 'shape-r1');
  });

  it('findSnapAnchor picks the nearest of several candidates', () => {
    const left = { id: 'shape-l', type: 'rectangle', x: 0, y: 0, width: 20, height: 20 };
    const right = { id: 'shape-r', type: 'rectangle', x: 100, y: 0, width: 20, height: 20 };
    // (11,10) is 1px from left's center anchor — nearest wins over edges
    const hit = findSnapAnchor(11, 10, [left, right], { threshold: 14 });
    assert.deepEqual(hit, { x: 10, y: 10, shapeId: 'shape-l', anchor: 'center' });
  });

  it('moveArrowEndpoint rewrites one end and preserves bends', () => {
    assert.deepEqual(moveArrowEndpoint([0, 0, 50, 50], 'start', 5, 6), [5, 6, 50, 50]);
    assert.deepEqual(moveArrowEndpoint([0, 0, 50, 50], 'end', 55, 56), [0, 0, 55, 56]);
    assert.deepEqual(
      moveArrowEndpoint([0, 0, 25, 30, 50, 50], 'end', 60, 60),
      [0, 0, 25, 30, 60, 60],
    );
  });

  it('moveArrowEndpoint rejects bad input with null', () => {
    assert.equal(moveArrowEndpoint([0, 0], 'end', 1, 1), null);
    assert.equal(moveArrowEndpoint([0, 0, 50, 50], 'middle', 1, 1), null);
    assert.equal(moveArrowEndpoint([0, 0, 50, 50], 'end', NaN, 1), null);
    assert.equal(moveArrowEndpoint([0, NaN, 50, 50], 'end', 1, 1), null);
    assert.equal(moveArrowEndpoint(null, 'end', 1, 1), null);
  });

  it('isValidBinding accepts descriptors and null, rejects junk', () => {
    assert.equal(isValidBinding(null), true);
    assert.equal(isValidBinding(undefined), true);
    assert.equal(isValidBinding({ shapeId: 'shape-r1', anchor: 'left' }), true);
    assert.equal(isValidBinding({ shapeId: 'shape-r1', anchor: 'corner' }), false);
    assert.equal(isValidBinding({ shapeId: '', anchor: 'left' }), false);
    assert.equal(isValidBinding('left'), false);
  });
});
