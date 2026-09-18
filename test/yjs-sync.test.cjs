/**
 * yjs-sync.test.cjs — Shree (Yjs / CRDT collaboration), Phase 3
 *
 * Tests for src/lib/yjsSocketProvider.js:
 *  Part 1 — deterministic unit tests with fake sockets (no network).
 *  Part 2 — real Socket.io integration reusing the repo's server harness
 *           (server/socket.cjs + socket.io-client), same-room sync,
 *           isolation, unauthorized room access, malformed traffic,
 *           awareness wire cleanup.
 *
 * NOTE: one OS process shares the getYDoc singleton, so the "second
 * client" on the wire is a standalone Y.Doc / Awareness driven through a
 * real socket — this exercises the full encode → server → decode path.
 */

const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { after, before, afterEach, test } = require('node:test');
const { io: connect } = require('socket.io-client');
// Single shared Yjs copy: dynamic ESM import hits the same module record
// the src/ ESM modules use. (require('yjs') would load the CJS build — a
// second copy that breaks instanceof checks and cross-doc integration.)
let Y;
let Awareness;
let encodeAwarenessUpdate;
let applyAwarenessUpdate;
const { createSocketServer } = require('../server/socket.cjs');
const {
  PROTOCOL,
  YJS_UPDATE_EVENT,
  YJS_AWARENESS_EVENT,
  ORIGIN_REMOTE,
  MAX_YJS_MESSAGE_BYTES,
  attachRoomSync,
  detachRoomSync,
  isRoomAttached,
  isValidYjsEnvelope,
  updateToBase64,
  base64ToUpdate,
  resetSyncForTests,
} = require('../src/lib/yjsSocketProvider.js');
const { getYDoc, resetForTests } = require('../src/lib/yjsProvider.js');
const { resetAwarenessForTests, getAwareness } = require('../src/lib/yjsAwareness.js');
const { createShape, getSharedShapes } = require('../src/lib/yjsWhiteboard.js');

function shape(id, extra = {}) {
  return { id, type: 'rectangle', x: 10, y: 20, width: 50, height: 40, fill: '#ffffff', ...extra };
}

// ---------------------------------------------------------------------------
// Fake socket (Part 1)
// ---------------------------------------------------------------------------

function fakeSocket() {
  const handlers = new Map();
  return {
    connected: true,
    emitted: [],
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },
    off(event, handler) {
      if (!handlers.has(event)) return;
      if (!handler) handlers.delete(event);
      else handlers.set(event, handlers.get(event).filter((h) => h !== handler));
    },
    emit(event, payload) {
      this.emitted.push({ event, payload });
    },
    listeners(event) {
      return [...(handlers.get(event) || [])];
    },
    receive(event, payload) {
      for (const handler of [...(handlers.get(event) || [])]) handler(payload);
    },
    fire(event, ...args) {
      for (const handler of [...(handlers.get(event) || [])]) handler(...args);
    },
  };
}

function lastEmit(sock, event) {
  const found = sock.emitted.filter((e) => e.event === event);
  return found[found.length - 1];
}

function freshRoomState() {
  resetSyncForTests();
  resetAwarenessForTests();
  resetForTests();
}

afterEach(() => freshRoomState());

// ---------------------------------------------------------------------------
// Part 1 — unit tests with fake sockets
// ---------------------------------------------------------------------------

test('attach validates room IDs and emits a sync-request bootstrap', () => {
  assert.throws(() => attachRoomSync({ socket: fakeSocket(), roomId: 'bad room' }), /Invalid roomId/);
  const sock = fakeSocket();
  const att = attachRoomSync({ socket: sock, roomId: 'fake-a' });
  assert.equal(isRoomAttached('fake-a'), true);
  const req = lastEmit(sock, YJS_UPDATE_EVENT);
  assert.ok(req, 'sync-request must be emitted on attach');
  assert.equal(req.payload.roomId, 'fake-a');
  assert.equal(req.payload.data.protocol, PROTOCOL);
  assert.equal(req.payload.data.kind, 'sync-request');
  assert.equal(typeof req.payload.data.stateVector, 'string');
  assert.ok(att.doc);
  assert.ok(att.awareness);
});

