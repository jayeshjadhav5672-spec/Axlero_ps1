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
  assert.equal(users[1].name, 'Guest');
  assert.equal(colorForId('u1'), colorForId('u1')); // deterministic
  assert.deepEqual(presenceToUsers('garbage'), []);
});
