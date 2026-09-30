/**
 * project-hardening.test.cjs — shared-project correctness invariants.
 *
 * Covers review blockers for the collaborative project/files feature:
 * - per-file revisions can never regress the authoritative snapshot
 *   (stale revs keep the newest state; ties stay arrival-LWW),
 * - legacy code:update without fileId still maps to the shared document,
 * - unknown fileIds are dropped (never relayed, never snapshotted),
 * - project rooms are isolated,
 * - duplicate creates / rename conflicts fail loudly with first-wins,
 * - recursive folder delete drops the subtree,
 * - the default Collaborative Code document cannot be renamed/deleted,
 * - project capacity (MAX_ROOMS live rooms) is enforced loudly while live
 *   rooms are never evicted and idle rooms may be.
 */
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { after, before, test } = require("node:test");
const { io: connect } = require("socket.io-client");
const {
  createSocketServer,
  DEFAULT_FILE_ID,
  MAX_ROOMS,
} = require("../server/socket.cjs");

let httpServer;
let port;
let sockets = [];

function waitForEvent(socket, event) {
  return once(socket, event);
}

async function expectNoEvent(socket, event, ms = 200) {
  await assert.rejects(
    Promise.race([
      once(socket, event),
      new Promise((_, reject) => setTimeout(() => reject(new Error("unexpected-event")), ms)),
    ]),
    /unexpected-event/,
  );
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

async function join(socket, roomId, userId) {
  const joined = waitForEvent(socket, "room:joined");
  const state = waitForEvent(socket, "project:state");
  socket.emit("room:join", { roomId, userId });
  await joined;
  const [snapshot] = await state;
  return snapshot;
}

async function createNode(socket, roomId, node) {
  const ack = waitForEvent(socket, "project:node-created");
  socket.emit("project:create-node", { roomId, data: { node } });
  const [payload] = await ack;
  return payload;
}

async function joinState(roomId, userId) {
  const socket = client();
  await waitForEvent(socket, "connect");
  const snapshot = await join(socket, roomId, userId);
  return { socket, snapshot };
}

test("stale rev cannot regress the snapshot; late joiner gets the newest", async () => {
  const roomId = "hard-rev";
  const a = client();
  await waitForEvent(a, "connect");
  await join(a, roomId, "a");
  await createNode(a, roomId, { id: "hard-f1", name: "f1.js", type: "file", parentId: null });
  a.emit("code:update", { roomId, data: { fileId: "hard-f1", text: "v1", rev: 1 } });
  a.emit("code:update", { roomId, data: { fileId: "hard-f1", text: "v2", rev: 2 } });
  // Stale arrival must not regress the authoritative state.
  a.emit("code:update", { roomId, data: { fileId: "hard-f1", text: "STALE", rev: 1 } });
  const { snapshot } = await joinState(roomId, "late");
  assert.deepEqual(snapshot.data.files["hard-f1"], { text: "v2", rev: 2 });
});

test("same-rev tie stays arrival-LWW without rev regression", async () => {
  const roomId = "hard-tie";
  const a = client();
  await waitForEvent(a, "connect");
  await join(a, roomId, "a");
  await createNode(a, roomId, { id: "hard-t1", name: "t.js", type: "file", parentId: null });
  a.emit("code:update", { roomId, data: { fileId: "hard-t1", text: "first", rev: 3 } });
  a.emit("code:update", { roomId, data: { fileId: "hard-t1", text: "second", rev: 3 } });
  const { snapshot } = await joinState(roomId, "late");
  assert.equal(snapshot.data.files["hard-t1"].rev, 3);
  assert.equal(snapshot.data.files["hard-t1"].text, "second");
});

test("legacy code:update without fileId maps to the shared document", async () => {
  const roomId = "hard-legacy";
  const a = client();
  await waitForEvent(a, "connect");
  await join(a, roomId, "a");
  a.emit("code:update", { roomId, data: { text: "legacy-text" } });
  const { snapshot } = await joinState(roomId, "late");
  assert.equal(snapshot.data.files[DEFAULT_FILE_ID].text, "legacy-text");
});

test("unknown fileId updates are dropped: never relayed, never snapshotted", async () => {
  const roomId = "hard-unknown";
  const a = client();
  const b = client();
  await waitForEvent(a, "connect");
  await waitForEvent(b, "connect");
  await join(a, roomId, "a");
  await join(b, roomId, "b");
  // Control: a valid op flows A -> B, proving the channel works.
  await createNode(a, roomId, { id: "hard-ok", name: "ok.js", type: "file", parentId: null });
  const relayed = waitForEvent(b, "code:update");
  a.emit("code:update", { roomId, data: { fileId: "hard-ok", text: "hi", rev: 1 } });
  await relayed;
  // Injection attempt: unknown fileId must reach nobody...
  const leaked = waitForEvent(b, "code:update");
  a.emit("code:update", { roomId, data: { fileId: "nope-1", text: "evil()", rev: 99 } });
  await assert.rejects(
    Promise.race([
      leaked,
      new Promise((_, reject) => setTimeout(() => reject(new Error("unexpected-event")), 300)),
    ]),
    /unexpected-event/,
  );
  // ...and must not enter the authoritative snapshot.
  const { snapshot } = await joinState(roomId, "late");
  assert.ok(!("nope-1" in snapshot.data.files));
});

test("project rooms are isolated", async () => {
  const a = client();
  const b = client();
  await waitForEvent(a, "connect");
  await waitForEvent(b, "connect");
  const snapA = await join(a, "hard-iso1", "a");
  await createNode(a, "hard-iso1", { id: "hard-iso-f", name: "iso.js", type: "file", parentId: null });
  const snapB = await join(b, "hard-iso2", "b");
  assert.ok(!snapB.data.nodes.some((n) => n.id === "hard-iso-f"));
  assert.ok(snapA.data.nodes.some((n) => n.id === DEFAULT_FILE_ID));
  b.emit("code:update", { roomId: "hard-iso2", data: { text: "other-room" } });
  await expectNoEvent(a, "code:update", 250);
});

test("duplicate same-name creates: first wins, loser rejected loudly", async () => {
  const roomId = "hard-dup";
  const a = client();
  const b = client();
  await waitForEvent(a, "connect");
  await waitForEvent(b, "connect");
  await join(a, roomId, "a");
  await join(b, roomId, "b");
  // Note: node-created fans out to the whole room, so each success lands
  // on BOTH sockets; count distinct created ids, not listener hits.
  const createdIds = new Set();
  let errors = 0;
  const onAck = (payload) => {
    if (payload && payload.data && payload.data.node) createdIds.add(payload.data.node.id);
  };
  const onErr = (payload) => {
    if (payload && payload.event === "project:create-node") errors += 1;
  };
  a.on("project:node-created", onAck);
  b.on("project:node-created", onAck);
  a.on("connection:error", onErr);
  b.on("connection:error", onErr);
  a.emit("project:create-node", { roomId, data: { node: { id: "dup-a", name: "dup.js", type: "file", parentId: null } } });
  b.emit("project:create-node", { roomId, data: { node: { id: "dup-b", name: "dup.js", type: "file", parentId: null } } });
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      if (createdIds.size >= 1 && errors >= 1) {
        clearInterval(timer);
        resolve();
      }
    }, 25);
    setTimeout(() => {
      clearInterval(timer);
      resolve();
    }, 5000);
  });
  assert.equal(createdIds.size, 1);
  assert.equal(errors, 1);
  a.off("project:node-created", onAck);
  b.off("project:node-created", onAck);
  a.off("connection:error", onErr);
  b.off("connection:error", onErr);
  const { snapshot } = await joinState(roomId, "late");
  assert.equal(snapshot.data.nodes.filter((n) => n.name === "dup.js").length, 1);
});

