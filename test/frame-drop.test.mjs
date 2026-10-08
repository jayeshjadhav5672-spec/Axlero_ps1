import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeFrameDropBatch,
  frameMembers,
} from '../src/components/canvas/utils/shapes.js';
// Same helpers through the canonical shim surface.
import * as shapeModel from '../src/components/canvas/shapeModel.js';

const FRAME = { id: 'frame-1', type: 'frame', x: 0, y: 0, width: 200, height: 200 };
const RECT_IN = { id: 'shape-r1', type: 'rectangle', x: 10, y: 10, width: 40, height: 40 };
const CIRCLE_IN = { id: 'shape-c1', type: 'circle', x: 150, y: 150, radius: 20 };
const RECT_OUT = { id: 'shape-r2', type: 'rectangle', x: 500, y: 500, width: 40, height: 40 };
// Member arrow (fully inside) bound outside the frame (far end must clear).
const ARROW_MEMBER = {
  id: 'shape-a1',
  type: 'arrow',
  points: [30, 30, 60, 60],
  startBinding: { shapeId: 'shape-r1', anchor: 'left' },
  endBinding: { shapeId: 'shape-r2', anchor: 'left' },
};
// Outside arrow bound to the member rect (must stretch to the settled anchor).
const ARROW_OUT = {
  id: 'shape-a2',
  type: 'arrow',
  points: [600, 60, 30, 30],
  startBinding: null,
  endBinding: { shapeId: 'shape-r1', anchor: 'right' },
};

describe('frame membership + atomic drop batch', () => {
  it('exposes helpers through shapeModel.js', () => {
    assert.equal(typeof shapeModel.frameMembers, 'function');
    assert.equal(typeof shapeModel.computeFrameDropBatch, 'function');
  });

  it('frameMembers captures center-inside shapes, never frames/previews', () => {
    const ghost = { ...RECT_IN, id: 'shape-g', remotePreview: true };
    const innerFrame = { id: 'frame-2', type: 'frame', x: 10, y: 10, width: 20, height: 20 };
    const ids = frameMembers([RECT_IN, CIRCLE_IN, RECT_OUT, ghost, innerFrame, FRAME], FRAME).map((s) => s.id);
    assert.deepEqual(ids, ['shape-r1', 'shape-c1']);
  });

  it('drop batch translates frame + members rigidly in one packet', () => {
    const batch = computeFrameDropBatch({ frame: FRAME, dx: 100, dy: 50, shapes: [FRAME, RECT_IN, RECT_OUT] });
    assert.deepEqual(batch, [
      { id: 'frame-1', changes: { x: 100, y: 50 } },
      { id: 'shape-r1', changes: { x: 110, y: 60 } },
    ]);
  });

  it('zero delta produces no batch (click without drag commits nothing)', () => {
    assert.deepEqual(computeFrameDropBatch({ frame: FRAME, dx: 0, dy: 0, shapes: [FRAME, RECT_IN] }), []);
    assert.deepEqual(computeFrameDropBatch({ frame: null, dx: 1, dy: 1, shapes: [] }), []);
  });

  it('member arrow bound outside clears only the dangling end', () => {
    const batch = computeFrameDropBatch({
      frame: FRAME, dx: 100, dy: 0, shapes: [FRAME, RECT_IN, RECT_OUT, ARROW_MEMBER],
    });
    const entries = batch.filter((u) => u.id === 'shape-a1');
    assert.equal(entries.length, 1); // single merged op: rigid points + clear
    assert.deepEqual(entries[0].changes, {
      points: [130, 30, 160, 60],
      startBinding: { shapeId: 'shape-r1', anchor: 'left' },
      endBinding: null,
    });
  });

  it('outside arrow bound to a member stretches to the settled anchor', () => {
    const batch = computeFrameDropBatch({
      frame: FRAME, dx: 100, dy: 0, shapes: [FRAME, RECT_IN, ARROW_OUT],
    });
    const arrow = batch.find((u) => u.id === 'shape-a2');
    // member rect settles at x 110..150: right anchor = (150, 30)
    assert.deepEqual(arrow.changes, { points: [600, 60, 150, 30] });
  });

  it('point-path members offset their points by the delta', () => {
    const stroke = { id: 'shape-s1', type: 'freehand', points: [20, 20, 40, 40] };
    const batch = computeFrameDropBatch({ frame: FRAME, dx: 10, dy: -5, shapes: [FRAME, stroke] });
    assert.deepEqual(batch[1], { id: 'shape-s1', changes: { points: [30, 15, 50, 35] } });
  });
});