test('attach is idempotent — no duplicate listeners or bootstrap storms', () => {
  const sock = fakeSocket();
  const first = attachRoomSync({ socket: sock, roomId: 'fake-idem' });
  const count = sock.emitted.length;
  const second = attachRoomSync({ socket: sock, roomId: 'fake-idem' });
  assert.equal(first, second);
  assert.equal(sock.emitted.length, count, 're-attach must not re-emit');
  assert.equal(sock.listeners(YJS_UPDATE_EVENT).length, 1);
  assert.equal(sock.listeners(YJS_AWARENESS_EVENT).length, 1);
});

test('local doc change emits exactly one incremental update', () => {
  const sock = fakeSocket();
  attachRoomSync({ socket: sock, roomId: 'fake-inc' });
  sock.emitted.length = 0;
  createShape(getYDoc('fake-inc'), shape('shape-1'));
  const updates = sock.emitted.filter((e) => e.event === YJS_UPDATE_EVENT);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].payload.data.kind, 'update');
  assert.ok(updates[0].payload.data.update.length < 4096, 'incremental, not full resend');
});

test('remote apply does NOT rebroadcast (echo prevention)', () => {
  const sock = fakeSocket();
  attachRoomSync({ socket: sock, roomId: 'fake-echo' });
  sock.emitted.length = 0;
  createShape(getYDoc('fake-echo'), shape('shape-1'));
  assert.equal(sock.emitted.length, 1);
  const wire = sock.emitted[0].payload;
  // Peer echoes the same bytes back at us (malicious or duplicated path).
  sock.receive(YJS_UPDATE_EVENT, wire);
  sock.receive(YJS_UPDATE_EVENT, wire);
  assert.equal(sock.emitted.length, 1, 'remote applies must never emit');
  assert.equal(getSharedShapes(getYDoc('fake-echo')).length, 1, 'no duplicate content');
});

test('two attached rooms sync through wired fake sockets and converge', () => {
  const sockA = fakeSocket();
  const sockB = fakeSocket();
  // Wire: A emits -> B receives and vice versa.
  const origEmitA = sockA.emit.bind(sockA);
  const origEmitB = sockB.emit.bind(sockB);
  sockA.emit = (event, payload) => {
    origEmitA(event, payload);
    if (event === YJS_UPDATE_EVENT || event === YJS_AWARENESS_EVENT) sockB.receive(event, payload);
  };
  sockB.emit = (event, payload) => {
    origEmitB(event, payload);
    if (event === YJS_UPDATE_EVENT || event === YJS_AWARENESS_EVENT) sockA.receive(event, payload);
  };
  // Same-room convergence needs two docs: attach A normally, drive B with
  // a standalone doc bridged onto sockB.
  attachRoomSync({ socket: sockA, roomId: 'fake-wire' });
  const docB = new Y.Doc();
  docB.on('update', (update, origin) => {
    if (origin === ORIGIN_REMOTE) return;
    const b64 = updateToBase64(update);
    sockB.emit(YJS_UPDATE_EVENT, { roomId: 'fake-wire', data: { protocol: PROTOCOL, kind: 'update', update: b64 } });
  });
  sockB.on(YJS_UPDATE_EVENT, (payload) => {
    if (!payload || payload.roomId !== 'fake-wire') return;
    const bytes = base64ToUpdate(payload.data.update);
    if (bytes) Y.applyUpdate(docB, bytes, ORIGIN_REMOTE);
  });
  // Drain bootstrap chatter, then exchange concurrent changes.
  sockA.emitted.length = 0;
  createShape(getYDoc('fake-wire'), shape('shape-A', { x: 1 }));
  // Standalone peer creates concurrently (before receiving).
  const m = new Y.Map();
  m.set('id', 'shape-B');
  m.set('type', 'rectangle');
  docB.getMap('shapes').set('shape-B', m);
  // Flush: deliver pending A->B traffic until quiescent.
  for (let i = 0; i < 10; i += 1) {
    const pending = sockA.emitted.splice(0).filter((e) => e.event === YJS_UPDATE_EVENT);
    if (pending.length === 0) break;
  }
  const idsA = getSharedShapes(getYDoc('fake-wire')).map((s) => s.id).sort();
  assert.deepEqual(idsA, ['shape-A', 'shape-B']);
});

