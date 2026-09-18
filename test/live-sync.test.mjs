import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyRemotePreviewEvent,
  buildPreviewProgressPayload,
  isValidCursorMove,
  isValidEraserTrail,
  isValidPreviewProgress,
  previewToShape,
  LIVE_COMMIT_EVENTS,
  LIVE_PREVIEW_EVENTS,
} from '../src/components/canvas/utils/liveSync.js';

const RECT = { id: 'shape-r1', type: 'rectangle', x: 10, y: 20, width: 100, height: 50, stroke: '#111', strokeWidth: 2 };

describe('live-sync protocol surface', () => {
  it('exposes preview and commit event lists', () => {
    assert.deepEqual(LIVE_PREVIEW_EVENTS, ['shape:preview-progress', 'shape:preview-cancel']);
    assert.ok(LIVE_COMMIT_EVENTS.includes('shapes:commit'));
    assert.ok(LIVE_COMMIT_EVENTS.includes('canvas:history-sync'));
  });
});

describe('buildPreviewProgressPayload', () => {
  it('builds a JSON-safe payload for any shape type', () => {
    const payload = buildPreviewProgressPayload({ draftId: 'shape-r1', shape: RECT });
    assert.equal(payload.draftId, 'shape-r1');
    assert.deepEqual(payload.shape, RECT);
    assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload);
  });

  it('returns null for missing ids, id-less shapes, or unserializable input', () => {
    assert.equal(buildPreviewProgressPayload({ draftId: '', shape: RECT }), null);
    assert.equal(buildPreviewProgressPayload({ draftId: 'd', shape: { type: 'rectangle' } }), null);
    assert.equal(buildPreviewProgressPayload({ draftId: 'd', shape: null }), null);
    const circular = { id: 'd', type: 'rectangle' };
    circular.self = circular;
    assert.equal(buildPreviewProgressPayload({ draftId: 'd', shape: circular }), null);
  });
});

describe('inbound validators', () => {
  it('accepts well-formed preview progress and rejects garbage', () => {
    assert.equal(isValidPreviewProgress({ draftId: 'd1', shape: RECT }), true);
    assert.equal(isValidPreviewProgress(null), false);
    assert.equal(isValidPreviewProgress({ shape: RECT }), false);
    assert.equal(isValidPreviewProgress({ draftId: 'd1', shape: { type: 'x' } }), false);
  });

  it('accepts cursor moves and eraser trails within caps', () => {
    assert.equal(isValidCursorMove({ x: 1, y: 2, user: 'A', tool: 'pen' }), true);
    assert.equal(isValidCursorMove({ x: 1 }), false);
    assert.equal(isValidCursorMove({ x: NaN, y: 2 }), false);
    assert.equal(isValidEraserTrail({ eraserId: 'e1', points: [0, 0, 5, 5] }), true);
    assert.equal(isValidEraserTrail({ eraserId: '', points: [] }), false);
    assert.equal(isValidEraserTrail({ eraserId: 'e1', points: new Array(5001).fill(0) }), false);
  });
});

