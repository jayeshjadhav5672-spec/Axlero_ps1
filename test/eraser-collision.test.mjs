import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isShapeIntersectingPoint } from '../src/components/canvas/utils/shapes.js';

describe('isShapeIntersectingPoint (drag-erase contact)', () => {
  it('hits rectangles inside bounds and within tolerance outside', () => {
    const rect = { id: 'shape-r', type: 'rectangle', x: 10, y: 10, width: 100, height: 50 };
    assert.equal(isShapeIntersectingPoint(rect, { x: 50, y: 30 }), true);
    assert.equal(isShapeIntersectingPoint(rect, { x: 10, y: 10 }), true);
    assert.equal(isShapeIntersectingPoint(rect, { x: 115, y: 30 }), true); // within tol
    assert.equal(isShapeIntersectingPoint(rect, { x: 200, y: 30 }), false);
    assert.equal(isShapeIntersectingPoint(rect, { x: 50, y: 30 }, 0), true);
  });

  it('hits circles by center distance and strokes by segment distance', () => {
    const circle = { id: 'shape-c', type: 'circle', x: 0, y: 0, radius: 20 };
    assert.equal(isShapeIntersectingPoint(circle, { x: 15, y: 0 }), true);
    assert.equal(isShapeIntersectingPoint(circle, { x: 100, y: 0 }), false);
    const line = { id: 'shape-l', type: 'line', points: [0, 0, 100, 0], strokeWidth: 4 };
    assert.equal(isShapeIntersectingPoint(line, { x: 50, y: 2 }), true);
    assert.equal(isShapeIntersectingPoint(line, { x: 50, y: 50 }), false);
    assert.equal(isShapeIntersectingPoint(line, { x: 150, y: 0 }), false);
  });

  it('hits single-point strokes radially and text by bounds', () => {
    const dot = { id: 'shape-d', type: 'freehand', points: [7, 9], strokeWidth: 4 };
    assert.equal(isShapeIntersectingPoint(dot, { x: 7, y: 9 }), true);
    assert.equal(isShapeIntersectingPoint(dot, { x: 90, y: 90 }), false);
    const text = { id: 'shape-t', type: 'text', x: 0, y: 0, text: 'hi', fontSize: 20, width: 30 };
    assert.equal(isShapeIntersectingPoint(text, { x: 5, y: 5 }), true);
    assert.equal(isShapeIntersectingPoint(text, { x: 500, y: 500 }), false);
  });

  it('tests group children in translated coords', () => {
    const group = {
      id: 'shape-g',
      type: 'group',
      x: 100,
      y: 100,
      width: 120,
      height: 60,
      children: [{ id: 'shape-k', type: 'rectangle', x: 0, y: 0, width: 120, height: 60 }],
    };
    assert.equal(isShapeIntersectingPoint(group, { x: 110, y: 110 }), true);
    assert.equal(isShapeIntersectingPoint(group, { x: 10, y: 10 }), false);
  });

  it('rejects garbage without throwing', () => {
    assert.equal(isShapeIntersectingPoint(null, { x: 0, y: 0 }), false);
    assert.equal(isShapeIntersectingPoint({ id: 'x' }, null), false);
    assert.equal(isShapeIntersectingPoint({ id: 'x', type: 'rectangle' }, { x: NaN, y: 0 }), false);
    assert.equal(isShapeIntersectingPoint({ id: 'x', type: 'freehand', points: [] }, { x: 0, y: 0 }), false);
  });
});