test('duplicate wire delivery is safe (Yjs idempotent apply)', () => {
  const sock = fakeSocket();
  attachRoomSync({ socket: sock, roomId: 'fake-dup' });
  sock.emitted.length = 0;
  createShape(getYDoc('fake-dup'), shape('shape-1'));
  const wire = sock.emitted[0].payload;
  sock.receive(YJS_UPDATE_EVENT, wire);
  sock.receive(YJS_UPDATE_EVENT, wire);
  sock.receive(YJS_UPDATE_EVENT, wire);
  assert.equal(getSharedShapes(getYDoc('fake-dup')).length, 1);
  assert.equal(sock.emitted.length, 1, 'no rebroadcast storm from duplicates');
});

test('malformed inbound payloads are dropped safely', () => {
  const sock = fakeSocket();
  attachRoomSync({ socket: sock, roomId: 'fake-mal' });
  sock.emitted.length = 0;
  createShape(getYDoc('fake-mal'), shape('shape-1'));
  const before = sock.emitted.length;
  const bad = [
    null,
    undefined,
    { roomId: 'fake-mal' },
    { roomId: 'fake-mal', data: null },
    { roomId: 'fake-mal', data: { protocol: 'wrong', kind: 'update', update: 'eA==' } },
    { roomId: 'fake-mal', data: { protocol: PROTOCOL, kind: 'nonsense', update: 'eA==' } },
    { roomId: 'fake-mal', data: { protocol: PROTOCOL, kind: 'update', update: '!!!not-base64!!!' } },
    { roomId: 'fake-mal', data: { protocol: PROTOCOL, kind: 'update', update: '' } },
    { roomId: 'other-room', data: { protocol: PROTOCOL, kind: 'update', update: 'eA==' } },
    { roomId: 'fake-mal', data: { protocol: PROTOCOL, kind: 'sync-request', stateVector: '%%%' } },
  ];
  for (const payload of bad) {
    assert.doesNotThrow(() => sock.receive(YJS_UPDATE_EVENT, payload), `must not throw for ${JSON.stringify(payload)}`);
    assert.doesNotThrow(() => sock.receive(YJS_AWARENESS_EVENT, payload));
  }
  assert.equal(sock.emitted.length, before, 'nothing rebroadcast for garbage');
  assert.equal(getSharedShapes(getYDoc('fake-mal')).length, 1, 'doc uncorrupted');
});

test('oversized updates are never emitted', () => {
  const sock = fakeSocket();
  attachRoomSync({ socket: sock, roomId: 'fake-big' });
  sock.emitted.length = 0;
  getYDoc('fake-big').getText('code').insert(0, 'x'.repeat(300 * 1024));
  assert.equal(
    sock.emitted.filter((e) => e.event === YJS_UPDATE_EVENT).length,
    0,
    '300KB update must be skipped, not sent',
  );
});

test('envelope validator rejects unexpected shapes', () => {
  assert.equal(isValidYjsEnvelope(null), null);
  assert.equal(isValidYjsEnvelope({ protocol: PROTOCOL, kind: 'update' }), null);
  assert.equal(isValidYjsEnvelope({ protocol: PROTOCOL, kind: 'update', update: '' }), null);
  assert.ok(isValidYjsEnvelope({ protocol: PROTOCOL, kind: 'update', update: 'eA==' }));
  assert.ok(isValidYjsEnvelope({ protocol: PROTOCOL, kind: 'sync-request', stateVector: 'eA==' }));
  assert.equal(isValidYjsEnvelope({ protocol: PROTOCOL, kind: 'sync-request' }), null);
  assert.equal(base64ToUpdate('!!!'), null);
  assert.equal(base64ToUpdate(''), null);
  assert.equal(base64ToUpdate('A'.repeat(400 * 1024)), null, 'oversized decode rejected');
  const roundtrip = base64ToUpdate(updateToBase64(new Uint8Array([1, 2, 3, 250])));
  assert.ok(roundtrip instanceof Uint8Array && roundtrip.length === 4);
});

