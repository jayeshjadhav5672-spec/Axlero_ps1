/**
 * code-realtime-acceptance.test.cjs — protocol-level acceptance for the
 * reported "two users don't see code updates" defect.
 *
 * Simulates the exact production scenario over real sockets against the
 * CURRENT server implementation:
 *
 *   A joins room, B joins room (same room, presence shows both)
 *   A emits code:update { fileId, text: 'hello from A', rev, actorId }
 *   B must receive the relay WITHOUT refresh
 *   B appends { text: 'hello from A + hello from B', rev+1 }
 *   A must receive the relay WITHOUT refresh
 *
 * If this passes locally but production fails, the deployed backend is
 * running stale socket code that does not accept/relay the current
 * { fileId, text, rev, actorId } protocol — redeploy the backend.
 */
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { after, before, test } = require("node:test");
const { io: connect } = require("socket.io-client");
const { createSocketServer, DEFAULT_FILE_ID } = require("../server/socket.cjs");

let httpServer;
let port;
const sockets = [];

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

async function join(socket, roomId, userId) {
  const joined = once(socket, "room:joined");
  const presence = once(socket, "presence:update");
  socket.emit("room:join", { roomId, userId });
  await joined;
  await presence;
}

function nextCodeUpdate(socket, ms = 2000) {
  return Promise.race([
    once(socket, "code:update").then(([payload]) => payload),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timed out waiting for code:update relay")), ms),
    ),
  ]);
}

test("A types 'hello from A' — B receives it without refresh", async () => {
  const room = "acceptance-room-1";
  const a = client();
  const b = client();
  await join(a, room, "user-a");
  await join(b, room, "user-b");

  const incoming = nextCodeUpdate(b);
  a.emit("code:update", {
    roomId: room,
    data: { fileId: DEFAULT_FILE_ID, text: "hello from A", rev: 1, actorId: "sock-a" },
  });
  const payload = await incoming;
  assert.equal(payload.roomId, room);
  assert.equal(payload.data.fileId, DEFAULT_FILE_ID);
  assert.equal(payload.data.text, "hello from A");
  assert.equal(payload.data.rev, 1);
});

test("B appends 'hello from B' — A receives it without refresh", async () => {
  const room = "acceptance-room-2";
  const a = client();
  const b = client();
  await join(a, room, "user-a");
  await join(b, room, "user-b");

  // Seed: A writes rev 1, B receives (advances B's side implicitly via relay).
  const first = nextCodeUpdate(b);
  a.emit("code:update", {
    roomId: room,
    data: { fileId: DEFAULT_FILE_ID, text: "hello from A", rev: 1, actorId: "sock-a" },
  });
  await first;

  // B appends on top of rev 1 with rev 2 — A must see it.
  const second = nextCodeUpdate(a);
  b.emit("code:update", {
    roomId: room,
    data: { fileId: DEFAULT_FILE_ID, text: "hello from Ahello from B", rev: 2, actorId: "sock-b" },
  });
  const payload = await second;
  assert.equal(payload.data.text, "hello from Ahello from B");
  assert.equal(payload.data.rev, 2);
});

test("late joiner switching to the same file sees matching content via snapshot", async () => {
  const room = "acceptance-room-3";
  const a = client();
  await join(a, room, "user-a");
  const incoming = nextCodeUpdate(a);
  // Self-echo is sender-excluded; drive content through another writer instead.
  const writer = client();
  await join(writer, room, "writer");
  writer.emit("code:update", {
    roomId: room,
    data: { fileId: DEFAULT_FILE_ID, text: "shared content", rev: 1, actorId: "sock-w" },
  });
  await incoming;

  // Late joiner B receives the snapshot with matching content.
  const b = client();
  const state = once(b, "project:state");
  const joined = once(b, "room:joined");
  b.emit("room:join", { roomId: room, userId: "user-b" });
  await joined;
  const [snapshot] = await state;
  assert.equal(snapshot.data.files[DEFAULT_FILE_ID].text, "shared content");
});