describe('applyRemotePreviewEvent (preview map reducer)', () => {
  it('upserts previews flagged remotePreview with Konva keys', () => {
    const next = applyRemotePreviewEvent({}, 'shape:preview-progress', { draftId: 'd1', shape: RECT }, 's-9');
    assert.equal(next.d1.type, 'rectangle');
    assert.equal(next.d1.remotePreview, true);
    assert.equal(next.d1.previewActorId, 's-9');
    assert.ok(next.d1.strokeWidth > 0);
  });

  it('cancels previews and reconciles commit/delete/clear/history', () => {
    const withPreview = { d1: previewToShape({ draftId: 'd1', shape: RECT }) };
    assert.deepEqual(applyRemotePreviewEvent(withPreview, 'shape:preview-cancel', { draftId: 'd1' }), {});
    assert.deepEqual(
      applyRemotePreviewEvent(withPreview, 'shapes:commit', { shape: { id: 'shape-r1' } }),
      {},
    );
    assert.deepEqual(
      applyRemotePreviewEvent(withPreview, 'shapes:commit', { shapes: [{ id: 'shape-r1' }] }),
      {},
    );
    assert.deepEqual(
      applyRemotePreviewEvent(withPreview, 'shapes:delete', { shapeIds: ['shape-r1'] }),
      {},
    );
    assert.deepEqual(applyRemotePreviewEvent(withPreview, 'canvas:clear', {}), {});
    // history-sync keeps previews whose ids survive, drops the rest.
    assert.deepEqual(
      applyRemotePreviewEvent(withPreview, 'canvas:history-sync', { shapes: [{ id: 'shape-r1' }] }),
      withPreview,
    );
    assert.deepEqual(
      applyRemotePreviewEvent(withPreview, 'canvas:history-sync', { shapes: [{ id: 'other' }] }),
      {},
    );
  });

  it('ignores invalid payloads and unknown events without mutating', () => {
    const prev = { d1: previewToShape({ draftId: 'd1', shape: RECT }) };
    assert.equal(applyRemotePreviewEvent(prev, 'shape:preview-progress', { draftId: '', shape: RECT }), prev);
    assert.equal(applyRemotePreviewEvent(prev, 'shapes:commit', { shape: {} }), prev);
    assert.equal(applyRemotePreviewEvent(prev, 'canvas:update', {}), prev);
  });
});

describe('mergeRenderShapes (live drag replace vs create append)', () => {
  it('appends unknown previews and replaces id-matching drags in place', async () => {
    const { mergeRenderShapes } = await import('../src/components/canvas/utils/liveSync.js');
    const base = [
      { id: 'a', type: 'rectangle', x: 0 },
      { id: 'b', type: 'rectangle', x: 10 },
    ];
    assert.equal(mergeRenderShapes(base, {}), base);
    const appended = mergeRenderShapes(base, { d1: { id: 'd1', type: 'rectangle', remotePreview: true } });
    assert.deepEqual(appended.map((s) => s.id), ['a', 'b', 'd1']);
    const replaced = mergeRenderShapes(base, { a: { id: 'a', type: 'rectangle', x: 99, remotePreview: true } });
    assert.deepEqual(replaced.map((s) => s.id), ['a', 'b']);
    assert.equal(replaced[0].x, 99);
    assert.equal(replaced[0].remotePreview, true);
  });
});

describe('collab:selection helpers', () => {
  it('builds, validates, reduces, and expires peer selections', async () => {
    const {
      applyRemoteSelectionEvent,
      buildSelectionPayload,
      expireRemoteSelections,
      isValidSelection,
    } = await import('../src/components/canvas/utils/liveSync.js');
    const data = buildSelectionPayload({ userId: 'u1', userName: 'Ann', color: '#111', shapeIds: ['a', 'a', 'b'] });
    assert.deepEqual(data.shapeIds, ['a', 'b']);
    assert.equal(isValidSelection(data), true);
    assert.equal(isValidSelection({ shapeIds: 'nope' }), false);
    assert.equal(buildSelectionPayload({ userId: '', shapeIds: [] }), null);
    const t0 = 1000;
    const next = applyRemoteSelectionEvent({}, data, 'sock-1', t0);
    assert.equal(next.u1.userName, 'Ann');
    assert.deepEqual(next.u1.shapeIds, ['a', 'b']);
    assert.equal(applyRemoteSelectionEvent(next, { shapeIds: [] }, 'sock-2', t0).u1.userName, 'Ann');
    assert.equal(expireRemoteSelections(next, t0 + 1000), next);
    assert.deepEqual(expireRemoteSelections(next, t0 + 31000), {});
  });
});

