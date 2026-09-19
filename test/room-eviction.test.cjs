const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { after, before, describe, test } = require("node:test");
const { io: connect } = require("socket.io-client");
const { createSocketServer, MAX_ROOMS } = require("../server/socket.cjs");

function makeHarness() {
  const harness = { httpServer: null, port: 0, sockets: [] };
  harness.waitForEvent = (socket, event) => once(socket, event);
  harness.client = () => {
    const socket = connect(`http://localhost:${harness.port}`, { forceNew: true });
    harness.sockets.push(socket);
    return socket;
  };
  harness.join = async (socket, roomId, userId) => {
    socket.emit("room:join", { roomId, userId });
    await harness.waitForEvent(socket, "room:joined");
  };
  harness.tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
  return harness;
}

describe("room-state capacity: live rooms are never evicted", () => {
  const h = makeHarness();
  let roomState;
  let roomPresence;

  before(async () => {
    h.httpServer = http.createServer();
    ({ roomState, roomPresence } = createSocketServer(h.httpServer));
    h.httpServer.listen(0);
    await once(h.httpServer, "listening");
    h.port = h.httpServer.address().port;
  });

  after(async () => {
    for (const socket of h.sockets) socket.disconnect();
    await new Promise((resolve) => h.httpServer.close(resolve));
  });

  test("overflow mutation is rejected, live snapshots intact, no relay", async () => {
    // Two genuinely live rooms with real snapshots.
    const a1 = h.client();
    await h.waitForEvent(a1, "connect");
    await h.join(a1, "live-room-a", "a1");
    a1.emit("shapes:commit", { roomId: "live-room-a", data: { shapes: [{ id: "keep-a" }] } });
    await h.tick();

    const b1 = h.client();
    await h.waitForEvent(b1, "connect");
    await h.join(b1, "live-room-b", "b1");
    b1.emit("shapes:commit", { roomId: "live-room-b", data: { shapes: [{ id: "keep-b" }] } });
    await h.tick();

    // Top up to capacity with simulated live rooms (live presence, no
    // snapshots of their own beyond one marker shape).
    let i = 0;
    while (roomState.size < MAX_ROOMS) {
      const id = `filled-live-${i++}`;
      roomState.set(id, { shapes: [{ id: `marker-${id}` }], updatedAt: Date.now() });
      roomPresence.set(id, [{ socketId: `sock-${id}`, userId: `u-${id}`, displayName: id, roomId: id }]);
    }
    assert.equal(roomState.size, MAX_ROOMS);
    const keysBefore = new Set(roomState.keys());

    // A new room's mutation needs another entry: must be rejected.
    const c1 = h.client();
    await h.waitForEvent(c1, "connect");
    await h.join(c1, "overflow-room", "c1");
    const peer = h.client();
    await h.waitForEvent(peer, "connect");
    await h.join(peer, "overflow-room", "peer");

    const err = h.waitForEvent(c1, "connection:error");
    let relayed = false;
    peer.on("shapes:commit", () => {
      relayed = true;
    });
    c1.emit("shapes:commit", { roomId: "overflow-room", data: { shapes: [{ id: "nope" }] } });
    const [errPayload] = await err;
    assert.equal(errPayload.event, "shapes:commit");
    assert.equal(errPayload.code, "ROOM_CAPACITY_EXHAUSTED");
    await h.tick(100);
    assert.equal(relayed, false, "rejected mutation must not relay to peers");

    // No live room evicted; capacity unchanged; no overflow entry.
    assert.equal(roomState.size, MAX_ROOMS);
    for (const key of keysBefore) assert.ok(roomState.has(key), `live room evicted: ${key}`);
    assert.ok(!roomState.has("overflow-room"));

    // Live snapshot intact (late joiner converges on stored shapes).
    const late = h.client();
    await h.waitForEvent(late, "connect");
    const syncInit = h.waitForEvent(late, "canvas:sync-init");
    late.emit("room:join", { roomId: "live-room-a", userId: "late" });
    await h.waitForEvent(late, "room:joined");
    assert.deepEqual((await syncInit)[0].shapes.map((s) => s.id), ["keep-a"]);

    // Existing live rooms keep functioning: commit relays and stores.
    const aRelay = h.waitForEvent(a1, "shapes:commit");
    const a2 = h.client();
    await h.waitForEvent(a2, "connect");
    await h.join(a2, "live-room-a", "a2");
    a2.emit("shapes:commit", { roomId: "live-room-a", data: { shapes: [{ id: "keep-a2" }] } });
    const [relayPayload] = await aRelay;
    assert.equal(relayPayload.roomId, "live-room-a");
    const late2 = h.client();
    await h.waitForEvent(late2, "connect");
    const syncInit2 = h.waitForEvent(late2, "canvas:sync-init");
    late2.emit("room:join", { roomId: "live-room-a", userId: "late2" });
    await h.waitForEvent(late2, "room:joined");
    assert.deepEqual((await syncInit2)[0].shapes.map((s) => s.id).sort(), ["keep-a", "keep-a2"].sort());
  });
});

describe("room-state capacity: idle rooms are evicted first", () => {
  const h = makeHarness();
  let roomState;

  before(async () => {
    h.httpServer = http.createServer();
    ({ roomState } = createSocketServer(h.httpServer));
    h.httpServer.listen(0);
    await once(h.httpServer, "listening");
    h.port = h.httpServer.address().port;
  });

  after(async () => {
    for (const socket of h.sockets) socket.disconnect();
    await new Promise((resolve) => h.httpServer.close(resolve));
  });

  test("stale idle entry is evicted to make room for a live mutation", async () => {
    // Fill to capacity with idle entries (snapshots, zero presence).
    for (let i = 0; roomState.size < MAX_ROOMS; i++) {
      roomState.set(`idle-${i}`, { shapes: [{ id: `old-${i}` }], updatedAt: Date.now() });
    }
    assert.equal(roomState.size, MAX_ROOMS);

    // A live mutation in a fresh room evicts the oldest idle entry.
    const drawer = h.client();
    await h.waitForEvent(drawer, "connect");
    await h.join(drawer, "fresh-room", "drawer");
    let errored = false;
    drawer.on("connection:error", () => {
      errored = true;
    });
    drawer.emit("shapes:commit", { roomId: "fresh-room", data: { shapes: [{ id: "fresh-1" }] } });
    await h.tick(100);
    assert.equal(errored, false, "idle capacity must not raise connection:error");
    assert.equal(roomState.size, MAX_ROOMS);
    assert.ok(!roomState.has("idle-0"), "oldest idle room should be evicted");
    assert.deepEqual(roomState.get("fresh-room").shapes.map((s) => s.id), ["fresh-1"]);

    // Late joiner converges on the fresh snapshot.
    const late = h.client();
    await h.waitForEvent(late, "connect");
    const syncInit = h.waitForEvent(late, "canvas:sync-init");
    late.emit("room:join", { roomId: "fresh-room", userId: "late" });
    await h.waitForEvent(late, "room:joined");
    assert.deepEqual((await syncInit)[0].shapes.map((s) => s.id), ["fresh-1"]);
  });
});
