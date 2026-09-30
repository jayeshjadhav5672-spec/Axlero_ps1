import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyRemoteStrokeEvent,
  buildStrokeProgressPayload,
  isValidStrokeComplete,
  isValidStrokeProgress,
  progressToPreviewShape,
  toFlatPoints,
  MAX_STREAM_POINTS,
  STROKE_STREAM_EVENTS,
  STROKE_STREAM_INTERVAL_MS,
} from '../src/components/canvas/utils/strokeStream.js';

describe('stroke stream protocol constants', () => {
  it('exposes a ~30ms throttle interval and the three stream events', () => {
    assert.ok(STROKE_STREAM_INTERVAL_MS >= 25 && STROKE_STREAM_INTERVAL_MS <= 35);
    assert.deepEqual([...STROKE_STREAM_EVENTS].sort(), [
      'draw:stroke-cancel',
      'draw:stroke-complete',
      'draw:stroke-progress',
    ]);
    assert.ok(MAX_STREAM_POINTS > 0);
  });
});

describe('buildStrokeProgressPayload', () => {
  it('builds a serializable payload and sanitizes non-finite points', () => {
    const payload = buildStrokeProgressPayload({
      strokeId: 'shape-abc',
      points: [0, 0, 10, 10, NaN, NaN, 20, 20],
      stroke: '#ff0000',
      strokeWidth: 4,
      opacity: 1,
    });
    assert.deepEqual(payload.points, [0, 0, 10, 10, 20, 20]);
    assert.equal(payload.strokeId, 'shape-abc');
    assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload);
  });

  it('returns null for missing ids or degenerate points', () => {
    assert.equal(buildStrokeProgressPayload({ strokeId: '', points: [0, 0] }), null);
    assert.equal(buildStrokeProgressPayload({ strokeId: 'shape-x', points: [0] }), null);
    assert.equal(buildStrokeProgressPayload({ strokeId: 'shape-x', points: [] }), null);
  });

  it('flows a seed-only single point so the first flush paints (dot)', () => {
    // The renderer draws single-pair previews as a round dot instead of
    // returning null — the pipeline must deliver them, not drop them.
    const payload = buildStrokeProgressPayload({ strokeId: 'shape-x', points: [7, 9] });
    assert.deepEqual(payload.points, [7, 9]);
    assert.equal(isValidStrokeProgress({ strokeId: 'shape-x', points: [7, 9] }), true);
    assert.deepEqual(progressToPreviewShape({ strokeId: 'shape-x', points: [7, 9] }).points, [7, 9]);
  });

  it('drops an orphaned trailing coordinate left by sanitizing', () => {
    const payload = buildStrokeProgressPayload({ strokeId: 'shape-x', points: [0, 0, 10, NaN] });
    assert.deepEqual(payload.points, [0, 0]);
  });
});

describe('toFlatPoints (failure mode 3: format tolerance)', () => {
  it('passes flat pairs through and trims orphans', () => {
    assert.deepEqual(toFlatPoints([0, 0, 10, 10]), [0, 0, 10, 10]);
    assert.deepEqual(toFlatPoints([0, 0, 10]), [0, 0]);
    assert.deepEqual(toFlatPoints([0, 0, NaN, NaN, 20, 20]), [0, 0, 20, 20]);
  });

  it('drops non-finite pairs atomically without shifting alignment', () => {
    assert.deepEqual(toFlatPoints([0, 0, Infinity, 1, 20, 20]), [0, 0, 20, 20]);
    assert.deepEqual(toFlatPoints([0, Infinity, 20, 20]), [20, 20]);
    assert.deepEqual(toFlatPoints([{ x: 0, y: 0 }, { x: Infinity, y: 1 }, { x: 5, y: 5 }]), [0, 0, 5, 5]);
  });

  it('converts nested [{ x, y }] input to flat pairs', () => {
    assert.deepEqual(toFlatPoints([{ x: 0, y: 1 }, { x: 2, y: 3 }]), [0, 1, 2, 3]);
    assert.deepEqual(toFlatPoints([{ x: 0, y: 0 }, 'junk', null, { x: 5, y: 5 }]), [0, 0, 5, 5]);
    assert.deepEqual(toFlatPoints('nope'), []);
    assert.deepEqual(toFlatPoints(null), []);
  });

  it('nested-format progress validates and reduces to a paintable preview', () => {
    const data = { strokeId: 's-nested', points: [{ x: 0, y: 0 }, { x: 8, y: 8 }] };
    assert.equal(isValidStrokeProgress(data), true);
    const shape = progressToPreviewShape(data);
    assert.deepEqual(shape.points, [0, 0, 8, 8]);
    // Every key Konva's freehand branch requires is present.
    for (const key of ['id', 'type', 'x', 'y', 'points', 'stroke', 'strokeWidth']) {
      assert.ok(shape[key] !== undefined && shape[key] !== null, `preview carries ${key}`);
    }
    assert.equal(shape.type, 'freehand');
    const next = applyRemoteStrokeEvent({}, 'draw:stroke-progress', data);
    assert.deepEqual(next['s-nested'].points, [0, 0, 8, 8]);
  });
});

