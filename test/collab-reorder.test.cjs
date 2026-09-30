/**
 * collab-reorder.test.cjs — reorder/undo-Redo sync over the real transport.
 * A emits a full-array reorder op via canvas:update; B must receive and be
 * able to apply it, while B itself never rebroadcasts (loop-freedom is
 * structural: the receive path only ever calls setShapes).
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { after, before, test } = require('node:test');
const { io: connect } = require('socket.io-client');
const { createSocketServer } = require('../server/socket.cjs');
const { applyWhiteboardOp } = require('../src/lib/collabOps.js');

let httpServer;
let port;
const sockets = [];

const waitForEvent = (socket, event) => once(socket, event);

before(async () => {
  httpServer = http.createServer();
  createSocketServer(httpServer);
  httpServer.listen(0);
  await once(httpServer, 'listening');
  port = httpServer.address().port;
});

after(async () => {
  for (const socket of sockets) socket.disconnect();
  await new Promise((resolve) => httpServer.close(resolve));
});

function client() {
  const socket = connect(`http://localhost:${port}`, { forceNew: true });
  sockets.push(socket);
  return socket;
}

const rect = (id, x) => ({
  id,
  type: 'rectangle',
  x,
  y: 20,
  width: 100,
  height: 50,
  stroke: '#0f766e',
  strokeWidth: 4,
});

test('A reorders → B receives → B does not rebroadcast; undo-shaped restore applies', async () => {
  const a = client();
  const b = client();
  await Promise.all([waitForEvent(a, 'connect'), waitForEvent(b, 'connect')]);

  a.emit('room:join', { roomId: 'reorder-room', userId: 'a' });
  await waitForEvent(a, 'room:joined');
  b.emit('room:join', { roomId: 'reorder-room', userId: 'b' });
  await waitForEvent(b, 'room:joined');

  // Local reorder propagation: reversed order reaches B intact.
  const s1 = rect('shape-1', 10);
  const s2 = rect('shape-2', 200);
  const bCanvas = waitForEvent(b, 'canvas:update');
  a.emit('canvas:update', { roomId: 'reorder-room', data: { op: 'reorder', shapes: [s2, s1], actorId: a.id } });
  const [payload] = await bCanvas;
  assert.equal(payload.roomId, 'reorder-room');
  const applied = applyWhiteboardOp([s1, s2], payload.data, b.id);
  assert.equal(applied.applied, true);
  assert.deepEqual(applied.shapes.map((s) => s.id), ['shape-2', 'shape-1']);

  // No rebroadcast loop: B applies silently — A must hear nothing back.
  const echoBack = waitForEvent(a, 'canvas:update');
  await assert.rejects(
    Promise.race([
      echoBack,
      new Promise((_, reject) => setTimeout(() => reject(new Error('no-rebroadcast')), 150)),
    ]),
    /no-rebroadcast/,
  );

  // Undo-shaped restore (same order, older content) still applies remotely.
  const moved = { ...s2, x: 5 };
  const bCanvas2 = waitForEvent(b, 'canvas:update');
  a.emit('canvas:update', { roomId: 'reorder-room', data: { op: 'reorder', shapes: [s2, s1], actorId: a.id } });
  const [payload2] = await bCanvas2;
  const restored = applyWhiteboardOp([moved, s1], payload2.data, b.id);
  assert.equal(restored.applied, true);
  assert.equal(restored.shapes[0].x, 200);
});
