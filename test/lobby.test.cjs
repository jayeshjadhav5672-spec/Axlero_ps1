const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { after, before, test } = require("node:test");
const { io: connect } = require("socket.io-client");
const { createSocketServer, isLobbyRoom } = require("../server/socket.cjs");
const { signToken } = require("../server/auth.cjs");

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

function client(authToken) {
  const socket = connect(`http://localhost:${port}`, {
    forceNew: true,
    auth: authToken ? { token: authToken } : {},
  });
  sockets.push(socket);
  return socket;
}

function tokenFor(role, name) {
  // signToken only signs — no database needed for the socket handshake.
  return signToken({ _id: `${role}-${name}`, name, username: null, role });
}

test("isLobbyRoom scopes the rule to lobby- rooms only", () => {
  assert.equal(isLobbyRoom("lobby-physics"), true);
  assert.equal(isLobbyRoom("lobby"), false);
  assert.equal(isLobbyRoom("room-one"), false);
  assert.equal(isLobbyRoom(""), false);
  assert.equal(isLobbyRoom(null), false);
});

test("regular rooms still allow more than two occupants", async () => {
  const room = "regular-room-capacity-check";
  const members = [client(), client(), client()];
  await Promise.all(members.map((socket) => waitForEvent(socket, "connect")));
  // The room:joined snapshot carries the presence list, so no broadcast
  // race: each join's ack shows the room growing past the lobby limit.
  let lastPresence = null;
  for (const [index, socket] of members.entries()) {
    const joined = waitForEvent(socket, "room:joined");
    socket.emit("room:join", { roomId: room, userId: `guest-${index}`, displayName: `Guest ${index}` });
    const [payload] = await joined;
    lastPresence = payload.presence;
  }
  assert.equal(lastPresence.length, 3);
});

test("lobby rejects a third joiner with LOBBY_FULL", async () => {
  const room = "lobby-capacity-check";
  const first = client();
  const second = client();
  const third = client();
  await Promise.all([
    waitForEvent(first, "connect"),
    waitForEvent(second, "connect"),
    waitForEvent(third, "connect"),
  ]);

  first.emit("room:join", { roomId: room, userId: "a", displayName: "A" });
  await waitForEvent(first, "room:joined");
  second.emit("room:join", { roomId: room, userId: "b", displayName: "B" });
  await waitForEvent(second, "room:joined");

  const rejected = waitForEvent(third, "connection:error");
  third.emit("room:join", { roomId: room, userId: "c", displayName: "C" });
  const [error] = await rejected;
  assert.equal(error.event, "room:join");
  assert.equal(error.code, "LOBBY_FULL");
  assert.equal(error.message, "Lobby is full. Only one instructor and one student can join.");
});

test("lobby rejects a duplicate role via the authenticated identity", async () => {
  const room = "lobby-role-check";
  const instructorOne = client(tokenFor("instructor", "Prof A"));
  const instructorTwo = client(tokenFor("instructor", "Prof B"));
  const student = client(tokenFor("student", "Sam"));
  await Promise.all([
    waitForEvent(instructorOne, "connect"),
    waitForEvent(instructorTwo, "connect"),
    waitForEvent(student, "connect"),
  ]);

  instructorOne.emit("room:join", { roomId: room });
  const [joined] = await waitForEvent(instructorOne, "room:joined");
  // Authenticated identity wins over the (absent) client payload.
  assert.equal(joined.presence[0].role, "instructor");

  const rejected = waitForEvent(instructorTwo, "connection:error");
  // A spoofed client role field must not bypass the check — the server
  // reads socket.user.role, so this join is still an instructor join.
  instructorTwo.emit("room:join", { roomId: room, role: "student" });
  const [error] = await rejected;
  assert.equal(error.code, "LOBBY_FULL");

  // One instructor + one student is the valid lobby.
  const updated = waitForEvent(instructorOne, "presence:update");
  student.emit("room:join", { roomId: room });
  await waitForEvent(student, "room:joined");
  const [presence] = await updated;
  assert.equal(presence.users.length, 2);
});
