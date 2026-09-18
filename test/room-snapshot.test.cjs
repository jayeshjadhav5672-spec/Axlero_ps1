const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { after, before, describe, test } = require("node:test");
const { io: connect } = require("socket.io-client");
const { applyRoomMutation, createSocketServer } = require("../server/socket.cjs");

describe("applyRoomMutation (room snapshot reducer)", () => {
  test("commit appends unknown ids and dedupes known ones", () => {
    const prev = [{ id: "a", type: "rect" }];
    const next = applyRoomMutation(prev, "shapes:commit", { shapes: [{ id: "a" }, { id: "b", type: "circle" }] });
    assert.deepEqual(next.map((s) => s.id), ["a", "b"]);
    assert.equal(applyRoomMutation(next, "shapes:commit", { shape: { id: "b" } }), next);
  });

  test("update-batch merges and adopts order on matching id sets", () => {
    const prev = [
      { id: "a", x: 0 },
      { id: "b", x: 0 },
    ];
    const moved = applyRoomMutation(prev, "shapes:update-batch", { shapes: [{ id: "a", x: 5 }] });
    assert.equal(moved.find((s) => s.id === "a").x, 5);
    assert.equal(moved.find((s) => s.id === "b").x, 0);
    const reordered = applyRoomMutation(prev, "shapes:update-batch", {
      shapes: [
        { id: "b", x: 0 },
        { id: "a", x: 0 },
      ],
    });
    assert.deepEqual(reordered.map((s) => s.id), ["b", "a"]);
  });

  test("delete, clear, and history-sync reconcile", () => {
    const prev = [
      { id: "a", type: "rect" },
      { id: "b", type: "rect" },
    ];
    assert.deepEqual(
      applyRoomMutation(prev, "shapes:delete", { shapeIds: ["a"] }).map((s) => s.id),
      ["b"]
    );
    assert.deepEqual(applyRoomMutation(prev, "canvas:clear", {}), []);
    assert.deepEqual(applyRoomMutation(prev, "canvas:history-sync", { shapes: [{ id: "z" }] }), [{ id: "z" }]);
  });

  test("legacy canvas:update ops fold into the snapshot", () => {
    let state = [];
    state = applyRoomMutation(state, "canvas:update", { op: "create", shape: { id: "a" } });
    state = applyRoomMutation(state, "canvas:update", { op: "update", shapeId: "a", changes: { x: 9 } });
    assert.equal(state[0].x, 9);
    state = applyRoomMutation(state, "canvas:update", { op: "delete", shapeId: "a" });
    assert.deepEqual(state, []);
    state = applyRoomMutation([{ id: "a" }], "canvas:update", { op: "clear" });
    assert.deepEqual(state, []);
    state = applyRoomMutation(
      [{ id: "a" }, { id: "b" }],
      "canvas:update",
      { op: "reorder", shapes: [{ id: "b" }, { id: "a" }] }
    );
    assert.deepEqual(state.map((s) => s.id), ["b", "a"]);
  });

  test("unknown events and garbage never mutate (same ref)", () => {
    const prev = [{ id: "a" }];
    assert.equal(applyRoomMutation(prev, "cursor:move", { x: 1, y: 2 }), prev);
    assert.equal(applyRoomMutation(prev, "shape:preview-progress", {}), prev);
    assert.equal(applyRoomMutation(prev, "shapes:delete", { shapeIds: [] }), prev);
    assert.equal(applyRoomMutation(prev, "canvas:update", { op: "nope" }), prev);
  });
});

describe("room snapshots over sockets", () => {
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
    createSocketServer(httpServer);
    httpServer.listen(0);
    await once(httpServer, "listening");
    port = httpServer.address().port;
  });

  after(async () => {
    for (const socket of sockets) socket.disconnect();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  test("late joiner receives the current snapshot via canvas:sync-init", async () => {
    const drawer = client();
    await waitForEvent(drawer, "connect");
    drawer.emit("room:join", { roomId: "snapshot-room", userId: "drawer" });
    await waitForEvent(drawer, "room:joined");

    drawer.emit("shapes:commit", {
      roomId: "snapshot-room",
      data: { shapes: [{ id: "s1", type: "rectangle" }] },
    });
    // Give the server a tick to fold the mutation into the snapshot.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const late = client();
    await waitForEvent(late, "connect");
    const syncInit = waitForEvent(late, "canvas:sync-init");
    late.emit("room:join", { roomId: "snapshot-room", userId: "late" });
    await waitForEvent(late, "room:joined");
    const [snapshot] = await syncInit;
    assert.equal(snapshot.roomId, "snapshot-room");
    assert.deepEqual(snapshot.shapes.map((s) => s.id), ["s1"]);
  });

  test("delete and clear are reflected in later snapshots (no ghosts)", async () => {
    const drawer = client();
    await waitForEvent(drawer, "connect");
    drawer.emit("room:join", { roomId: "ghost-room", userId: "drawer" });
    await waitForEvent(drawer, "room:joined");
    drawer.emit("shapes:commit", {
      roomId: "ghost-room",
      data: { shapes: [{ id: "g1", type: "rect" }, { id: "g2", type: "rect" }] },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    drawer.emit("shapes:delete", { roomId: "ghost-room", data: { shapeIds: ["g1"] } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const late = client();
    await waitForEvent(late, "connect");
    const syncInit = waitForEvent(late, "canvas:sync-init");
    late.emit("room:join", { roomId: "ghost-room", userId: "late" });
    await waitForEvent(late, "room:joined");
    assert.deepEqual((await syncInit)[0].shapes.map((s) => s.id), ["g2"]);

    drawer.emit("canvas:clear", { roomId: "ghost-room", data: {} });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const later = client();
    await waitForEvent(later, "connect");
    const syncInit2 = waitForEvent(later, "canvas:sync-init");
    later.emit("room:join", { roomId: "ghost-room", userId: "later" });
    await waitForEvent(later, "room:joined");
    assert.deepEqual((await syncInit2)[0].shapes, []);
  });

  test("snapshots stay isolated per room", async () => {
    const drawer = client();
    await waitForEvent(drawer, "connect");
    drawer.emit("room:join", { roomId: "iso-snap-a", userId: "drawer" });
    await waitForEvent(drawer, "room:joined");
    drawer.emit("shapes:commit", { roomId: "iso-snap-a", data: { shape: { id: "only-a" } } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const other = client();
    await waitForEvent(other, "connect");
    const syncInit = waitForEvent(other, "canvas:sync-init");
    other.emit("room:join", { roomId: "iso-snap-b", userId: "other" });
    await waitForEvent(other, "room:joined");
    assert.deepEqual((await syncInit)[0].shapes, []);
  });
});
