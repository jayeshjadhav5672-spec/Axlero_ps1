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

test("joins, presence, room isolation, and collaboration transport", async () => {
  const roomOneA = client();
  const roomOneB = client();
  const roomTwo = client();
  await Promise.all([waitForEvent(roomOneA, "connect"), waitForEvent(roomOneB, "connect"), waitForEvent(roomTwo, "connect")]);

  roomOneA.emit("room:join", { roomId: "room-one", userId: "a", displayName: "A" });
  await waitForEvent(roomOneA, "room:joined");
  roomOneB.emit("room:join", { roomId: "room-one", userId: "b", displayName: "B" });
  const [presence] = await waitForEvent(roomOneB, "presence:update");
  assert.equal(presence.users.length, 2);
  roomTwo.emit("room:join", { roomId: "room-two", userId: "c" });
  await waitForEvent(roomTwo, "room:joined");

  const canvas = waitForEvent(roomOneB, "canvas:update");
  const roomTwoCanvas = waitForEvent(roomTwo, "canvas:update");
  roomOneA.emit("canvas:update", { roomId: "room-one", data: { shape: "circle" } });
  const [canvasPayload] = await canvas;
  assert.deepEqual(canvasPayload.data, { shape: "circle" });
  await assert.rejects(Promise.race([roomTwoCanvas, new Promise((_, reject) => setTimeout(() => reject(new Error("isolated")), 100))]), /isolated/);

  const code = waitForEvent(roomOneB, "code:update");
  roomOneA.emit("code:update", { roomId: "room-one", data: "const value = 1" });
  assert.equal((await code)[0].data, "const value = 1");
  const cursor = waitForEvent(roomOneB, "cursor:update");
  roomOneA.emit("cursor:update", { roomId: "room-one", data: { line: 4 } });
  assert.deepEqual((await cursor)[0].data, { line: 4 });
});

test("rejects malformed payloads and room spoofing without crashing", async () => {
  const socket = client();
  await waitForEvent(socket, "connect");
  const invalidJoin = waitForEvent(socket, "connection:error");
  socket.emit("room:join", { roomId: "bad room" });
  assert.equal((await invalidJoin)[0].event, "room:join");

  socket.emit("room:join", { roomId: "room-two" });
  await waitForEvent(socket, "room:joined");
  const spoofed = waitForEvent(socket, "connection:error");
  socket.emit("canvas:update", { roomId: "room-one", data: { shape: "square" } });
  assert.match((await spoofed)[0].message, /does not belong/);
});

test("leave and disconnect remove users from presence", async () => {
  const first = client();
  const second = client();
  const observer = client();

  await Promise.all([
    waitForEvent(first, "connect"),
    waitForEvent(second, "connect"),
    waitForEvent(observer, "connect"),
  ]);

  // First joins
  const firstJoined = waitForEvent(first, "room:joined");

  first.emit("room:join", {
    roomId: "cleanup",
    userId: "first",
  });

  await firstJoined;

  // Second joins
  const secondJoined = waitForEvent(second, "room:joined");
  const secondPresence = waitForEvent(second, "presence:update");

  second.emit("room:join", {
    roomId: "cleanup",
    userId: "second",
  });

  await secondJoined;
  await secondPresence;

  // Observer joins
  const observerJoined = waitForEvent(observer, "room:joined");

  observer.emit("room:join", {
    roomId: "cleanup",
    userId: "observer",
  });

  await observerJoined;

  // First leaves
  const afterLeave = waitForEvent(observer, "presence:update");

  first.emit("room:leave", {
    roomId: "cleanup",
  });

  const [leavePayload] = await afterLeave;

  assert.equal(leavePayload.users.length, 2);

  // Second disconnects
  const afterDisconnect = waitForEvent(observer, "presence:update");

  second.disconnect();

  const [disconnectPayload] = await afterDisconnect;

  assert.equal(disconnectPayload.users.length, 1);
});

test("rejoining the same room is idempotent", async () => {
  const socket = client();
  await waitForEvent(socket, "connect");
  socket.emit("room:join", { roomId: "reconnect-safe", userId: "same" });
  await waitForEvent(socket, "room:joined");
  socket.emit("room:join", { roomId: "reconnect-safe", userId: "same" });
  const [joined] = await waitForEvent(socket, "room:joined");
  assert.equal(joined.presence.length, 1);
});
