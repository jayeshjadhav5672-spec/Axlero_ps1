/**
 * bound-arrow-follow.test.mjs — batched bound-arrow propagation (no DOM).
 *
 * Regression for the stale-snapshot defect: per-arrow `commitUpdate` calls
 * computed from the same stale `shapes` closure could overwrite one another
 * (uncontrolled mode even reverted the dragged shape). The fix computes all
 * follow targets from ONE snapshot (computeBoundArrowTargets) and applies
 * them in ONE batch (applyBatchUpdates) — one gesture, one coherent state.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyBatchUpdates,
  computeBoundArrowTargets,
  moveArrowEndpoint,
} from '../src/components/canvas/utils/shapes.js';

const RECT = { id: 'shape-r', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 };
const MOVED = { ...RECT, x: 50, y: 0 };

function arrow(id, extra = {}) {
  return {
    id,
    type: 'arrow',
    x: 0,
    y: 0,
    points: [0, 0, 10, 10],
    stroke: '#111',
    strokeWidth: 2,
    rotation: 0,
    ...extra,
  };
}

/** Apply world-frame targets exactly like the hook does at rest (node 0,0). */
function applyTargets(base, targets) {
  const updates = [];
  for (const t of targets) {
    const shape = base.find((s) => s.id === t.id);
    let next = null;
    for (const e of t.ends) {
      next = moveArrowEndpoint(next ?? shape.points, e.end, e.x, e.y);
      if (!next) break;
    }
    if (next) updates.push({ id: t.id, changes: { points: next } });
  }
  return updates;
}

describe('computeBoundArrowTargets', () => {
  it('one target + two bound arrows: both ends reported, none lost', () => {
    const a1 = arrow('shape-a1', { endBinding: { shapeId: 'shape-r', anchor: 'right' } });
    const a2 = arrow('shape-a2', { startBinding: { shapeId: 'shape-r', anchor: 'right' } });
    const out = computeBoundArrowTargets([RECT, a1, a2], 'shape-r', MOVED);
    assert.equal(out.length, 2);
    // Moved rect: right anchor at (150, 50).
    assert.deepEqual(out, [
      { id: 'shape-a1', ends: [{ end: 'end', x: 150, y: 50 }] },
      { id: 'shape-a2', ends: [{ end: 'start', x: 150, y: 50 }] },
    ]);
  });

  it('one target + three bound arrows: all three reported', () => {
    const a1 = arrow('shape-a1', { endBinding: { shapeId: 'shape-r', anchor: 'top' } });
    const a2 = arrow('shape-a2', {
      startBinding: { shapeId: 'shape-r', anchor: 'left' },
      endBinding: { shapeId: 'shape-r', anchor: 'bottom' },
    });
    const a3 = arrow('shape-a3', { endBinding: { shapeId: 'shape-r', anchor: 'right' } });
    const out = computeBoundArrowTargets([RECT, a1, a2, a3], 'shape-r', MOVED);
    assert.equal(out.length, 3);
    // Moved rect anchors: top (100, 0), left (50, 50), bottom (100, 100), right (150, 50).
    assert.deepEqual(out[0], { id: 'shape-a1', ends: [{ end: 'end', x: 100, y: 0 }] });
    assert.deepEqual(out[1], {
      id: 'shape-a2',
      ends: [
        { end: 'start', x: 50, y: 50 },
        { end: 'end', x: 100, y: 100 },
      ],
    });
    assert.deepEqual(out[2], { id: 'shape-a3', ends: [{ end: 'end', x: 150, y: 50 }] });
  });

  it('unbound arrows are absent and unchanged', () => {
    const bound = arrow('shape-a1', { endBinding: { shapeId: 'shape-r', anchor: 'right' } });
    const plain = arrow('shape-a2');
    const otherTarget = arrow('shape-a3', { endBinding: { shapeId: 'shape-other', anchor: 'right' } });
    const out = computeBoundArrowTargets([RECT, bound, plain, otherTarget], 'shape-r', MOVED);
    assert.deepEqual(out.map((t) => t.id), ['shape-a1']);
  });

  it('missing/renamed anchors and degenerate arrows are skipped, descriptors intact', () => {
    const renamed = arrow('shape-a1', { endBinding: { shapeId: 'shape-r', anchor: 'corner' } });
    const degenerate = arrow('shape-a2', {
      points: [0, 0],
      endBinding: { shapeId: 'shape-r', anchor: 'right' },
    });
    const ghost = arrow('shape-a3', {
      points: [0, 0, 10, 10],
      remotePreview: true,
      endBinding: { shapeId: 'shape-r', anchor: 'right' },
    });
    const before = JSON.parse(JSON.stringify([RECT, renamed, degenerate, ghost]));
    const out = computeBoundArrowTargets([RECT, renamed, degenerate, ghost], 'shape-r', MOVED);
    assert.deepEqual(out, []);
    // Binding descriptors are never mutated by target computation.
    assert.deepEqual([RECT, renamed, degenerate, ghost], before);
  });

  it('no anchors (line target) and bad input yield []', () => {
    const line = { id: 'shape-l', type: 'line', x: 0, y: 0, points: [0, 0, 5, 5] };
    const a1 = arrow('shape-a1', { endBinding: { shapeId: 'shape-l', anchor: 'right' } });
    assert.deepEqual(computeBoundArrowTargets([line, a1], 'shape-l', line), []);
    assert.deepEqual(computeBoundArrowTargets(null, 'shape-r', MOVED), []);
    assert.deepEqual(computeBoundArrowTargets([RECT], null, MOVED), []);
    assert.deepEqual(computeBoundArrowTargets([RECT], 'shape-r', null), []);
  });
});

