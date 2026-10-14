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

test("switching rooms leaves previous room transport and presence", async () => {
  const mover = client();
  const stayer = client();
  const otherRoom = client();
  await Promise.all([
    waitForEvent(mover, "connect"),
    waitForEvent(stayer, "connect"),
    waitForEvent(otherRoom, "connect"),
  ]);

  mover.emit("room:join", { roomId: "switch-a", userId: "mover" });
  await waitForEvent(mover, "room:joined");
  stayer.emit("room:join", { roomId: "switch-a", userId: "stayer" });
  await waitForEvent(stayer, "presence:update");
  otherRoom.emit("room:join", { roomId: "switch-b", userId: "other" });
  await waitForEvent(otherRoom, "room:joined");

  // Attach listeners BEFORE the switch so no broadcast is missed.
  const moverJoined = waitForEvent(mover, "room:joined");
  const stayerPresence = waitForEvent(stayer, "presence:update");
  const otherPresence = waitForEvent(otherRoom, "presence:update");

  mover.emit("room:join", { roomId: "switch-b", userId: "mover" });

  const [joined] = await moverJoined;
  assert.equal(joined.roomId, "switch-b");
  assert.equal(joined.presence.length, 2);

  const [stayerPayload] = await stayerPresence;
  assert.equal(stayerPayload.roomId, "switch-a");
  assert.equal(stayerPayload.users.length, 1);
  assert.equal(stayerPayload.users[0].userId, "stayer");

  const [otherPayload] = await otherPresence;
  assert.equal(otherPayload.roomId, "switch-b");
  assert.equal(otherPayload.users.length, 2);

  // Old room traffic must no longer reach the mover (transport-level leave).
  const leakedToMover = waitForEvent(mover, "canvas:update");
  const leakedToOther = waitForEvent(otherRoom, "canvas:update");
  stayer.emit("canvas:update", { roomId: "switch-a", data: { shape: "stale" } });
  await assert.rejects(
    Promise.race([
      leakedToMover,
      leakedToOther,
      new Promise((_, reject) => setTimeout(() => reject(new Error("isolated")), 120)),
    ]),
    /isolated/
  );

  // New room traffic must reach the mover and existing member, but stay isolated.
  const moverCode = waitForEvent(mover, "code:update");
  const stayerCode = waitForEvent(stayer, "code:update");
  otherRoom.emit("code:update", { roomId: "switch-b", data: "after-switch" });
  const [codePayload] = await moverCode;
  assert.equal(codePayload.data, "after-switch");
  assert.equal(codePayload.roomId, "switch-b");
  await assert.rejects(
    Promise.race([
      stayerCode,
      new Promise((_, reject) => setTimeout(() => reject(new Error("isolated")), 120)),
    ]),
    /isolated/
  );
});

test("code:update rejects a client outside the room and never broadcasts it", async () => {
  const sender = client();
  const peer = client();
  await Promise.all([waitForEvent(sender, "connect"), waitForEvent(peer, "connect")]);

  sender.emit("room:join", { roomId: "code-room", userId: "sender" });
  await waitForEvent(sender, "room:joined");
  peer.emit("room:join", { roomId: "code-room", userId: "peer" });
  await waitForEvent(peer, "room:joined");

  // Peer must not receive the spoofed update; sender must get the error.
  const leakedToPeer = waitForEvent(peer, "code:update");
  const senderError = waitForEvent(sender, "connection:error");
  sender.emit("code:update", { roomId: "different-room", data: "const hacked = true;" });

  const [errPayload] = await senderError;
  assert.equal(errPayload.event, "code:update");
  assert.match(errPayload.message, /does not belong/);

  await assert.rejects(
    Promise.race([
      leakedToPeer,
      new Promise((_, reject) => setTimeout(() => reject(new Error("not-leaked")), 150)),
    ]),
    /not-leaked/,
  );
});

test("handshake JWT attributes presence; invalid token stays anonymous guest", async () => {
  // Exercises the REAL handshake middleware from server/auth/handshake.cjs
  // (the same unit wired in server/index.cjs) — not a test-local copy.
  process.env.JWT_SECRET = "test-only-secret-0123456789abcdef";
  const { signToken, verifyToken } = require("../server/auth/tokens.cjs");
  const { createHandshakeMiddleware } = require("../server/auth/handshake.cjs");
  const srv = http.createServer();
  const { io } = createSocketServer(srv);
  io.use(createHandshakeMiddleware({ verifyToken }));
  srv.listen(0);
  await once(srv, "listening");
  const srvPort = srv.address().port;
  const mk = (auth) => {
    const s = connect(`http://localhost:${srvPort}`, { forceNew: true, auth });
    sockets.push(s);
    return s;
  };
  try {
    const token = signToken({ id: "u-auth", email: "authed@example.com", displayName: "Authed" });
    const authed = mk({ token });
    await waitForEvent(authed, "connect");
    const authedPresence = waitForEvent(authed, "presence:update");
    authed.emit("room:join", { roomId: "auth-room" });
    await waitForEvent(authed, "room:joined");
    const [presence] = await authedPresence;
    const entry = presence.users.find((u) => u.userId === "u-auth");
    assert.ok(entry, "authenticated presence entry attributed to token identity");
    assert.equal(entry.displayName, "Authed");

    const forged = mk({ token: "forged-token" });
    await waitForEvent(forged, "connect");
    const afterForged = waitForEvent(authed, "presence:update");
    forged.emit("room:join", { roomId: "auth-room", userId: "impostor", displayName: "Impostor" });
    await waitForEvent(forged, "room:joined");
    // Invalid token still joins (additive auth), but the fresh roster must
    // not attribute anyone to the victim identity.
    const [fresh] = await afterForged;
    assert.equal(
      fresh.users.filter((u) => u.userId === "u-auth").length,
      1,
      "exactly one entry carries the victim identity (the real owner)",
    );
    assert.ok(
      fresh.users.some((u) => u.displayName === "Impostor" && u.userId !== "u-auth"),
      "forged client appears only under its own self-asserted identity",
    );

    const guest = mk({});
    await waitForEvent(guest, "connect");
    guest.emit("room:join", { roomId: "auth-room" });
    await waitForEvent(guest, "room:joined");

    // An authenticated client passing a different userId cannot impersonate:
    // server-side token identity wins over the self-asserted payload. A
    // second authed socket joins spoofing userId "victim"; the peer-observed
    // roster must still attribute it to the token identity, never "victim".
    const authed2 = mk({ token });
    await waitForEvent(authed2, "connect");
    const peerSeesJoin = waitForEvent(guest, "presence:update");
    authed2.emit("room:join", { roomId: "auth-room", userId: "victim", displayName: "Victim" });
    await waitForEvent(authed2, "room:joined");
    const [respoof] = await peerSeesJoin;
    assert.ok(
      respoof.users.some((u) => u.userId === "u-auth" && u.displayName === "Authed"),
      "token identity attributed despite spoofed payload",
    );
    assert.ok(
      !respoof.users.some((u) => u.userId === "victim"),
      "self-asserted userId cannot override token identity",
    );
  } finally {
    io.close();
    await new Promise((resolve) => srv.close(resolve));
  }
});
