/**
 * yjs-disconnect.test.cjs — Shree (Yjs / CRDT collaboration), Phase 3 follow-up
 *
 * Abrupt Socket.io disconnect awareness cleanup:
 *  - server records per-socket awareness clientIDs via yjs:hello
 *  - leave / room-switch / abrupt disconnect broadcast a removal update
 *    (last-seen clock + 1) to the room; peers drop the leaver
 *  - client rebinds cleanly to a new socket object without duplicates
 *
 * Same single-Yjs-copy rule as yjs-sync.test.cjs: dynamic ESM import.
 */

const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { after, before, afterEach, test } = require('node:test');
const { io: connect } = require('socket.io-client');
const { createSocketServer } = require('../server/socket.cjs');

let Y;
let Awareness;
let applyAwarenessUpdate;

const {
  PROTOCOL,
  YJS_UPDATE_EVENT,
  YJS_AWARENESS_EVENT,
  YJS_HELLO_EVENT,
  ORIGIN_REMOTE,
  attachRoomSync,
  detachRoomSync,
  isRoomAttached,
  updateToBase64,
  base64ToUpdate,
  resetSyncForTests,
} = require('../src/lib/yjsSocketProvider.js');
const { getYDoc, resetForTests } = require('../src/lib/yjsProvider.js');
const {
  resetAwarenessForTests,
  getAwareness,
  hasAwareness,
  setLocalUser,
  setLocalCursor,
} = require('../src/lib/yjsAwareness.js');
const { createShape, getSharedShapes } = require('../src/lib/yjsWhiteboard.js');

function freshState() {
  resetSyncForTests();
  resetAwarenessForTests();
  resetForTests();
}

afterEach(() => freshState());

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
    fire(event, ...args) {
      for (const handler of [...(handlers.get(event) || [])]) handler(...args);
    },
  };
}

function helloOf(sock) {
  return sock.emitted.find((e) => e.event === YJS_HELLO_EVENT);
}

// ---------------------------------------------------------------------------
// Client unit tests (no network)
// ---------------------------------------------------------------------------

test('attach sends yjs:hello with the numeric awareness clientID', () => {
  const sock = fakeSocket();
  attachRoomSync({ socket: sock, roomId: 'hello-a' });
  const hello = helloOf(sock);
  assert.ok(hello, 'hello must be emitted on attach');
  assert.equal(hello.payload.roomId, 'hello-a');
  assert.equal(hello.payload.data.protocol, PROTOCOL);
  assert.equal(hello.payload.data.kind, 'hello');
  assert.ok(Number.isInteger(hello.payload.data.clientId) && hello.payload.data.clientId >= 0);
  assert.equal(hello.payload.data.clientId, getAwareness('hello-a').clientID);
});

test('room:joined re-sends hello and bootstrap (join race safety)', () => {
  const sock = fakeSocket();
  attachRoomSync({ socket: sock, roomId: 'hello-join' });
  sock.emitted.length = 0;
  sock.fire('room:joined', { roomId: 'other-room' });
  assert.equal(sock.emitted.length, 0, 'other rooms ignored');
  sock.fire('room:joined', { roomId: 'hello-join' });
  assert.ok(helloOf(sock), 'hello re-sent on room:joined');
  assert.ok(
    sock.emitted.some((e) => e.event === YJS_UPDATE_EVENT && e.payload.data.kind === 'sync-request'),
    'sync re-requested on room:joined',
  );
});

test('re-attach on a new socket rebinds without duplicates or eviction', () => {
  const sock1 = fakeSocket();
  const first = attachRoomSync({ socket: sock1, roomId: 'rebind-a' });
  const clientId = getAwareness('rebind-a').clientID;
  setLocalUser('rebind-a', { id: 'u1' });

  const sock2 = fakeSocket();
  const second = attachRoomSync({ socket: sock2, roomId: 'rebind-a' });
  // Old socket fully unhooked…
  assert.equal(sock1.listeners(YJS_UPDATE_EVENT).length, 0);
  assert.equal(sock1.listeners('room:joined').length, 0);
  // …new socket hooked exactly once…
  assert.equal(sock2.listeners(YJS_UPDATE_EVENT).length, 1);
  assert.equal(sock2.listeners('room:joined').length, 1);
  // …same awareness identity (no duplicate entries for peers)…
  assert.equal(getAwareness('rebind-a').clientID, clientId);
  assert.equal(hasAwareness('rebind-a'), true);
  // …hello goes out on the NEW socket only…
  assert.ok(helloOf(sock2));
  assert.equal(sock1.emitted.filter((e) => e.event === YJS_HELLO_EVENT).length, 1);
  // …and local changes emit exactly once, on the live socket.
  sock1.emitted.length = 0;
  sock2.emitted.length = 0;
  createShape(getYDoc('rebind-a'), { id: 'shape-1', type: 'rectangle', x: 1, y: 2 });
  assert.equal(sock1.emitted.length, 0, 'dead socket emits nothing');
  assert.equal(sock2.emitted.filter((e) => e.event === YJS_UPDATE_EVENT && e.payload.data.kind === 'update').length, 1);
  assert.notEqual(first, second, 'rebind returns a fresh attachment');
  assert.equal(isRoomAttached('rebind-a'), true);
});

