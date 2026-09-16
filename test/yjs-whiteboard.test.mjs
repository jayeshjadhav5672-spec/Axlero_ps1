/**
 * yjs-whiteboard.test.mjs — Shree (Yjs / CRDT collaboration), Phase 2
 *
 * Tests for src/lib/yjsWhiteboard.js. No network, no DOM, no React.
 * Follows the repo convention (node:test, node:assert/strict).
 *
 * Multi-client CRDT tests use standalone Y.Docs synced with Yjs
 * state-vector/update APIs — no Socket.io, transport stays out of scope.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  ORIGIN_LOCAL,
  getShapesMap,
  getZOrderArray,
  createShape,
  updateShape,
  deleteShape,
  clearCanvas,
  setZOrder,
  getSharedShapes,
  subscribeToShapeChanges,
} from '../src/lib/yjsWhiteboard.js';
import { getYDoc, resetForTests } from '../src/lib/yjsProvider.js';

afterEach(() => resetForTests());

function rect(id, extra = {}) {
  return {
    id, type: 'rectangle', x: 100, y: 150, width: 200, height: 100,
    stroke: '#1e1e1e', strokeWidth: 4, fill: '#ffffff', rotation: 0,
    ...extra,
  };
}

/** Two independent client docs, synced both ways via state vectors. */
function syncDocs(docA, docB) {
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB)));
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA)));
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

test('shapes Y.Map initializes empty on a room doc', () => {
  const doc = getYDoc('wb-init-map');
  const shapes = getShapesMap(doc);
  assert.equal(typeof shapes.set, 'function');
  assert.equal(shapes.size, 0);
});

test('zOrder Y.Array initializes empty on a room doc', () => {
  const doc = getYDoc('wb-init-arr');
  const zOrder = getZOrderArray(doc);
  assert.equal(typeof zOrder.push, 'function');
  assert.equal(zOrder.length, 0);
});

// ---------------------------------------------------------------------------
// Create / retrieval
// ---------------------------------------------------------------------------

test('createShape stores a shape and appends its id to zOrder', () => {
  const doc = getYDoc('wb-create');
  const res = createShape(doc, rect('shape-1'));
  assert.equal(res.applied, true);
  assert.equal(res.shapeId, 'shape-1');
  assert.ok(getShapesMap(doc).get('shape-1') instanceof Y.Map);
  assert.deepEqual(getZOrderArray(doc).toArray(), ['shape-1']);
});

test('created shape is stored property-wise as a Y.Map, not a plain object', () => {
  const doc = getYDoc('wb-propwise');
  createShape(doc, rect('shape-1'));
  const stored = getShapesMap(doc).get('shape-1');
  assert.ok(stored instanceof Y.Map);
  assert.equal(stored.get('x'), 100);
  assert.equal(stored.get('fill'), '#ffffff');
});

test('getSharedShapes returns serializable shapes in z-order', () => {
  const doc = getYDoc('wb-retrieve');
  createShape(doc, rect('shape-1'));
  createShape(doc, rect('shape-2', { x: 5 }));
  const out = getSharedShapes(doc);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((s) => s.id), ['shape-1', 'shape-2']);
  assert.equal(out[0].x, 100);
  assert.equal(out[1].x, 5);
  // Plain JSON — no Yjs internals leak to the whiteboard.
  assert.equal(JSON.parse(JSON.stringify(out)).length, 2);
});

// ---------------------------------------------------------------------------
// Update (granular, partial)
// ---------------------------------------------------------------------------

test('updateShape modifies only the supplied properties', () => {
  const doc = getYDoc('wb-update');
  createShape(doc, rect('shape-1'));
  const res = updateShape(doc, 'shape-1', { x: 200, y: 150 });
  assert.equal(res.applied, true);
  assert.deepEqual(res.updated, ['x', 'y']);
  const stored = getShapesMap(doc).get('shape-1');
  assert.equal(stored.get('x'), 200);
  assert.equal(stored.get('y'), 150);
  // Untouched props survive — no whole-object replacement.
  assert.equal(stored.get('width'), 200);
  assert.equal(stored.get('fill'), '#ffffff');
  const [shape] = getSharedShapes(doc);
  assert.equal(shape.width, 200);
});