test("rename conflict and default-doc protection fail loudly", async () => {
  const roomId = "hard-rename";
  const a = client();
  await waitForEvent(a, "connect");
  await join(a, roomId, "a");
  await createNode(a, roomId, { id: "hard-r1", name: "one.js", type: "file", parentId: null });
  await createNode(a, roomId, { id: "hard-r2", name: "two.js", type: "file", parentId: null });
  const err = waitForEvent(a, "connection:error");
  a.emit("project:rename-node", { roomId, data: { node: { id: "hard-r2", name: "one.js" } } });
  const [conflict] = await err;
  assert.equal(conflict.event, "project:rename-node");
  const errDefault = waitForEvent(a, "connection:error");
  a.emit("project:rename-node", { roomId, data: { node: { id: DEFAULT_FILE_ID, name: "x.js" } } });
  const [defErr] = await errDefault;
  assert.equal(defErr.event, "project:rename-node");
  const errDelete = waitForEvent(a, "connection:error");
  a.emit("project:delete-node", { roomId, data: { nodeId: DEFAULT_FILE_ID } });
  const [delErr] = await errDelete;
  assert.equal(delErr.event, "project:delete-node");
  const { snapshot } = await joinState(roomId, "late");
  assert.ok(snapshot.data.nodes.some((n) => n.id === DEFAULT_FILE_ID));
  assert.ok(snapshot.data.nodes.some((n) => n.id === "hard-r2" && n.name === "two.js"));
});

