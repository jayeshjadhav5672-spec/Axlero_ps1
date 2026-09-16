/**
 * yjs-provider.test.mjs — Shree (Yjs / CRDT collaboration)
 *
 * Unit tests for src/lib/yjsProvider.js. No network, no DOM, no React.
 * Mirrors the convention of collab-ops.test.mjs (node:test, node:assert/strict).
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getYDoc,
  destroyYDoc,
  hasYDoc,
  resetForTests,
} from '../src/lib/yjsProvider.js';

// Clean the registry before each test so tests are fully independent.
afterEach(() => resetForTests());

// ---------------------------------------------------------------------------
// Y.Doc initialization
// ---------------------------------------------------------------------------

test('getYDoc returns a Y.Doc for a valid roomId', () => {
  const doc = getYDoc('room-1');
  assert.ok(doc, 'doc should be truthy');
  assert.equal(typeof doc.getArray, 'function', 'should be a Y.Doc instance');
});

test('getYDoc initializes canvas as Y.Array', () => {
  const doc = getYDoc('room-1');
  const canvas = doc.getArray('canvas');
  assert.equal(typeof canvas.insert, 'function', 'canvas should be a Y.Array');
  assert.equal(canvas.length, 0, 'canvas should be empty on init');
});

test('getYDoc initializes code as Y.Text', () => {
  const doc = getYDoc('room-1');
  const code = doc.getText('code');
  assert.equal(typeof code.insert, 'function', 'code should be a Y.Text');
  assert.equal(code.toString(), '', 'code should be empty on init');
});

test('getYDoc initializes metadata as Y.Map', () => {
  const doc = getYDoc('room-1');
  const meta = doc.getMap('metadata');
  assert.equal(typeof meta.set, 'function', 'metadata should be a Y.Map');
  assert.equal(meta.size, 0, 'metadata should be empty on init');
});

// ---------------------------------------------------------------------------
// Identity / singleton per room
// ---------------------------------------------------------------------------

test('same roomId returns the exact same Y.Doc instance', () => {
  const a = getYDoc('room-same');
  const b = getYDoc('room-same');
  assert.equal(a, b, 'must be the same object reference');
});

test('different roomIds return different Y.Doc instances', () => {
  const a = getYDoc('room-alpha');
  const b = getYDoc('room-beta');
  assert.notEqual(a, b, 'must be different instances');
});

// ---------------------------------------------------------------------------
// Room isolation — mutations in one doc must not appear in another
// ---------------------------------------------------------------------------

test('room documents are isolated: Y.Text mutations do not cross rooms', () => {
  const docA = getYDoc('room-a');
  const docB = getYDoc('room-b');

  docA.getText('code').insert(0, 'hello from A');
  assert.equal(docB.getText('code').toString(), '', 'room-b code must remain empty');
});

test('room documents are isolated: Y.Array mutations do not cross rooms', () => {
  const docA = getYDoc('room-a');
  const docB = getYDoc('room-b');

  docA.getArray('canvas').insert(0, [{ id: 'shape-1' }]);
  assert.equal(docB.getArray('canvas').length, 0, 'room-b canvas must remain empty');
});

test('room documents are isolated: Y.Map mutations do not cross rooms', () => {
  const docA = getYDoc('room-a');
  const docB = getYDoc('room-b');

  docA.getMap('metadata').set('title', 'Session A');
  assert.equal(docB.getMap('metadata').get('title'), undefined, 'room-b metadata must be unaffected');
});

// ---------------------------------------------------------------------------
// Invalid roomId rejection
// ---------------------------------------------------------------------------

test('getYDoc throws for an empty string roomId', () => {
  assert.throws(
    () => getYDoc(''),
    { message: /Invalid roomId/ },
    'should throw for empty string',
  );
});

test('getYDoc throws for a roomId with spaces', () => {
  assert.throws(
    () => getYDoc('bad room'),
    { message: /Invalid roomId/ },
  );
});

test('getYDoc throws for a roomId with special characters', () => {
  assert.throws(
    () => getYDoc('room!@#'),
    { message: /Invalid roomId/ },
  );
});

test('getYDoc throws for a roomId exceeding 64 characters', () => {
  const tooLong = 'a'.repeat(65);
  assert.throws(
    () => getYDoc(tooLong),
    { message: /Invalid roomId/ },
  );
});

test('getYDoc throws for a non-string roomId (number)', () => {
  assert.throws(
    () => getYDoc(42),
    { message: /Invalid roomId/ },
  );
});

test('getYDoc throws for undefined', () => {
  assert.throws(
    () => getYDoc(undefined),
    { message: /Invalid roomId/ },
  );
});

test('getYDoc throws for null', () => {
  assert.throws(
    () => getYDoc(null),
    { message: /Invalid roomId/ },
  );
});

// ---------------------------------------------------------------------------
// hasYDoc
// ---------------------------------------------------------------------------

test('hasYDoc returns false before any doc is created for a room', () => {
  assert.equal(hasYDoc('room-new'), false);
});

test('hasYDoc returns true after getYDoc is called', () => {
  getYDoc('room-check');
  assert.equal(hasYDoc('room-check'), true);
});

// ---------------------------------------------------------------------------
// destroyYDoc
// ---------------------------------------------------------------------------

test('destroyYDoc removes the doc from the registry', () => {
  getYDoc('room-destroy');
  assert.equal(hasYDoc('room-destroy'), true);
  destroyYDoc('room-destroy');
  assert.equal(hasYDoc('room-destroy'), false);
});

test('destroyYDoc is idempotent — calling twice does not throw', () => {
  getYDoc('room-idempotent');
  destroyYDoc('room-idempotent');
  assert.doesNotThrow(() => destroyYDoc('room-idempotent'));
});

test('destroyYDoc on a room with no doc is a no-op', () => {
  assert.doesNotThrow(() => destroyYDoc('room-never-created'));
});

test('a new Y.Doc can be created for a room after destruction', () => {
  const first = getYDoc('room-lifecycle');
  first.getText('code').insert(0, 'original content');
  destroyYDoc('room-lifecycle');

  const second = getYDoc('room-lifecycle');
  // Must be a fresh doc — different reference, empty content
  assert.notEqual(first, second, 'should be a new instance after destroy');
  assert.equal(second.getText('code').toString(), '', 'content should be reset after destroy+recreate');
});

// ---------------------------------------------------------------------------
// Boundary: 64-character roomId is valid (edge of the allowed range)
// ---------------------------------------------------------------------------

test('getYDoc accepts a 64-character roomId (max valid length)', () => {
  const maxLength = 'a'.repeat(64);
  assert.doesNotThrow(() => getYDoc(maxLength));
  assert.equal(hasYDoc(maxLength), true);
});