describe('inbound validators', () => {
  it('accepts well-formed progress and rejects garbage', () => {
    assert.equal(
      isValidStrokeProgress({ strokeId: 'shape-1', points: [0, 0, 5, 5], stroke: '#111', strokeWidth: 2, opacity: 1 }),
      true,
    );
    assert.equal(isValidStrokeProgress(null), false);
    assert.equal(isValidStrokeProgress({ points: [0, 0] }), false);
    // Normalize-then-validate: a trailing orphan is trimmed and flows as a
    // harmless single point (renders nothing until more points land);
    // fully-degenerate input still rejects.
    assert.equal(isValidStrokeProgress({ strokeId: 's', points: [0, 0, 1] }), true);
    assert.equal(isValidStrokeProgress({ strokeId: 's', points: [0] }), false);
    assert.equal(isValidStrokeProgress({ strokeId: 's', points: [0, 0, Infinity, 1] }), true);
    assert.equal(
      isValidStrokeProgress({ strokeId: 's', points: new Array(MAX_STREAM_POINTS + 2).fill(0) }),
      false,
    );
  });

  it('accepts complete with or without a final shape', () => {
    assert.equal(isValidStrokeComplete({ strokeId: 's', shape: { id: 's' } }), true);
    assert.equal(isValidStrokeComplete({ strokeId: 's', shape: null }), true);
    assert.equal(isValidStrokeComplete({ strokeId: 's' }), true);
    assert.equal(isValidStrokeComplete({ strokeId: '', shape: null }), false);
    assert.equal(isValidStrokeComplete({ strokeId: 's', shape: 42 }), false);
  });
});

describe('applyRemoteStrokeEvent (preview map reducer)', () => {
  it('upserts progress previews flagged remotePreview', () => {
    const next = applyRemoteStrokeEvent(
      {},
      'draw:stroke-progress',
      { strokeId: 's1', points: [0, 0, 8, 8], stroke: '#000', strokeWidth: 3, opacity: 1 },
      'socket-9',
    );
    assert.equal(next.s1.type, 'freehand');
    assert.equal(next.s1.remotePreview, true);
    assert.equal(next.s1.previewActorId, 'socket-9');
  });

  it('holds the finalized shape on complete, drops on cancel', () => {
    const withPreview = { s1: progressToPreviewShape({ strokeId: 's1', points: [0, 0, 8, 8] }) };
    const held = applyRemoteStrokeEvent(withPreview, 'draw:stroke-complete', {
      strokeId: 's1',
      shape: { id: 's1', type: 'freehand', points: [0, 0, 8, 8, 9, 9] },
    });
    assert.deepEqual(held.s1.points, [0, 0, 8, 8, 9, 9]);
    assert.equal(held.s1.remotePreview, true);
    const dropped = applyRemoteStrokeEvent(held, 'draw:stroke-cancel', { strokeId: 's1' });
    assert.deepEqual(dropped, {});
  });

  it('ignores invalid payloads and unknown events without mutating', () => {
    const prev = { s1: progressToPreviewShape({ strokeId: 's1', points: [0, 0, 8, 8] }) };
    assert.equal(applyRemoteStrokeEvent(prev, 'draw:stroke-progress', { strokeId: '', points: [] }), prev);
    assert.equal(applyRemoteStrokeEvent(prev, 'draw:stroke-complete', { strokeId: 'nope', shape: null }), prev);
    assert.equal(applyRemoteStrokeEvent(prev, 'canvas:update', {}), prev);
  });

  it('backfills Konva keys when the held complete shape is sparse', () => {
    const prev = { s1: progressToPreviewShape({ strokeId: 's1', points: [0, 0, 8, 8] }) };
    const next = applyRemoteStrokeEvent(prev, 'draw:stroke-complete', {
      strokeId: 's1',
      shape: { id: 's1' },
    });
    assert.equal(next.s1.type, 'freehand');
    assert.deepEqual(next.s1.points, [0, 0, 8, 8]);
    assert.equal(typeof next.s1.stroke, 'string');
    assert.ok(next.s1.strokeWidth > 0);
  });
});