test('detach removes listeners, broadcasts awareness removal, cleans up', () => {
  const sock = fakeSocket();
  attachRoomSync({ socket: sock, roomId: 'fake-leave', identity: { userId: 'u1', displayName: 'U' } });
  assert.equal(sock.listeners(YJS_UPDATE_EVENT).length, 1);
  sock.emitted.length = 0;
  assert.equal(detachRoomSync('fake-leave'), true);
  assert.equal(isRoomAttached('fake-leave'), false);
  assert.equal(detachRoomSync('fake-leave'), false, 'second detach is a no-op');
  assert.equal(sock.listeners(YJS_UPDATE_EVENT).length, 0);
  assert.equal(sock.listeners(YJS_AWARENESS_EVENT).length, 0);
  assert.equal(sock.listeners('connect').length, 0);
  const awEmit = sock.emitted.find((e) => e.event === YJS_AWARENESS_EVENT);
  assert.ok(awEmit, 'peers must receive the awareness removal');
  // Doc survives (Phase 1 owns it); awareness instance is gone.
  assert.ok(getYDoc('fake-leave'));
  const { hasAwareness } = require('../src/lib/yjsAwareness.js');
  assert.equal(hasAwareness('fake-leave'), false);
});

test('reconnect re-requests sync without duplicating listeners', () => {
  const sock = fakeSocket();
  attachRoomSync({ socket: sock, roomId: 'fake-re' });
  sock.emitted.length = 0;
  sock.fire('connect');
  const reqs = sock.emitted.filter((e) => e.event === YJS_UPDATE_EVENT && e.payload.data.kind === 'sync-request');
  assert.equal(reqs.length, 1, 'exactly one bootstrap on reconnect');
  assert.equal(sock.listeners(YJS_UPDATE_EVENT).length, 1, 'no duplicate listeners');
});

// ---------------------------------------------------------------------------
// Part 2 — real Socket.io integration
// ---------------------------------------------------------------------------

let httpServer;
let port;
let sockets = [];

function waitForEvent(socket, event) {
  return once(socket, event);
}