test("recursive folder delete drops the subtree from tree and texts", async () => {
  const roomId = "hard-del";
  const a = client();
  await waitForEvent(a, "connect");
  await join(a, roomId, "a");
  await createNode(a, roomId, { id: "hard-dir", name: "dir", type: "folder", parentId: null });
  await createNode(a, roomId, { id: "hard-nested", name: "n.js", type: "file", parentId: "hard-dir" });
  a.emit("code:update", { roomId, data: { fileId: "hard-nested", text: "nested", rev: 1 } });
  const deleted = waitForEvent(a, "project:nodes-deleted");
  a.emit("project:delete-node", { roomId, data: { nodeId: "hard-dir" } });
  const [payload] = await deleted;
  assert.ok(payload.data.deletedIds.includes("hard-dir"));
  assert.ok(payload.data.deletedIds.includes("hard-nested"));
  const { snapshot } = await joinState(roomId, "late");
  assert.ok(!snapshot.data.nodes.some((n) => n.id === "hard-dir" || n.id === "hard-nested"));
  assert.ok(!("hard-nested" in snapshot.data.files));
});

test("project capacity: live rooms never evicted, full rooms fail loudly, idle evicted", async () => {
  const srv = http.createServer();
  const { io, roomPresence, getRoomProject, freeProjectCapacity } = createSocketServer(srv);
  try {
    assert.equal(typeof getRoomProject, "function");
    assert.equal(typeof freeProjectCapacity, "function");
    for (let i = 0; i < MAX_ROOMS; i += 1) {
      roomPresence.set(`cap-live-${i}`, [{ socketId: `s-${i}`, userId: `u-${i}`, displayName: `U${i}` }]);
      getRoomProject(`cap-live-${i}`);
    }
    const first = getRoomProject("cap-live-0");
    assert.equal(getRoomProject("cap-live-0"), first);
    assert.throws(() => getRoomProject("cap-room-new"), (err) => {
      assert.equal(err.code, "ROOM_CAPACITY_EXHAUSTED");
      return true;
    });
    roomPresence.delete("cap-live-0");
    const created = getRoomProject("cap-room-new");
    assert.ok(created);
    assert.equal(getRoomProject("cap-live-1"), getRoomProject("cap-live-1"));
  } finally {
    io.close();
    await new Promise((resolve) => srv.close(resolve));
  }
});
