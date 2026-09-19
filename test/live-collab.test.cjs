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

async function pairIn(roomId) {
  const drawer = client();
  const peer = client();
  await Promise.all([waitForEvent(drawer, "connect"), waitForEvent(peer, "connect")]);
  await joinRoom(drawer, roomId, "drawer");
  await joinRoom(peer, roomId, "peer");
  return { drawer, peer };
}

test("shape:preview-progress streams creation drafts to peers, cancel settles", async () => {
  const { drawer, peer } = await pairIn("preview-room");
  const onPeer = waitForEvent(peer, "shape:preview-progress");
  const selfEcho = waitForEvent(drawer, "shape:preview-progress");
  const shape = { id: "shape-r1", type: "rectangle", x: 10, y: 20, width: 100, height: 50 };
  drawer.emit("shape:preview-progress", { roomId: "preview-room", data: { draftId: "shape-r1", shape } });

  const [payload] = await onPeer;
  assert.equal(payload.roomId, "preview-room");
  assert.deepEqual(payload.data.shape, shape);
  assert.equal(typeof payload.socketId, "string");
  await assert.rejects(
    Promise.race([selfEcho, new Promise((_, reject) => setTimeout(() => reject(new Error("no-echo")), 120))]),
    /no-echo/,
  );

  const cancelled = waitForEvent(peer, "shape:preview-cancel");
  drawer.emit("shape:preview-cancel", { roomId: "preview-room", data: { draftId: "shape-r1" } });
  assert.equal((await cancelled)[0].data.draftId, "shape-r1");
});

test("committed mutation channels relay (commit/delete/batch/clear/history)", async () => {
  const { drawer, peer } = await pairIn("commit-room");
  const cases = [
    ["shapes:commit", { shape: { id: "s1", type: "circle" } }],
    ["shapes:commit", { shapes: [{ id: "s2", type: "rect" }, { id: "s3", type: "rect" }] }],
    ["shapes:delete", { shapeIds: ["s1", "s2"] }],
    ["shapes:update-batch", { shapes: [{ id: "s1", x: 5 }] }],
    ["canvas:clear", {}],
    ["canvas:history-sync", { shapes: [{ id: "s1" }] }],
  ];
  for (const [event, data] of cases) {
    const received = waitForEvent(peer, event);
    drawer.emit(event, { roomId: "commit-room", data });
    const [payload] = await received;
    assert.equal(payload.roomId, "commit-room");
    assert.deepEqual(payload.data, data);
  }
});

test("cursor:move and eraser:trail stream ephemerally with isolation", async () => {
  const drawer = client();
  const peer = client();
  const outsider = client();
  await Promise.all([
    waitForEvent(drawer, "connect"),
    waitForEvent(peer, "connect"),
    waitForEvent(outsider, "connect"),
  ]);
  await joinRoom(drawer, "live-a", "drawer");
  await joinRoom(peer, "live-a", "peer");
  await joinRoom(outsider, "live-b", "outsider");

  const cursor = waitForEvent(peer, "cursor:move");
  const leakedCursor = waitForEvent(outsider, "cursor:move");
  drawer.emit("cursor:move", { roomId: "live-a", data: { x: 11, y: 22, user: "Drawer", tool: "pen" } });
  assert.deepEqual((await cursor)[0].data, { x: 11, y: 22, user: "Drawer", tool: "pen" });
  await assert.rejects(
    Promise.race([leakedCursor, new Promise((_, reject) => setTimeout(() => reject(new Error("isolated")), 120))]),
    /isolated/,
  );

  const trail = waitForEvent(peer, "eraser:trail");
  drawer.emit("eraser:trail", { roomId: "live-a", data: { eraserId: "e1", points: [0, 0, 9, 9] } });
  assert.deepEqual((await trail)[0].data.points, [0, 0, 9, 9]);
});

test("unified channels reject spoofing and malformed payloads", async () => {
  const sender = client();
  const peer = client();
  await Promise.all([waitForEvent(sender, "connect"), waitForEvent(peer, "connect")]);
  await joinRoom(sender, "guard-live", "sender");
  await joinRoom(peer, "guard-live", "peer");

  // Room spoofing on a unified channel.
  const spoofError = waitForEvent(sender, "connection:error");
  const spoofLeak = waitForEvent(peer, "shapes:commit");
  sender.emit("shapes:commit", { roomId: "other-room", data: { shape: { id: "s9" } } });
  const [spoofErr] = await spoofError;
  assert.equal(spoofErr.event, "shapes:commit");
  assert.match(spoofErr.message, /does not belong/);
  await assert.rejects(
    Promise.race([spoofLeak, new Promise((_, reject) => setTimeout(() => reject(new Error("not-leaked")), 120))]),
    /not-leaked/,
  );

  // Malformed per class.
  for (const [event, data] of [
    ["shape:preview-progress", { draftId: "d" }],
    ["shape:preview-cancel", {}],
    ["cursor:move", { x: 1 }],
    ["eraser:trail", { eraserId: "e", points: new Array(5001).fill(0) }],
    ["shapes:delete", { shapeIds: [] }],
    ["shapes:update-batch", { shapes: [{ noId: true }] }],
    ["canvas:history-sync", { shapes: "nope" }],
  ]) {
    const err = waitForEvent(sender, "connection:error");
    sender.emit(event, { roomId: "guard-live", data });
    assert.equal((await err)[0].event, event);
  }
});

