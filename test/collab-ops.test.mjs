/**
 * collab-ops.test.mjs — Integration contract tests (no network, no DOM).
 * Verifies the pure reducers in src/lib/collabOps.js + room helpers that
 * every sync hook depends on: malformed ops dropped, self-echo suppressed,
 * stale revisions dropped, presence mapping stable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCodeOp,
  applyWhiteboardOp,
  isValidCodeOp,
  isValidWhiteboardOp,
  toBatchUpdates,
} from '../src/lib/collabOps.js';
import { colorForId, isValidRoomId, presenceToUsers } from '../src/lib/room.js';

const shape = {
  id: 'shape-1',
  type: 'rectangle',
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  stroke: '#0f766e',
  strokeWidth: 4,
};

test('whiteboard ops: valid ops apply, garbage is dropped', () => {
  assert.equal(isValidWhiteboardOp({ op: 'create', shape, actorId: 'a' }), true);
  assert.equal(isValidWhiteboardOp({ op: 'create', shape: { bad: 1 }, actorId: 'a' }), false);
  assert.equal(isValidWhiteboardOp({ op: 'nonsense', actorId: 'a' }), false);
  assert.equal(isValidWhiteboardOp(null), false);

  const created = applyWhiteboardOp([], { op: 'create', shape, actorId: 'a' }, 'b');
  assert.equal(created.applied, true);
  assert.equal(created.shapes.length, 1);

  // duplicate create (re-delIVERY) is a no-op
  const dup = applyWhiteboardOp(created.shapes, { op: 'create', shape, actorId: 'a' }, 'b');
  assert.equal(dup.applied, false);
  assert.equal(dup.shapes, created.shapes); // same ref → no re-render

  const updated = applyWhiteboardOp(created.shapes, { op: 'update', shapeId: 'shape-1', changes: { x: 99 }, actorId: 'a' }, 'b');
  assert.equal(updated.applied, true);
  assert.equal(updated.shapes[0].x, 99);

  // update for unknown id is a no-op
  assert.equal(applyWhiteboardOp([], { op: 'update', shapeId: 'nope', changes: { x: 1 }, actorId: 'a' }, 'b').applied, false);

  const cleared = applyWhiteboardOp(updated.shapes, { op: 'clear', actorId: 'a' }, 'b');
  assert.equal(cleared.applied, true);
  assert.deepEqual(cleared.shapes, []);
});

test('whiteboard ops: update-many applies a frame block atomically', () => {
  const frame = { ...shape, id: 'frame-1', type: 'frame', x: 0, y: 0, width: 200, height: 200 };
  const child = { ...shape, id: 'shape-2', x: 10, y: 10 };
  const outsider = { ...shape, id: 'shape-3', x: 500, y: 500 };
  const list = [frame, child, outsider];
  const op = {
    op: 'update-many',
    updates: [
      { shapeId: 'frame-1', changes: { x: 100, y: 50 } },
      { shapeId: 'shape-2', changes: { x: 110, y: 60 } },
    ],
    actorId: 'a',
  };
  assert.equal(isValidWhiteboardOp(op), true);
  const res = applyWhiteboardOp(list, op, 'b');
  assert.equal(res.applied, true);
  // Single pass: frame + child move together, outsider untouched, order kept
  assert.deepEqual(res.shapes.map((s) => s.id), ['frame-1', 'shape-2', 'shape-3']);
  assert.deepEqual([res.shapes[0].x, res.shapes[0].y], [100, 50]);
  assert.deepEqual([res.shapes[1].x, res.shapes[1].y], [110, 60]);
  assert.deepEqual([res.shapes[2].x, res.shapes[2].y], [500, 500]);

  // Garbage rejected, never crashes
  assert.equal(isValidWhiteboardOp({ op: 'update-many', updates: [], actorId: 'a' }), false);
  assert.equal(isValidWhiteboardOp({ op: 'update-many', actorId: 'a' }), false);
  assert.equal(
    isValidWhiteboardOp({ op: 'update-many', updates: [{ shapeId: '', changes: {} }], actorId: 'a' }),
    false,
  );
  assert.equal(
    isValidWhiteboardOp({ op: 'update-many', updates: [{ shapeId: 'x', changes: {} }], actorId: 'a' }),
    false,
  );
  const oversized = { op: 'update-many', updates: new Array(501).fill({ shapeId: 'x', changes: { x: 1 } }), actorId: 'a' };
  assert.equal(isValidWhiteboardOp(oversized), false);
  // No known ids -> no-op (same ref, no re-render)
  const noop = applyWhiteboardOp(list, { ...op, updates: [{ shapeId: 'nope', changes: { x: 1 } }] }, 'b');
  assert.equal(noop.applied, false);
  assert.equal(noop.shapes, list);
  // Self-echo suppressed
  assert.equal(applyWhiteboardOp(list, { ...op, actorId: 'b' }, 'b').applied, false);
});

test('whiteboard ops: store-to-shell batch handoff stays nested end to end', () => {
  // The store emits flat [{ id, ...changes }]; the shell + update-many
  // validation read nested [{ id, changes }]. toBatchUpdates bridges them.
  // A flat batch passed straight through must NOT silently vanish (the
  // frame-drag blackout: peers observed nothing at all).
  const flatBatch = [
    { id: 'frame-1', x: 100, y: 50 },
    { id: 'shape-2', x: 110, y: 60 },
  ];
  const nested = toBatchUpdates(flatBatch);
  assert.deepEqual(nested, [
    { id: 'frame-1', changes: { x: 100, y: 50 } },
    { id: 'shape-2', changes: { x: 110, y: 60 } },
  ]);
  assert.deepEqual(toBatchUpdates(null), []);
  assert.deepEqual(toBatchUpdates([{ nope: 1 }]), []);

  // Full chain: nested batch -> shell emit envelope -> peer validate+apply
  const emitted = {
    op: 'update-many',
    updates: nested.map((u) => ({ shapeId: u.id, changes: u.changes })),
    actorId: 'a',
  };
  assert.equal(isValidWhiteboardOp(emitted), true);
  const before = [
    { id: 'frame-1', type: 'frame', x: 0, y: 0, width: 200, height: 200 },
    { id: 'shape-2', type: 'rectangle', x: 10, y: 10, width: 40, height: 40 },
  ];
  const after = applyWhiteboardOp(before, emitted, 'b');
  assert.equal(after.applied, true);
  assert.equal(after.shapes[0].x, 100);
  assert.equal(after.shapes[1].x, 110);
});

test('whiteboard ops: reorder replaces order, drops garbage, suppresses echo', () => {
  const s1 = { ...shape, id: 'shape-1' };
  const s2 = { ...shape, id: 'shape-2', x: 99 };
  assert.equal(isValidWhiteboardOp({ op: 'reorder', shapes: [s1, s2], actorId: 'a' }), true);
  assert.equal(isValidWhiteboardOp({ op: 'reorder', shapes: 'nope', actorId: 'a' }), false);
  assert.equal(isValidWhiteboardOp({ op: 'reorder', actorId: 'a' }), false);

  // local reorder propagation: reversed order applies wholesale
  const reordered = applyWhiteboardOp([s1, s2], { op: 'reorder', shapes: [s2, s1], actorId: 'a' }, 'b');
  assert.equal(reordered.applied, true);
  assert.deepEqual(reordered.shapes.map((s) => s.id), ['shape-2', 'shape-1']);

  // identical array is a no-op (same ref → no re-render, no bounce)
  const same = applyWhiteboardOp(reordered.shapes, { op: 'reorder', shapes: [s2, s1], actorId: 'a' }, 'b');
  assert.equal(same.applied, false);
  assert.equal(same.shapes, reordered.shapes);

  // undo-shaped restore: same order but older content still applies
  const moved = { ...s2, x: 5 };
  const restored = applyWhiteboardOp([moved, s1], { op: 'reorder', shapes: [s2, s1], actorId: 'a' }, 'b');
  assert.equal(restored.applied, true);
  assert.equal(restored.shapes[0].x, 99);

  // invalid entries are dropped, never crash; self-echo suppressed
  const mixed = applyWhiteboardOp([], { op: 'reorder', shapes: [s1, { bad: 1 }], actorId: 'a' }, 'b');
  assert.equal(mixed.applied, true);
  assert.deepEqual(mixed.shapes.map((s) => s.id), ['shape-1']);
  assert.equal(applyWhiteboardOp([], { op: 'reorder', shapes: [s1], actorId: 'b' }, 'b').applied, false);
});

test('whiteboard ops: self-echo is always suppressed', () => {
  const self = 'socket-self';
  assert.equal(applyWhiteboardOp([], { op: 'create', shape, actorId: self }, self).applied, false);
  assert.equal(
    applyWhiteboardOp([shape], { op: 'delete', shapeId: 'shape-1', actorId: self }, self).applied,
    false,
  );
  assert.equal(applyWhiteboardOp([shape], { op: 'clear', actorId: self }, self).applied, false);
});

test('code ops: only strictly newer remote revisions apply', () => {
  assert.equal(isValidCodeOp({ text: 'hi', rev: 1, actorId: 'a' }), true);
  assert.equal(isValidCodeOp({ text: 'hi', actorId: 'a' }), false);

  let state = { text: '', rev: 0 };
  const r1 = applyCodeOp(state, { text: 'const a = 1', rev: 1, actorId: 'a' }, 'b');
  assert.equal(r1.applied, true);
  state = r1.state;

  // stale + duplicate + self revisions are dropped
  assert.equal(applyCodeOp(state, { text: 'stale', rev: 1, actorId: 'c' }, 'b').applied, false);
  assert.equal(applyCodeOp(state, { text: 'old', rev: 0, actorId: 'c' }, 'b').applied, false);
  assert.equal(applyCodeOp(state, { text: 'mine', rev: 99, actorId: 'b' }, 'b').applied, false);

  const r2 = applyCodeOp(state, { text: 'const a = 2', rev: 2, actorId: 'c' }, 'b');
  assert.equal(r2.applied, true);
  assert.equal(r2.state.text, 'const a = 2');
});

test('room helpers: validation, presence mapping, stable colors', () => {
  assert.equal(isValidRoomId('room-1_abc'), true);
  assert.equal(isValidRoomId('bad room!'), false);
  assert.equal(isValidRoomId(''), false);
  assert.equal(isValidRoomId(undefined), false);

  const users = presenceToUsers([
    { socketId: 's1', userId: 'u1', displayName: 'Ada' },
    { socketId: 's2', userId: undefined, displayName: undefined },
  ]);
  assert.equal(users.length, 2);
  assert.deepEqual(users[0], { id: 'u1', name: 'Ada', color: colorForId('u1'), isActive: true });
  assert.equal(users[1].id, 's2');
  assert.equal(users[1].name, '?');
  assert.equal(colorForId('u1'), colorForId('u1')); // deterministic
  assert.deepEqual(presenceToUsers('garbage'), []);
});
