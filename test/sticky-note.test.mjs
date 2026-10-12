/**
 * sticky-note.test.mjs — Day 4: Dedicated Sticky Note Component contract (no DOM).
 *
 * Covers the spec's data model plus its canvas integration: factory defaults,
 * validation, normalization, bounds/center/anchors, hit-testing, duplication,
 * collab ops, and the drag/transform bake paths.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SHAPE_TYPES,
  STICKY_COLORS,
  STICKY_DEFAULTS,
  applyBatchUpdates,
  bakeDragEnd,
  bakeTransform,
  createStickyShape,
  duplicateShape,
  findSnapAnchor,
  getShapeAnchors,
  getShapeBounds,
  isShapeIntersectingPoint,
  isValidShape,
  normalizeShape,
  serializeShape,
  shapeCenter,
} from '../src/components/canvas/utils/shapes.js';
import { applyWhiteboardOp, isValidWhiteboardOp } from '../src/lib/collabOps.js';

describe('Day 4 sticky note data model', () => {
  it('registers the sticky shape type', () => {
    assert.ok(SHAPE_TYPES.includes('sticky'));
  });

  it('factory matches the spec defaults', () => {
    const s = createStickyShape({ x: 200, y: 200 });
    assert.equal(s.type, 'sticky');
    assert.equal(s.x, 200);
    assert.equal(s.y, 200);
    assert.equal(s.width, STICKY_DEFAULTS.width);
    assert.equal(s.height, STICKY_DEFAULTS.height);
    assert.equal(s.fill, '#FEF08A');
    assert.equal(s.text, 'Type your note here...');
    assert.equal(s.fontSize, 16);
    assert.equal(s.fontFamily, 'Inter, sans-serif');
    assert.equal(s.rotation, 0);
    assert.ok(s.id.startsWith('sticky-'));
  });

  it('spec example object validates and round-trips', () => {
    const example = {
      id: 'sticky-123e4567-e89b-12d3-a456-426614174000',
      type: 'sticky',
      x: 200,
      y: 200,
      width: 200,
      height: 200,
      fill: '#FEF08A',
      text: 'Type your note here...',
      fontSize: 16,
      fontFamily: 'Inter, sans-serif',
      rotation: 0,
    };
    assert.equal(isValidShape(example), true);
    assert.deepEqual(serializeShape(example), example);
    assert.deepEqual(normalizeShape(example), example);
  });

  it('rejects non-finite origins', () => {
    assert.equal(createStickyShape({ x: NaN, y: 0 }), null);
  });

  it('exposes a six-color note palette', () => {
    assert.equal(STICKY_COLORS.length, 6);
    assert.ok(STICKY_COLORS.some((c) => c.value === '#FEF08A'));
  });
});

describe('Day 4 sticky note canvas integration', () => {
  it('bounds, center, anchors, and hit-testing use the note box', () => {
    const s = createStickyShape({ x: 200, y: 200 });
    assert.deepEqual(getShapeBounds(s), { x: 200, y: 200, width: 200, height: 200 });
    assert.deepEqual(shapeCenter(s), { x: 300, y: 300 });
    assert.equal(getShapeAnchors(s).length, 5);
    assert.equal(isShapeIntersectingPoint(s, { x: 250, y: 250 }), true);
    assert.equal(isShapeIntersectingPoint(s, { x: 500, y: 500 }), false);
    const snap = findSnapAnchor(300, 200, [s]);
    assert.equal(snap?.shapeId, s.id);
  });

  it('drag and resize bake like other box shapes', () => {
    const s = createStickyShape({ x: 200, y: 200 });
    assert.deepEqual(bakeDragEnd(s, 250, 260), { x: 250, y: 260 });
    const t = bakeTransform(s, { x: 250, y: 260, scaleX: 1.5, scaleY: 1.5, rotation: 15 });
    assert.equal(t.width, 300);
    assert.equal(t.height, 300);
    assert.equal(t.rotation, 15);
  });

  it('duplicates with a fresh id and offset', () => {
    const s = createStickyShape({ x: 200, y: 200 });
    const dup = duplicateShape(s, 20, 20);
    assert.equal(dup.type, 'sticky');
    assert.equal(dup.x, 220);
    assert.equal(dup.text, s.text);
    assert.notEqual(dup.id, s.id);
  });

  it('batch updates apply text/color changes', () => {
    const s = createStickyShape({ x: 200, y: 200 });
    const next = applyBatchUpdates([s], [{ id: s.id, changes: { text: 'hello', fill: '#FBCFE8' } }]);
    assert.equal(next[0].text, 'hello');
    assert.equal(next[0].fill, '#FBCFE8');
  });

  it('collab create/update round-trip without new channels', () => {
    const s = createStickyShape({ x: 200, y: 200 });
    const create = { op: 'create', actorId: 'peer', shape: s };
    assert.equal(isValidWhiteboardOp(create), true);
    const after = applyWhiteboardOp([], create, 'me');
    assert.equal(after.applied, true);
    const updated = applyWhiteboardOp(
      after.shapes,
      { op: 'update', actorId: 'peer', shapeId: s.id, changes: { text: 'hello' } },
      'me',
    );
    assert.equal(updated.applied, true);
    assert.equal(updated.shapes[0].text, 'hello');
  });
});