test("collab:selection relays peer highlights with isolation and spoof rejection", async () => {
  const a = client();
  const b = client();
  const outsider = client();
  await Promise.all([
    waitForEvent(a, "connect"),
    waitForEvent(b, "connect"),
    waitForEvent(outsider, "connect"),
  ]);
  await joinRoom(a, "sel-room", "anna");
  await joinRoom(b, "sel-room", "bob");
  await joinRoom(outsider, "sel-other", "zed");

  const onB = waitForEvent(b, "collab:selection");
  const leaked = waitForEvent(outsider, "collab:selection");
  a.emit("collab:selection", {
    roomId: "sel-room",
    data: { userId: "anna", userName: "Anna", color: "#111111", shapeIds: ["s1"] },
  });
  const [payload] = await onB;
  assert.equal(payload.roomId, "sel-room");
  assert.deepEqual(payload.data.shapeIds, ["s1"]);
  assert.equal(typeof payload.socketId, "string");
  await assert.rejects(
    Promise.race([leaked, new Promise((_, reject) => setTimeout(() => reject(new Error("isolated")), 120))]),
    /isolated/,
  );

  // Spoofing + malformed selection payloads are rejected loudly.
  const spoofError = waitForEvent(a, "connection:error");
  a.emit("collab:selection", { roomId: "nope-room", data: { shapeIds: ["s1"] } });
  assert.equal((await spoofError)[0].event, "collab:selection");
  const badError = waitForEvent(a, "connection:error");
  a.emit("collab:selection", { roomId: "sel-room", data: { shapeIds: "s1" } });
  assert.equal((await badError)[0].event, "collab:selection");
});

test("viewport-sync and tool-sync mirror with isolation and guards", async () => {
  const a = client();
  const b = client();
  await Promise.all([waitForEvent(a, "connect"), waitForEvent(b, "connect")]);
  await joinRoom(a, "mirror-room", "anna");
  await joinRoom(b, "mirror-room", "bob");

  const viewport = waitForEvent(b, "canvas:viewport-sync");
  a.emit("canvas:viewport-sync", { roomId: "mirror-room", data: { stagePos: { x: 11, y: 22 }, scale: 1.5 } });
  const [vpayload] = await viewport;
  assert.deepEqual(vpayload.data, { stagePos: { x: 11, y: 22 }, scale: 1.5 });

  const tool = waitForEvent(b, "collab:tool-sync");
  a.emit("collab:tool-sync", { roomId: "mirror-room", data: { tool: "eraser" } });
  assert.deepEqual((await tool)[0].data, { tool: "eraser" });

  // Malformed viewport/tool payloads are rejected loudly.
  const badVp = waitForEvent(a, "connection:error");
  a.emit("canvas:viewport-sync", { roomId: "mirror-room", data: { scale: -2 } });
  assert.equal((await badVp)[0].event, "canvas:viewport-sync");
  const badTool = waitForEvent(a, "connection:error");
  a.emit("collab:tool-sync", { roomId: "mirror-room", data: { tool: 42 } });
  assert.equal((await badTool)[0].event, "collab:tool-sync");
});

test("oversized string fields are rejected with connection:error", async () => {
  const a = client();
  const b = client();
  await Promise.all([waitForEvent(a, "connect"), waitForEvent(b, "connect")]);
  await joinRoom(a, "caps-room", "anna");
  await joinRoom(b, "caps-room", "bob");

  // Peer must not receive the oversized packets; sender gets loud errors.
  const leakedCursor = waitForEvent(b, "cursor:move");
  const cursorErr = waitForEvent(a, "connection:error");
  a.emit("cursor:move", { roomId: "caps-room", data: { x: 1, y: 2, tool: "t".repeat(33) } });
  assert.equal((await cursorErr)[0].event, "cursor:move");
  const cursorErr2 = waitForEvent(a, "connection:error");
  a.emit("cursor:move", { roomId: "caps-room", data: { x: 1, y: 2, user: "u".repeat(129) } });
  assert.equal((await cursorErr2)[0].event, "cursor:move");
  await assert.rejects(
    Promise.race([leakedCursor, new Promise((_, reject) => setTimeout(() => reject(new Error("isolated")), 120))]),
    /isolated/,
  );

  const leakedSel = waitForEvent(b, "collab:selection");
  const selErr = waitForEvent(a, "connection:error");
  a.emit("collab:selection", { roomId: "caps-room", data: { shapeIds: [], userName: "n".repeat(129) } });
  assert.equal((await selErr)[0].event, "collab:selection");
  const selErr2 = waitForEvent(a, "connection:error");
  a.emit("collab:selection", { roomId: "caps-room", data: { shapeIds: [], color: "c".repeat(65) } });
  assert.equal((await selErr2)[0].event, "collab:selection");
  await assert.rejects(
    Promise.race([leakedSel, new Promise((_, reject) => setTimeout(() => reject(new Error("isolated")), 120))]),
    /isolated/,
  );
});