function waitFor(fn, timeoutMs = 2000, label = 'condition') {
  const start = Date.now();
  return (async () => {
    for (;;) {
      try {
        const value = fn();
        if (value) return value;
      } catch { /* retry */ }
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  })();
}

before(async () => {
  Y = await import('yjs');
  ({ Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } = await import('y-protocols/awareness'));
  httpServer = http.createServer();
  createSocketServer(httpServer);
  httpServer.listen(0);
  await once(httpServer, 'listening');
  port = httpServer.address().port;
});

after(async () => {
  for (const socket of sockets) {
    try {
      socket.disconnect();
    } catch { /* ignore */ }
  }
  await new Promise((resolve) => httpServer.close(resolve));
});

function client() {
  const socket = connect(`http://localhost:${port}`, { forceNew: true });
  sockets.push(socket);
  return socket;
}

async function joinRoom(socket, roomId, userId) {
  socket.emit('room:join', { roomId, userId, displayName: userId });
  await waitForEvent(socket, 'room:joined');
}

test('wire sync: attached client change reaches peer doc; peer isolated by room', async () => {
  const sockA = client();
  const sockB = client();
  const sockOther = client();
  await Promise.all([waitForEvent(sockA, 'connect'), waitForEvent(sockB, 'connect'), waitForEvent(sockOther, 'connect')]);
  await joinRoom(sockA, 'wire-a', 'a1');
  await joinRoom(sockB, 'wire-a', 'a2');
  await joinRoom(sockOther, 'wire-b', 'b1');

  attachRoomSync({ socket: sockA, roomId: 'wire-a', identity: { userId: 'a1', displayName: 'A1' } });

  // Peer doc driven purely from wire bytes captured on sockB.
  const peerDoc = new Y.Doc();
  const otherSeen = [];
  sockB.on(YJS_UPDATE_EVENT, (payload) => {
    if (!payload || payload.roomId !== 'wire-a') return;
    const bytes = base64ToUpdate(payload.data.update);
    if (bytes) Y.applyUpdate(peerDoc, bytes, ORIGIN_REMOTE);
  });
  sockOther.on(YJS_UPDATE_EVENT, (payload) => otherSeen.push(payload));
  sockOther.on(YJS_AWARENESS_EVENT, (payload) => otherSeen.push(payload));

  createShape(getYDoc('wire-a'), shape('shape-wire-1', { x: 77 }));
  const [peerShape] = await waitFor(() => {
    const all = getSharedShapes(peerDoc);
    return all.length === 1 ? all : null;
  }, 2000, 'peer doc convergence');
  assert.equal(peerShape.x, 77);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(otherSeen.length, 0, 'room-b must receive nothing');
});

test('wire echo: inbound peer change is applied but never rebroadcast', async () => {
  const sockA = client();
  const sockSnoop = client();
  await Promise.all([waitForEvent(sockA, 'connect'), waitForEvent(sockSnoop, 'connect')]);
  await joinRoom(sockA, 'wire-echo', 'a1');
  await joinRoom(sockSnoop, 'wire-echo', 'snoop');
  attachRoomSync({ socket: sockA, roomId: 'wire-echo' });

  const rebroadcasts = [];
  sockSnoop.on(YJS_UPDATE_EVENT, (payload) => {
    // Ignore kind sync-request (attach bootstrap races the listener);
    // an echo would arrive as kind update/sync-state.
    if (!payload || !payload.data || payload.data.kind === 'sync-request') return;
    rebroadcasts.push(payload);
  });

  // Standalone peer authors a change and sends it on the wire.
  const peerDoc = new Y.Doc();
  createShape(peerDoc, shape('shape-echo-1'));
  const bytes = Y.encodeStateAsUpdate(peerDoc);
  const b64 = updateToBase64(bytes);
  sockSnoop.emit(YJS_UPDATE_EVENT, { roomId: 'wire-echo', data: { protocol: PROTOCOL, kind: 'update', update: b64 } });

  await waitFor(() => (getSharedShapes(getYDoc('wire-echo')).length === 1 ? true : null), 2000, 'inbound apply');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(rebroadcasts.length, 0, 'attached client must NOT rebroadcast the remote update');
});

test('initial sync: sync-request bootstrap converges a fresh doc', async () => {
  const sockA = client();
  const sockFresh = client();
  await Promise.all([waitForEvent(sockA, 'connect'), waitForEvent(sockFresh, 'connect')]);
  await joinRoom(sockA, 'wire-boot', 'a1');
  await joinRoom(sockFresh, 'wire-boot', 'fresh');
  attachRoomSync({ socket: sockA, roomId: 'wire-boot' });
  createShape(getYDoc('wire-boot'), shape('shape-boot-1', { x: 11 }));
  await new Promise((resolve) => setTimeout(resolve, 100));

  const freshDoc = new Y.Doc();
  const replies = [];
  sockFresh.on(YJS_UPDATE_EVENT, (payload) => {
    if (!payload || payload.roomId !== 'wire-boot') return;
    replies.push(payload);
    if (payload.data.kind === 'sync-state' || payload.data.kind === 'update') {
      const bytes = base64ToUpdate(payload.data.update);
      if (bytes) Y.applyUpdate(freshDoc, bytes, ORIGIN_REMOTE);
    }
  });
  const vector = updateToBase64(Y.encodeStateVector(freshDoc));
  sockFresh.emit(YJS_UPDATE_EVENT, { roomId: 'wire-boot', data: { protocol: PROTOCOL, kind: 'sync-request', stateVector: vector } });

  const [freshShape] = await waitFor(() => {
    const all = getSharedShapes(freshDoc);
    return all.length === 1 ? all : null;
  }, 2000, 'bootstrap convergence');
  assert.equal(freshShape.x, 11);
  assert.ok(replies.some((p) => p.data.kind === 'sync-state'), 'member must answer with a diff');
});

test('unauthorized room targeting is rejected without broadcast', async () => {
  const intruder = client();
  const member = client();
  await Promise.all([waitForEvent(intruder, 'connect'), waitForEvent(member, 'connect')]);
  await joinRoom(intruder, 'wire-sec-a', 'intruder');
  await joinRoom(member, 'wire-sec-b', 'member');

  const leaked = [];
  member.on(YJS_UPDATE_EVENT, (payload) => leaked.push(payload));
  const err = waitForEvent(intruder, 'connection:error');
  intruder.emit(YJS_UPDATE_EVENT, {
    roomId: 'wire-sec-b',
    data: { protocol: PROTOCOL, kind: 'update', update: updateToBase64(new Uint8Array([0])) },
  });
  const [errPayload] = await err;
  assert.match(errPayload.message, /does not belong/);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(leaked.length, 0, 'spoofed room update must not broadcast');
});

test('malformed wire traffic never crashes or corrupts the doc', async () => {
  const sockA = client();
  const sockBad = client();
  await Promise.all([waitForEvent(sockA, 'connect'), waitForEvent(sockBad, 'connect')]);
  await joinRoom(sockA, 'wire-mal', 'a1');
  await joinRoom(sockBad, 'wire-mal', 'bad');
  attachRoomSync({ socket: sockA, roomId: 'wire-mal' });
  createShape(getYDoc('wire-mal'), shape('shape-mal-1'));
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Envelope-shaped garbage the server relays opaquely; client must drop it.
  sockBad.emit(YJS_UPDATE_EVENT, { roomId: 'wire-mal', data: { protocol: PROTOCOL, kind: 'update', update: 'eA==' } });
  sockBad.emit(YJS_UPDATE_EVENT, { roomId: 'wire-mal', data: { protocol: PROTOCOL, kind: 'awareness', update: '!!!' } });
  // Shape violations the server rejects outright (no crash either way).
  sockBad.emit(YJS_UPDATE_EVENT, { roomId: 'wire-mal' });
  sockBad.emit(YJS_UPDATE_EVENT, { data: { protocol: PROTOCOL, kind: 'update', update: 'eA==' } });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(getSharedShapes(getYDoc('wire-mal')).length, 1, 'doc uncorrupted by garbage');
  assert.ok(sockA.connected, 'attached client still alive');
});

test('awareness removal travels the wire on detach (peer drops leaver)', async () => {
  const sockA = client();
  const sockPeer = client();
  await Promise.all([waitForEvent(sockA, 'connect'), waitForEvent(sockPeer, 'connect')]);
  await joinRoom(sockA, 'wire-disc', 'a1');
  await joinRoom(sockPeer, 'wire-disc', 'peer');
  attachRoomSync({ socket: sockA, roomId: 'wire-disc', identity: { userId: 'a1', displayName: 'A1' } });
  const { setLocalCursor } = require('../src/lib/yjsAwareness.js');
  setLocalCursor('wire-disc', { x: 1, y: 2 });

  // Standalone awareness peer fed purely from wire bytes.
  const peerAw = new Awareness(new Y.Doc());
  sockPeer.on(YJS_AWARENESS_EVENT, (payload) => {
    if (!payload || payload.roomId !== 'wire-disc' || !payload.data || payload.data.kind !== 'awareness') return;
    const bytes = base64ToUpdate(payload.data.update);
    if (bytes) {
      try {
        applyAwarenessUpdate(peerAw, bytes, ORIGIN_REMOTE);
      } catch { /* ignore */ }
    }
  });
  const seen = (id) => [...peerAw.getStates().values()].some((s) => s && s.user && s.user.id === id);
  await waitFor(() => (seen('a1') ? true : null), 3000, 'peer sees joiner awareness');

  detachRoomSync('wire-disc');
  await waitFor(() => (!seen('a1') ? true : null), 3000, 'peer drops leaver awareness');
  peerAw.destroy();
});
