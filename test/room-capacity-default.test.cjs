/**
 * room-capacity-default.test.cjs — default room-capacity contract.
 *
 * Regression test for the CI hang where a hardcoded 2-user room cap made
 * existing multi-user flows await `room:joined` forever (node:test has no
 * default timeout, so the runner never terminated).
 *
 * Contract: createSocketServer() without options imposes NO room capacity
 * (established behavior). A third client joining the same room must receive
 * `room:joined` and appear in presence. Capacity limits are opt-in via
 * { maxRoomCapacity: N } (see test/socket.test.cjs).
 */
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

function client() {
  const socket = connect(`http://localhost:${port}`, { forceNew: true });
  sockets.push(socket);
  return socket;
}

before(async () => {
  httpServer = http.createServer();
  // Intentionally NO maxRoomCapacity: this asserts the default contract.
  createSocketServer(httpServer);
  httpServer.listen(0);
  await once(httpServer, "listening");
  port = httpServer.address().port;
});

after(async () => {
  for (const socket of sockets) socket.disconnect();
  await new Promise((resolve) => httpServer.close(resolve));
});

test("default server allows three users in one room (no implicit capacity)", async () => {
  // Each join ack carries the full presence list; the third join must
  // succeed (under a hardcoded cap it would receive connection:error and
  // this await would hang forever — the CI incident being guarded here).
  const seen = [];
  for (const userId of ["u1", "u2", "u3"]) {
    const socket = client();
    await waitForEvent(socket, "connect");
    const joined = waitForEvent(socket, "room:joined");
    socket.emit("room:join", { roomId: "default-cap-room", userId });
    const [payload] = await joined;
    seen.push(payload.presence.length);
  }
  assert.deepEqual(seen, [1, 2, 3]);
});

test("default server presence reaches 3 after three joins", async () => {
  const seen = [];
  for (const userId of ["w1", "w2", "w3"]) {
    const socket = client();
    await waitForEvent(socket, "connect");
    const joined = waitForEvent(socket, "room:joined");
    socket.emit("room:join", { roomId: "default-cap-room-2", userId });
    const [payload] = await joined;
    seen.push(payload.presence.length);
  }
  assert.deepEqual(seen, [1, 2, 3]);
});