describe('lerpViewportStep (receiver smoothing)', () => {
  it('advances toward the target and snaps within epsilon', async () => {
    const { lerpViewportStep } = await import('../src/components/canvas/utils/liveSync.js');
    const s1 = lerpViewportStep({ x: 0, y: 0, scale: 1 }, { x: 100, y: 0, scale: 2 });
    assert.ok(s1.x > 0 && s1.x < 100);
    assert.ok(s1.scale > 1 && s1.scale < 2);
    assert.equal(s1.done, false);
    assert.deepEqual(lerpViewportStep({ x: 99.8, y: 0, scale: 1 }, { x: 100, y: 0, scale: 1 }), {
      x: 100,
      y: 0,
      scale: 1,
      done: true,
    });
    // Converges from any start within bounded frames.
    let cur = { x: 0, y: 0, scale: 1 };
    const target = { x: -250, y: 400, scale: 0.5 };
    for (let i = 0; i < 200 && !cur.done; i++) cur = { ...lerpViewportStep(cur, target), };
    const last = lerpViewportStep(cur, target);
    assert.equal(last.done, true);
    assert.deepEqual([last.x, last.y, last.scale], [-250, 400, 0.5]);
  });

  it('tolerates missing/invalid inputs without NaN', async () => {
    const { lerpViewportStep } = await import('../src/components/canvas/utils/liveSync.js');
    const s = lerpViewportStep(null, { x: NaN });
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.scale));
    assert.equal(s.done, true);
  });
});

describe('selection dedupe (zero-reconciliation)', () => {
  it('returns the identical map ref for duplicate payloads', async () => {
    const { applyRemoteSelectionEvent } = await import('../src/components/canvas/utils/liveSync.js');
    const data = { userId: 'u1', userName: 'Ann', color: '#111', shapeIds: ['a', 'b'] };
    const once = applyRemoteSelectionEvent({}, data, 'sock-1', 1000);
    const twice = applyRemoteSelectionEvent(once, { ...data, shapeIds: ['b', 'a', 'a'] }, 'sock-1', 2000);
    // Note: order differs here, so ids arrays differ -> new ref is correct.
    assert.notEqual(twice, once);
    const sameOrder = applyRemoteSelectionEvent(once, { ...data }, 'sock-1', 2000);
    assert.equal(sameOrder, once);
    const changed = applyRemoteSelectionEvent(once, { ...data, shapeIds: ['a'] }, 'sock-1', 3000);
    assert.notEqual(changed, once);
    assert.deepEqual(changed.u1.shapeIds, ['a']);
  });
});

describe('dragPreviewNodeUpdate (imperative receiver attrs)', () => {
  it('normalizes positioned and point-based previews, rejects junk', async () => {
    const { dragPreviewNodeUpdate } = await import('../src/components/canvas/utils/liveSync.js');
    assert.deepEqual(dragPreviewNodeUpdate({ id: 'a', type: 'rectangle', x: 5, y: 6 }), { x: 5, y: 6 });
    assert.deepEqual(
      dragPreviewNodeUpdate({ id: 'b', type: 'freehand', points: [0, 0, 9, 9], rotation: 12 }),
      { x: 0, y: 0, points: [0, 0, 9, 9], rotation: 12 },
    );
    assert.equal(dragPreviewNodeUpdate({ id: 'c', type: 'freehand', points: [1] }), null);
    assert.equal(dragPreviewNodeUpdate({ type: 'rectangle', x: 1, y: 2 }), null);
    assert.equal(dragPreviewNodeUpdate(null), null);
  });
});

describe('unpackViewportPayload (dual-envelope schema)', () => {
  it('unpacks flat and nested envelopes with numeric coercion', async () => {
    const { unpackViewportPayload } = await import('../src/components/canvas/utils/liveSync.js');
    assert.deepEqual(unpackViewportPayload({ stagePos: { x: 10, y: 20 }, scale: 1.5 }), {
      stagePos: { x: 10, y: 20 },
      scale: 1.5,
    });
    assert.deepEqual(
      unpackViewportPayload({ roomId: 'r', data: { stagePos: { x: '3', y: 4 }, scale: 2 } }),
      { stagePos: { x: 3, y: 4 }, scale: 2 },
    );
    // Missing scale is not an error (receiver falls back to live scale).
    assert.deepEqual(unpackViewportPayload({ stagePos: { x: 1, y: 2 } }), {
      stagePos: { x: 1, y: 2 },
      scale: null,
    });
    // Garbage coerces to nulls, never NaN.
    assert.deepEqual(unpackViewportPayload({ stagePos: { x: 'abc', y: 2 }, scale: 'zzz' }), {
      stagePos: null,
      scale: null,
    });
    assert.deepEqual(unpackViewportPayload(null), { stagePos: null, scale: null });
    assert.deepEqual(unpackViewportPayload({ data: null }), { stagePos: null, scale: null });
  });
});