test('partial single-property update leaves everything else intact', () => {
  const doc = getYDoc('wb-partial');
  createShape(doc, rect('shape-1'));
  updateShape(doc, 'shape-1', { fill: '#ff0000' });
  const [shape] = getSharedShapes(doc);
  assert.equal(shape.fill, '#ff0000');
  assert.equal(shape.x, 100);
  assert.equal(shape.width, 200);
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

test('deleteShape removes the shape from registry and zOrder', () => {
  const doc = getYDoc('wb-delete');
  createShape(doc, rect('shape-1'));
  createShape(doc, rect('shape-2'));
  const res = deleteShape(doc, 'shape-1');
  assert.equal(res.applied, true);
  assert.equal(getShapesMap(doc).has('shape-1'), false);
  assert.deepEqual(getZOrderArray(doc).toArray(), ['shape-2']);
  assert.deepEqual(getSharedShapes(doc).map((s) => s.id), ['shape-2']);
});

test('deleteShape on an absent shape is a safe no-op', () => {
  const doc = getYDoc('wb-delete-noop');
  assert.doesNotThrow(() => deleteShape(doc, 'shape-ghost'));
  assert.deepEqual(deleteShape(doc, 'shape-ghost'), { applied: false, reason: 'unknown-shape', shapeId: 'shape-ghost' });
});

// ---------------------------------------------------------------------------
// Z-order
// ---------------------------------------------------------------------------

test('z-order follows creation order', () => {
  const doc = getYDoc('wb-zorder');
  createShape(doc, rect('shape-1'));
  createShape(doc, rect('shape-2'));
  createShape(doc, rect('shape-3'));
  assert.deepEqual(getZOrderArray(doc).toArray(), ['shape-1', 'shape-2', 'shape-3']);
  assert.deepEqual(getSharedShapes(doc).map((s) => s.id), ['shape-1', 'shape-2', 'shape-3']);
});

test('setZOrder reorders without touching properties', () => {
  const doc = getYDoc('wb-reorder');
  createShape(doc, rect('shape-1'));
  createShape(doc, rect('shape-2'));
  const res = setZOrder(doc, ['shape-2', 'shape-1']);
  assert.equal(res.applied, true);
  assert.deepEqual(getZOrderArray(doc).toArray(), ['shape-2', 'shape-1']);
  assert.deepEqual(getSharedShapes(doc).map((s) => s.id), ['shape-2', 'shape-1']);
  assert.equal(getShapesMap(doc).get('shape-1').get('x'), 100);
});

test('z-order stays consistent after deletion (no dangling ids)', () => {
  const doc = getYDoc('wb-zdel');
  createShape(doc, rect('shape-1'));
  createShape(doc, rect('shape-2'));
  createShape(doc, rect('shape-3'));
  deleteShape(doc, 'shape-2');
  assert.deepEqual(getZOrderArray(doc).toArray(), ['shape-1', 'shape-3']);
});

test('multiple independent shapes coexist', () => {
  const doc = getYDoc('wb-multi');
  for (let i = 1; i <= 5; i += 1) {
    assert.equal(createShape(doc, rect(`shape-${i}`, { x: i * 10 })).applied, true);
  }
  assert.equal(getShapesMap(doc).size, 5);
  assert.equal(getZOrderArray(doc).length, 5);
  assert.equal(getSharedShapes(doc).length, 5);
});

// ---------------------------------------------------------------------------
// Room isolation (via Phase 1 provider)
// ---------------------------------------------------------------------------

test('Room A / Room B isolation: shapes never cross rooms', () => {
  const docA = getYDoc('room-A');
  const docB = getYDoc('room-B');
  createShape(docA, rect('shape-1'));
  updateShape(docA, 'shape-1', { x: 999 });
  assert.equal(getSharedShapes(docB).length, 0);
  assert.equal(getShapesMap(docB).size, 0);
  createShape(docB, rect('shape-9'));
  assert.deepEqual(getSharedShapes(docA).map((s) => s.id), ['shape-1']);
  assert.deepEqual(getSharedShapes(docB).map((s) => s.id), ['shape-9']);
});

// ---------------------------------------------------------------------------
// CRDT concurrency (two client docs, state-vector sync)
// ---------------------------------------------------------------------------

test('concurrent edits to DIFFERENT properties both survive', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  createShape(docA, rect('shape-1'));
  syncDocs(docA, docB);

  // Client A moves the shape; client B recolors it — concurrently.
  updateShape(docA, 'shape-1', { x: 200 });
  updateShape(docB, 'shape-1', { fill: '#ff0000' });
  syncDocs(docA, docB);

  for (const doc of [docA, docB]) {
    const [shape] = getSharedShapes(doc);
    assert.equal(shape.x, 200, 'A’s x must survive');
    assert.equal(shape.fill, '#ff0000', 'B’s fill must survive');
  }
});

test('concurrent edits to the SAME property converge via Yjs (no custom LWW)', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  createShape(docA, rect('shape-1'));
  syncDocs(docA, docB);

  updateShape(docA, 'shape-1', { x: 200 });
  updateShape(docB, 'shape-1', { x: 300 });
  syncDocs(docA, docB);

  const [a] = getSharedShapes(docA);
  const [b] = getSharedShapes(docB);
  // Yjs resolves the conflict deterministically — both replicas agree.
  // No custom timestamp/server-wins logic anywhere in this repo.
  assert.equal(a.x, b.x, 'replicas must converge to the same value');
});

test('concurrent creation of different shapes: both exist after sync', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  createShape(docA, rect('shape-A'));
  createShape(docB, rect('shape-B'));
  syncDocs(docA, docB);

  for (const doc of [docA, docB]) {
    const ids = getSharedShapes(doc).map((s) => s.id).sort();
    assert.deepEqual(ids, ['shape-A', 'shape-B']);
  }
});

