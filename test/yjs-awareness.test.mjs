/**
 * yjs-awareness.test.mjs — Shree (Yjs / CRDT collaboration), Phase 3
 *
 * Unit tests for src/lib/yjsAwareness.js. No network, no DOM, no React.
 * Repo convention: node:test + node:assert/strict.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAwareness,
  hasAwareness,
  destroyAwareness,
  resetAwarenessForTests,
  setLocalUser,
  setLocalPresence,
  setLocalCursor,
  setLocalSelection,
  getLocalState,
  getLocalClientId,
  getConnectedUsers,
  getRemoteCursors,
  getAwarenessSnapshot,
  subscribeToAwareness,
  encodeAwarenessUpdateFor,
  applyAwarenessUpdateTo,
  removeLocalAwareness,
} from '../src/lib/yjsAwareness.js';
import { resetForTests, getYDoc } from '../src/lib/yjsProvider.js';

afterEach(() => {
  resetAwarenessForTests();
  resetForTests();
});

test('awareness initializes per room and rejects invalid room IDs', () => {
  assert.equal(hasAwareness('room-aw-1'), false);
  const aw = getAwareness('room-aw-1');
  assert.ok(aw);
  assert.equal(hasAwareness('room-aw-1'), true);
  assert.equal(getAwareness('room-aw-1'), aw, 'same room returns same instance');
  assert.throws(() => getAwareness('bad room!!'), { message: /Invalid roomId/ });
  assert.throws(() => getAwareness(''), { message: /Invalid roomId/ });
});

test('setLocalUser seeds user from explicit values', () => {
  assert.equal(setLocalUser('room-aw-user', { id: 'u1', name: 'Ada', color: '#ff0000' }), true);
  const state = getLocalState('room-aw-user');
  assert.deepEqual(state.user, { id: 'u1', name: 'Ada', color: '#ff0000' });
});

test('setLocalUser falls back to shared identity (no duplicate identity system)', () => {
  assert.equal(setLocalUser('room-aw-ident'), true);
  const state = getLocalState('room-aw-ident');
  assert.ok(state.user && typeof state.user.id === 'string' && state.user.id.length > 0);
  assert.ok(typeof state.user.color === 'string');
});

test('presence defaults to online and updates', () => {
  setLocalUser('room-aw-pres', { id: 'u9' });
  setLocalPresence('room-aw-pres');
  assert.equal(getLocalState('room-aw-pres').presence, 'online');
  setLocalPresence('room-aw-pres', 'away');
  assert.equal(getLocalState('room-aw-pres').presence, 'away');
});

test('cursor set / clear; malformed cursor ignored safely', () => {
  assert.equal(setLocalCursor('room-aw-cur', { x: 10, y: 20 }), true);
  assert.deepEqual(getLocalState('room-aw-cur').cursor, { x: 10, y: 20 });
  assert.equal(setLocalCursor('room-aw-cur', null), true);
  assert.equal(getLocalState('room-aw-cur').cursor, null);
  assert.equal(setLocalCursor('room-aw-cur', 'not-an-object'), false);
  assert.equal(setLocalCursor('room-aw-cur', [1, 2]), false);
});

test('selection set / clear; malformed selection ignored safely', () => {
  assert.equal(setLocalSelection('room-aw-sel', ['shape-1', 'shape-2']), true);
  assert.deepEqual(getLocalState('room-aw-sel').selection, ['shape-1', 'shape-2']);
  assert.equal(setLocalSelection('room-aw-sel', null), true);
  assert.equal(setLocalSelection('room-aw-sel', 'shape-1'), false);
  assert.equal(setLocalSelection('room-aw-sel', ['shape-1', 42]), false);
});

test('getConnectedUsers lists local user in presenceToUsers shape', () => {
  setLocalUser('room-aw-users', { id: 'u1', name: 'Ada', color: '#111111' });
  const users = getConnectedUsers('room-aw-users');
  assert.equal(users.length, 1);
  assert.equal(users[0].id, 'u1');
  assert.equal(users[0].name, 'Ada');
  assert.equal(users[0].color, '#111111');
  assert.equal(users[0].self, true);
  assert.equal(users[0].isActive, true);
});

test('awareness encode/apply shares state without touching the Y.Doc', () => {
  setLocalUser('room-aw-share', { id: 'uA', name: 'A' });
  setLocalCursor('room-aw-share', { x: 5, y: 6 });
  setLocalUser('room-aw-peer', { id: 'uB', name: 'B' });

  const encoded = encodeAwarenessUpdateFor('room-aw-share');
  assert.ok(encoded instanceof Uint8Array);
  assert.equal(applyAwarenessUpdateTo('room-aw-peer', encoded, 'test-origin'), true);

  const users = getConnectedUsers('room-aw-peer');
  assert.equal(users.length, 2, 'peer sees both clients');
  const remote = users.find((u) => u.self === false);
  assert.equal(remote.id, 'uA');
  const cursors = getRemoteCursors('room-aw-peer');
  assert.equal(cursors.length, 1);
  assert.deepEqual(cursors[0].cursor, { x: 5, y: 6 });
  assert.equal(cursors[0].self, undefined);
});

test('awareness updates never land in persistent Y.Doc structures', () => {
  const doc = getYDoc('room-aw-nodoc');
  setLocalUser('room-aw-nodoc', { id: 'uX' });
  setLocalCursor('room-aw-nodoc', { x: 1, y: 1 });
  assert.equal(doc.getMap('shapes').size, 0);
  assert.equal(doc.getArray('zOrder').length, 0);
  assert.equal(doc.getText('code').length, 0);
  assert.equal(doc.getMap('metadata').size, 0);
});


test('subscribeToAwareness notifies with snapshot; unsubscribe stops it', () => {
  setLocalUser('room-aw-sub', { id: 'u1' });
  let calls = 0;
  let last = null;
  const unsub = subscribeToAwareness('room-aw-sub', (snapshot) => {
    calls += 1;
    last = snapshot;
  });
  setLocalCursor('room-aw-sub', { x: 3, y: 4 });
  assert.ok(calls >= 1);
  assert.ok(Array.isArray(last.users) && Array.isArray(last.cursors));
  const frozen = calls;
  unsub();
  setLocalCursor('room-aw-sub', { x: 9, y: 9 });
  assert.equal(calls, frozen);
});

test('removeLocalAwareness drops the local client for peers', () => {
  setLocalUser('room-aw-leave', { id: 'uL' });
  setLocalUser('room-aw-leave-peer', { id: 'uP' });
  const encoded = encodeAwarenessUpdateFor('room-aw-leave');
  applyAwarenessUpdateTo('room-aw-leave-peer', encoded, 'x');
  assert.equal(getConnectedUsers('room-aw-leave-peer').length, 2);

  removeLocalAwareness('room-aw-leave', 'local');
  // Removal must be encoded with the removed clientID explicitly (it is no
  // longer in local states). This mirrors the socket provider, which encodes
  // exactly the changed (added/updated/removed) client IDs.
  const leaverId = getLocalClientId('room-aw-leave');
  const removal = encodeAwarenessUpdateFor('room-aw-leave', [leaverId]);
  applyAwarenessUpdateTo('room-aw-leave-peer', removal, 'x');
  const remaining = getConnectedUsers('room-aw-leave-peer');
  assert.ok(remaining.every((u) => u.id !== 'uL'), 'leaver must be gone');
});

test('malformed awareness updates are rejected safely', () => {
  setLocalUser('room-aw-bad', { id: 'u1' });
  assert.equal(applyAwarenessUpdateTo('room-aw-bad', null, 'x'), false);
  assert.equal(applyAwarenessUpdateTo('room-aw-bad', 'not-bytes', 'x'), false);
  assert.equal(applyAwarenessUpdateTo('room-aw-bad', new Uint8Array(0), 'x'), false);
  // Truncated framing (length prefix, no body) throws inside the decoder.
  assert.equal(applyAwarenessUpdateTo('room-aw-bad', new Uint8Array([255]), 'x'), false);
  // Garbage that happens to decode as "zero clients" is a harmless no-op.
  assert.equal(applyAwarenessUpdateTo('room-aw-bad', new Uint8Array([0]), 'x'), true);
  assert.equal(getConnectedUsers('room-aw-bad').length, 1, 'state uncorrupted');
});

test('destroyAwareness is idempotent; rooms are isolated', () => {
  setLocalUser('room-aw-iso-a', { id: 'uA' });
  setLocalUser('room-aw-iso-b', { id: 'uB' });
  assert.equal(getConnectedUsers('room-aw-iso-a').length, 1);
  destroyAwareness('room-aw-iso-a');
  assert.equal(hasAwareness('room-aw-iso-a'), false);
  assert.doesNotThrow(() => destroyAwareness('room-aw-iso-a'));
  assert.equal(getConnectedUsers('room-aw-iso-b').length, 1);
  assert.equal(getLocalClientId('room-aw-iso-b') > 0, true);
});