// ---------------------------------------------------------------------------
// Real-socket regression tests
// ---------------------------------------------------------------------------

let httpServer;
let port;
let sockets = [];

function waitForEvent(socket, event) {
  return once(socket, event);
}

function waitFor(fn, timeoutMs = 3000, label = 'condition') {
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
  ({ Awareness, applyAwarenessUpdate } = await import('y-protocols/awareness'));
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

/** Standalone awareness peer fed purely from a socket's wire bytes. */
function wireAwarenessPeer(socket, roomId) {
  const peer = new Awareness(new Y.Doc());
  socket.on(YJS_AWARENESS_EVENT, (payload) => {
    if (!payload || payload.roomId !== roomId || !payload.data) return;
    const bytes = base64ToUpdate(payload.data.update);
    if (!bytes) return;
    try {
      applyAwarenessUpdate(peer, bytes, ORIGIN_REMOTE);
    } catch { /* ignore */ }
  });
  return peer;
}

function seesUser(peer, userId) {
  return [...peer.getStates().values()].some((s) => s && s.user && s.user.id === userId);
}

test('abrupt disconnect removes awareness; room stays functional', async () => {
  const sockA = client();
  const sockB = client();
  const sockC = client();
  await Promise.all([waitForEvent(sockA, 'connect'), waitForEvent(sockB, 'connect'), waitForEvent(sockC, 'connect')]);
  await joinRoom(sockA, 'disc-a', 'a');
  await joinRoom(sockB, 'disc-a', 'b');
  await joinRoom(sockC, 'disc-a', 'c');

  attachRoomSync({ socket: sockA, roomId: 'disc-a', identity: { userId: 'a', displayName: 'A' } });
  setLocalUser('disc-a', { id: 'a', name: 'A' });
  setLocalCursor('disc-a', { x: 10, y: 20 });

  const peerB = wireAwarenessPeer(sockB, 'disc-a');
  await waitFor(() => (seesUser(peerB, 'a') ? true : null), 3000, 'B sees A awareness');

  // Abrupt loss: no room:leave, no detach — transport just dies.
  sockA.disconnect();
  await waitFor(() => (!seesUser(peerB, 'a') ? true : null), 3000, 'B drops A awareness');

  // Room remains functional: B's edit reaches C over the Yjs channel and
  // the legacy channel alike.
  const docC = new Y.Doc();
  sockC.on(YJS_UPDATE_EVENT, (payload) => {
    if (!payload || payload.roomId !== 'disc-a' || !payload.data) return;
    const bytes = base64ToUpdate(payload.data.update);
    if (bytes) Y.applyUpdate(docC, bytes, ORIGIN_REMOTE);
  });
  const legacy = waitForEvent(sockC, 'canvas:update');
  const docB = new Y.Doc();
  createShape(docB, { id: 'shape-b1', type: 'rectangle', x: 5, y: 5 });
  sockB.emit(YJS_UPDATE_EVENT, {
    roomId: 'disc-a',
    data: { protocol: PROTOCOL, kind: 'update', update: updateToBase64(Y.encodeStateAsUpdate(docB)) },
  });
  sockB.emit('canvas:update', { roomId: 'disc-a', data: { op: 'ping' } });
  const [legacyPayload] = await legacy;
  assert.deepEqual(legacyPayload.data, { op: 'ping' });
  const [shapeC] = await waitFor(() => {
    const all = getSharedShapes(docC);
    return all.length === 1 ? all : null;
  }, 3000, 'C converges on B edit');
  assert.equal(shapeC.id, 'shape-b1');
  peerB.destroy();
});

test('room switch broadcasts removal to the previous room only', async () => {
  const sockA = client();
  const sockOld = client();
  const sockNew = client();
  await Promise.all([waitForEvent(sockA, 'connect'), waitForEvent(sockOld, 'connect'), waitForEvent(sockNew, 'connect')]);
  await joinRoom(sockA, 'disc-old', 'a');
  await joinRoom(sockOld, 'disc-old', 'witness');
  await joinRoom(sockNew, 'disc-new', 'witness-new');

  attachRoomSync({ socket: sockA, roomId: 'disc-old', identity: { userId: 'a' } });
  setLocalUser('disc-old', { id: 'a', name: 'A' });
  const peerOld = wireAwarenessPeer(sockOld, 'disc-old');
  const peerNew = wireAwarenessPeer(sockNew, 'disc-new');
  await waitFor(() => (seesUser(peerOld, 'a') ? true : null), 3000, 'old room sees A');

  // Architecture allows exactly one room per socket: joining disc-new
  // leaves disc-old server-side.
  sockA.emit('room:join', { roomId: 'disc-new', userId: 'a', displayName: 'A' });
  await waitForEvent(sockA, 'room:joined');
  await waitFor(() => (!seesUser(peerOld, 'a') ? true : null), 3000, 'old room drops A');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(seesUser(peerNew, 'a'), false, 'new room gets no spurious removal or phantom');
  peerOld.destroy();
  peerNew.destroy();
});

test('hello validation rejects bad mappings without crashing', async () => {
  const sock = client();
  const sockPeer = client();
  await Promise.all([waitForEvent(sock, 'connect'), waitForEvent(sockPeer, 'connect')]);
  await joinRoom(sock, 'disc-hello', 'h');
  await joinRoom(sockPeer, 'disc-hello', 'p');

  const removals = [];
  sockPeer.on(YJS_AWARENESS_EVENT, (payload) => removals.push(payload));

  const errWrongRoom = waitForEvent(sock, 'connection:error');
  sock.emit(YJS_HELLO_EVENT, { roomId: 'disc-other', data: { protocol: PROTOCOL, kind: 'hello', clientId: 1 } });
  assert.equal((await errWrongRoom)[0].event, 'yjs:hello');

  const errBadId = waitForEvent(sock, 'connection:error');
  sock.emit(YJS_HELLO_EVENT, { roomId: 'disc-hello', data: { protocol: PROTOCOL, kind: 'hello', clientId: 'nope' } });
  assert.equal((await errBadId)[0].event, 'yjs:hello');

  const errBadShape = waitForEvent(sock, 'connection:error');
  sock.emit(YJS_HELLO_EVENT, { roomId: 'disc-hello', data: { protocol: PROTOCOL, kind: 'hello' } });
  assert.equal((await errBadShape)[0].event, 'yjs:hello');

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(removals.length, 0, 'failed hellos record nothing and broadcast nothing');
  assert.ok(sock.connected, 'socket survives bad hellos');
});

test('reconnect on a new socket keeps one awareness entry (no duplicates)', async () => {
  const sockA1 = client();
  const sockB = client();
  await Promise.all([waitForEvent(sockA1, 'connect'), waitForEvent(sockB, 'connect')]);
  await joinRoom(sockA1, 'disc-re', 'a');
  await joinRoom(sockB, 'disc-re', 'b');

  attachRoomSync({ socket: sockA1, roomId: 'disc-re', identity: { userId: 'a' } });
  setLocalUser('disc-re', { id: 'a', name: 'A' });
  const peerB = wireAwarenessPeer(sockB, 'disc-re');
  await waitFor(() => (seesUser(peerB, 'a') ? true : null), 3000, 'B sees A');

  // Abrupt drop, then the same user returns on a FRESH socket object
  // (recreated transport). Same process doc → same clientID.
  sockA1.disconnect();
  await waitFor(() => (!seesUser(peerB, 'a') ? true : null), 3000, 'B drops A after disconnect');

  const sockA2 = client();
  await waitForEvent(sockA2, 'connect');
  await joinRoom(sockA2, 'disc-re', 'a');
  attachRoomSync({ socket: sockA2, roomId: 'disc-re', identity: { userId: 'a' } });
  setLocalCursor('disc-re', { x: 3, y: 3 });
  await waitFor(() => (seesUser(peerB, 'a') ? true : null), 3000, 'B sees A again');
  const entries = [...peerB.getStates().values()].filter((s) => s && s.user && s.user.id === 'a');
  assert.equal(entries.length, 1, 'exactly one awareness entry after reconnect');
  peerB.destroy();
});
