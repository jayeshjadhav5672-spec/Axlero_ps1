const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { after, before, test } = require("node:test");
const { io: connect } = require("socket.io-client");
const { createSocketServer } = require("../server/socket.cjs");

let httpServer;
let port;
let sockets = [];

function waitForEvent(socket, event) {
  return once(socket, event);
}

before(async () => {
  httpServer = http.createServer();
  createSocketServer(httpServer);
  httpServer.listen(0);
  await once(httpServer, "listening");
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

async function joinRoom(socket, roomId, userId) {
  socket.emit("room:join", { roomId, userId });
  await waitForEvent(socket, "room:joined");
}

test("draw:stroke-progress streams to room peers but not the sender", async () => {
  const drawer = client();
  const peer = client();
  await Promise.all([waitForEvent(drawer, "connect"), waitForEvent(peer, "connect")]);
  await joinRoom(drawer, "stroke-room", "drawer");
  await joinRoom(peer, "stroke-room", "peer");

  const onPeer = waitForEvent(peer, "draw:stroke-progress");
  // Sender must not receive its own broadcast.
  const selfEcho = waitForEvent(drawer, "draw:stroke-progress");
  drawer.emit("draw:stroke-progress", {
    roomId: "stroke-room",
    data: { strokeId: "shape-live-1", points: [0, 0, 10, 10], stroke: "#111111", strokeWidth: 4, opacity: 1 },
  });

  const [payload] = await onPeer;
  assert.equal(payload.roomId, "stroke-room");
  assert.deepEqual(payload.data.points, [0, 0, 10, 10]);
  assert.equal(typeof payload.socketId, "string");
  await assert.rejects(
    Promise.race([selfEcho, new Promise((_, reject) => setTimeout(() => reject(new Error("no-echo")), 120))]),
    /no-echo/,
  );
});

test("draw:stroke-complete and draw:stroke-cancel settle peer previews", async () => {
  const drawer = client();
  const peer = client();
  await Promise.all([waitForEvent(drawer, "connect"), waitForEvent(peer, "connect")]);
  await joinRoom(drawer, "settle-room", "drawer");
  await joinRoom(peer, "settle-room", "peer");

  const complete = waitForEvent(peer, "draw:stroke-complete");
  const shape = { id: "shape-live-2", type: "freehand", points: [0, 0, 5, 5] };
  drawer.emit("draw:stroke-complete", { roomId: "settle-room", data: { strokeId: "shape-live-2", shape } });
  const [completePayload] = await complete;
  assert.deepEqual(completePayload.data.shape, shape);

  const cancel = waitForEvent(peer, "draw:stroke-cancel");
  drawer.emit("draw:stroke-cancel", { roomId: "settle-room", data: { strokeId: "shape-live-3" } });
  const [cancelPayload] = await cancel;
  assert.equal(cancelPayload.data.strokeId, "shape-live-3");
});

test("stroke streams stay isolated per room", async () => {
  const drawer = client();
  const peer = client();
  const outsider = client();
  await Promise.all([
    waitForEvent(drawer, "connect"),
    waitForEvent(peer, "connect"),
    waitForEvent(outsider, "connect"),
  ]);
  await joinRoom(drawer, "iso-a", "drawer");
  await joinRoom(peer, "iso-a", "peer");
  await joinRoom(outsider, "iso-b", "outsider");

  const leaked = waitForEvent(outsider, "draw:stroke-progress");
  const delivered = waitForEvent(peer, "draw:stroke-progress");
  drawer.emit("draw:stroke-progress", {
    roomId: "iso-a",
    data: { strokeId: "shape-iso", points: [1, 1, 2, 2] },
  });
  await delivered;
  await assert.rejects(
    Promise.race([leaked, new Promise((_, reject) => setTimeout(() => reject(new Error("isolated")), 120))]),
    /isolated/,
  );
});

test("stroke streams reject spoofing, malformed and oversized payloads", async () => {
  const sender = client();
  const peer = client();
  await Promise.all([waitForEvent(sender, "connect"), waitForEvent(peer, "connect")]);
  await joinRoom(sender, "guard-room", "sender");
  await joinRoom(peer, "guard-room", "peer");

  // Room spoofing: sender is not a member of the claimed room.
  const spoofError = waitForEvent(sender, "connection:error");
  const spoofLeak = waitForEvent(peer, "draw:stroke-progress");
  sender.emit("draw:stroke-progress", { roomId: "other-room", data: { strokeId: "s", points: [0, 0, 1, 1] } });
  const [spoofErr] = await spoofError;
  assert.equal(spoofErr.event, "draw:stroke-progress");
  assert.match(spoofErr.message, /does not belong/);
  await assert.rejects(
    Promise.race([spoofLeak, new Promise((_, reject) => setTimeout(() => reject(new Error("not-leaked")), 120))]),
    /not-leaked/,
  );

  // Malformed: missing strokeId.
  const malformedError = waitForEvent(sender, "connection:error");
  sender.emit("draw:stroke-progress", { roomId: "guard-room", data: { points: [0, 0, 1, 1] } });
  assert.equal((await malformedError)[0].event, "draw:stroke-progress");

  // Oversized: points array beyond the stream cap.
  const oversizedError = waitForEvent(sender, "connection:error");
  sender.emit("draw:stroke-progress", {
    roomId: "guard-room",
    data: { strokeId: "s-big", points: new Array(20002).fill(1) },
  });
  assert.equal((await oversizedError)[0].event, "draw:stroke-progress");
});