test('no duplicate shape on repeated create handling (same stable id)', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  createShape(docA, rect('shape-1'));
  syncDocs(docA, docB);

  // Same creation re-delivered (e.g. retried op): ignored, not duplicated.
  const res = createShape(docB, rect('shape-1', { x: 555 }));
  assert.equal(res.applied, false);
  assert.equal(res.duplicate, true);
  syncDocs(docA, docB);

  for (const doc of [docA, docB]) {
    const all = getSharedShapes(doc);
    assert.equal(all.filter((s) => s.id === 'shape-1').length, 1);
    assert.deepEqual(getZOrderArray(doc).toArray().filter((id) => id === 'shape-1').length, 1);
  }
});

// ---------------------------------------------------------------------------
// Observers
// ---------------------------------------------------------------------------

test('observer receives remote changes with merged state', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  createShape(docA, rect('shape-1'));
  syncDocs(docA, docB);

  let received = null;
  const unsub = subscribeToShapeChanges(docB, (shapes, meta) => {
    received = { shapes, local: meta.local };
  });

  updateShape(docA, 'shape-1', { x: 400 });
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB)));

  assert.ok(received, 'observer must fire for remote updates');
  assert.equal(received.local, false, 'remote changes must not be flagged local');
  assert.equal(received.shapes[0].x, 400);
  unsub();
});

test('observer flags local writes so bindings can skip echo', () => {
  const doc = new Y.Doc();
  let lastMeta = null;
  const unsub = subscribeToShapeChanges(doc, (_shapes, meta) => {
    lastMeta = meta;
  });
  createShape(doc, rect('shape-1'));
  assert.ok(lastMeta, 'observer must fire for local writes');
  assert.equal(lastMeta.local, true);
  unsub();
});

test('no synchronization loop: subscriber never writes back', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  createShape(docA, rect('shape-1'));
  syncDocs(docA, docB);

  let updateEvents = 0;
  docB.on('update', () => {
    updateEvents += 1;
  });
  // Read-only subscriber, as shipped: re-reads state, writes nothing.
  subscribeToShapeChanges(docB, () => {
    getSharedShapes(docB);
  });

  updateShape(docA, 'shape-1', { x: 10 });
  updateShape(docA, 'shape-1', { y: 20 });
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB)));

  // Exactly one doc update (the applied remote batch). Any write-back from
  // the subscriber would have produced additional update events.
  assert.equal(updateEvents, 1);
});

test('unsubscribe stops notifications', () => {
  const doc = new Y.Doc();
  let calls = 0;
  const unsub = subscribeToShapeChanges(doc, () => {
    calls += 1;
  });
  createShape(doc, rect('shape-1'));
  assert.ok(calls >= 1);
  const frozen = calls;
  unsub();
  createShape(doc, rect('shape-2'));
  assert.equal(calls, frozen);
});

// ---------------------------------------------------------------------------
// Error handling (never crash on bad input)
// ---------------------------------------------------------------------------

test('malformed shape input is rejected safely', () => {
  const doc = getYDoc('wb-bad-input');
  assert.deepEqual(createShape(doc, null).applied, false);
  assert.deepEqual(createShape(doc, { type: 'rectangle' }).applied, false);
  assert.deepEqual(createShape(doc, { id: 'no-prefix', type: 'rectangle' }).applied, false);
  assert.equal(getShapesMap(doc).size, 0);
  assert.equal(getZOrderArray(doc).length, 0);
});

test('updates for non-existent shapes are safe no-ops', () => {
  const doc = getYDoc('wb-unknown-update');
  assert.deepEqual(
    updateShape(doc, 'shape-ghost', { x: 1 }),
    { applied: false, reason: 'unknown-shape', shapeId: 'shape-ghost' },
  );
});

test('invalid room IDs still rejected via provider validation', () => {
  assert.throws(() => getYDoc('bad room!!'), { message: /Invalid roomId/ });
});

// ---------------------------------------------------------------------------
// Phase 1 preservation
// ---------------------------------------------------------------------------

test('Phase 1 code Y.Text remains intact alongside Phase 2 structures', () => {
  const doc = getYDoc('wb-p1-code');
  createShape(doc, rect('shape-1'));
  doc.getText('code').insert(0, 'hello');
  assert.equal(doc.getText('code').toString(), 'hello');
  assert.equal(getSharedShapes(doc).length, 1);
});

test('Phase 1 metadata Y.Map remains intact alongside Phase 2 structures', () => {
  const doc = getYDoc('wb-p1-meta');
  createShape(doc, rect('shape-1'));
  doc.getMap('metadata').set('title', 'Room title');
  assert.equal(doc.getMap('metadata').get('title'), 'Room title');
  assert.equal(getSharedShapes(doc).length, 1);
});

test('Phase 1 canvas Y.Array placeholder is not disturbed by Phase 2', () => {
  const doc = getYDoc('wb-p1-canvas');
  createShape(doc, rect('shape-1'));
  assert.equal(doc.getArray('canvas').length, 0);
});