describe('applyBatchUpdates', () => {
  it('one batch holds the moved shape plus every arrow: coherent final state', () => {
    const a1 = arrow('shape-a1', { endBinding: { shapeId: 'shape-r', anchor: 'right' } });
    const a2 = arrow('shape-a2', { startBinding: { shapeId: 'shape-r', anchor: 'right' } });
    const plain = arrow('shape-a3');
    const base = [RECT, a1, a2, plain];
    const targets = computeBoundArrowTargets(base, 'shape-r', MOVED);
    assert.equal(targets.length, 2);
    const result = applyBatchUpdates(base, [
      { id: 'shape-r', changes: { x: 50, y: 0 } },
      ...applyTargets(base, targets),
    ]);
    const byId = new Map(result.map((s) => [s.id, s]));
    // Moved shape adopted the new position.
    assert.equal(byId.get('shape-r').x, 50);
    // Both arrows followed (end/start rewritten to the moved anchor).
    assert.deepEqual(byId.get('shape-a1').points, [0, 0, 150, 50]);
    assert.deepEqual(byId.get('shape-a2').points, [150, 50, 10, 10]);
    // Unbound arrow keeps its reference (untouched, no re-render churn).
    assert.equal(byId.get('shape-a3'), plain);
    assert.equal(result.length, 4);
  });

  it('single transition is undo-atomic: pre-image restores exactly', () => {
    const a1 = arrow('shape-a1', { endBinding: { shapeId: 'shape-r', anchor: 'right' } });
    const base = [RECT, a1];
    const before = JSON.parse(JSON.stringify(base));
    const targets = computeBoundArrowTargets(base, 'shape-r', MOVED);
    const result = applyBatchUpdates(base, [
      { id: 'shape-r', changes: { x: 50, y: 0 } },
      ...applyTargets(base, targets),
    ]);
    // Base snapshot untouched (undo restores it verbatim).
    assert.deepEqual(base, before);
    // Result differs from base ONLY in the moved shape + followed arrow.
    assert.notDeepEqual(result, before);
    const changed = result.filter((s, i) => s !== base[i]);
    assert.deepEqual(changed.map((s) => s.id).sort(), ['shape-a1', 'shape-r']);
  });

  it('empty/invalid updates are no-ops returning the same array', () => {
    const base = [RECT];
    assert.equal(applyBatchUpdates(base, []), base);
    assert.deepEqual(applyBatchUpdates(base, null), base);
    assert.equal(applyBatchUpdates(base, [{}, { id: '', changes: {} }, { id: 'shape-r' }]), base);
    assert.deepEqual(applyBatchUpdates(null, [{ id: 'shape-r', changes: { x: 1 } }]), []);
  });

  it('later entries win per shape id', () => {
    const result = applyBatchUpdates([RECT], [
      { id: 'shape-r', changes: { x: 10 } },
      { id: 'shape-r', changes: { x: 20, y: 5 } },
    ]);
    assert.equal(result[0].x, 20);
    assert.equal(result[0].y, 5);
    assert.equal(result[0].width, 100);
  });
});
