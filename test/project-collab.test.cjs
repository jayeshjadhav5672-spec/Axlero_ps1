const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { after, before, test } = require("node:test");
const { io: connect } = require("socket.io-client");
const {
  createSocketServer,
  validateProjectNode,
  createEmptyProject,
  projectSnapshot,
  DEFAULT_FILE_ID,
} = require("../server/socket.cjs");

let httpServer;
let port;
let sockets = [];

function waitForEvent(socket, event) {
  return once(socket, event);
}

async function expectNoEvent(socket, event, ms = 150) {
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

function nodeByName(snapshot, name) {
  return snapshot.data.nodes.find((n) => n.name === name);
}

test("server validators: node rules and deterministic duplicates", () => {
  const project = createEmptyProject();
  const node = validateProjectNode({ id: "f1", name: "code.py", type: "file", parentId: null }, project);
  assert.equal(node.name, "code.py");
  project.nodes.set(node.id, node);
  assert.throws(
    () => validateProjectNode({ id: "f2", name: "CODE.PY", type: "file", parentId: null }, project),
    /already exists/,
  );
  assert.throws(() => validateProjectNode({ id: "f3", name: "../x", type: "file", parentId: null }, project), /\//);
  assert.throws(() => validateProjectNode({ id: "f4", name: "nope.js", type: "file", parentId: "missing" }, project), /parent folder/);
  assert.throws(() => validateProjectNode({ id: "f1", name: "other.js", type: "file", parentId: null }, project), /already exists/);
  const snap = projectSnapshot(project);
  assert.ok(snap.nodes.some((n) => n.id === DEFAULT_FILE_ID));
});

test("file and folder creation fan out: ack to creator, broadcast to peers", async () => {
  const a = client();
  const b = client();
  await Promise.all([waitForEvent(a, "connect"), waitForEvent(b, "connect")]);
  await join(a, "proj-room-create", "a");
  await join(b, "proj-room-create", "b");

  const ack = waitForEvent(a, "project:node-created");
  const broadcast = waitForEvent(b, "project:node-created");
  a.emit("project:create-node", {
    roomId: "proj-room-create",
    data: { node: { id: "f-code", name: "code.py", type: "file", parentId: null } },
  });
  const [ackPayload] = await ack;
  const [castPayload] = await broadcast;
  assert.equal(ackPayload.data.node.id, "f-code");
  assert.equal(ackPayload.data.node.name, "code.py");
  assert.equal(ackPayload.data.node.type, "file");
  assert.equal(ackPayload.data.node.parentId, null);
  assert.equal(castPayload.data.node.name, "code.py");

  const folderAck = waitForEvent(a, "project:node-created");
  const folderCast = waitForEvent(b, "project:node-created");
  a.emit("project:create-node", {
    roomId: "proj-room-create",
    data: { node: { id: "d-src", name: "src", type: "folder", parentId: null } },
  });
  await folderAck;
  await folderCast;

  const nestedAck = waitForEvent(b, "project:node-created");
  const nestedCast = waitForEvent(a, "project:node-created");
  b.emit("project:create-node", {
    roomId: "proj-room-create",
    data: { node: { id: "f-app", name: "app.js", type: "file", parentId: "d-src" } },
  });
  const [nested] = await nestedAck;
  assert.equal(nested.data.node.parentId, "d-src");
  await nestedCast;
});

test("rename and recursive delete fan out while preserving ids", async () => {
  const a = client();
  const b = client();
  const other = client();
  await Promise.all([waitForEvent(a, "connect"), waitForEvent(b, "connect"), waitForEvent(other, "connect")]);
  await join(a, "proj-room-mutate", "a");
  await join(b, "proj-room-mutate", "b");
  await join(other, "proj-room-mutate-other", "other");

  const createFolder = waitForEvent(a, "project:node-created");
  a.emit("project:create-node", {
    roomId: "proj-room-mutate",
    data: { node: { id: "folder-src", name: "src", type: "folder", parentId: null } },
  });
  await createFolder;
  const createFile = waitForEvent(a, "project:node-created");
  a.emit("project:create-node", {
    roomId: "proj-room-mutate",
    data: { node: { id: "file-app", name: "App.jsx", type: "file", parentId: "folder-src" } },
  });
  await createFile;

  const renamed = waitForEvent(b, "project:node-renamed");
  a.emit("project:rename-node", {
    roomId: "proj-room-mutate",
    data: { node: { id: "folder-src", name: "components" } },
  });
  const [renamePayload] = await renamed;
  assert.equal(renamePayload.data.node.id, "folder-src");
  assert.equal(renamePayload.data.node.name, "components");

  const deleted = waitForEvent(b, "project:nodes-deleted");
  const foreign = expectNoEvent(other, "project:nodes-deleted");
  a.emit("project:delete-node", {
    roomId: "proj-room-mutate",
    data: { nodeId: "folder-src" },
  });
  const [deletePayload] = await deleted;
  assert.deepEqual(new Set(deletePayload.data.deletedIds), new Set(["folder-src", "file-app"]));
  await foreign;

  const late = client();
  await waitForEvent(late, "connect");
  const snapshot = await join(late, "proj-room-mutate", "late");
  assert.equal(snapshot.data.nodes.some((node) => node.id === "folder-src" || node.id === "file-app"), false);
});

test("late joiners receive tree plus per-file contents", async () => {
  const a = client();
  await waitForEvent(a, "connect");
  await join(a, "proj-room-late", "a");
  const created = waitForEvent(a, "project:node-created");
  a.emit("project:create-node", {
    roomId: "proj-room-late",
    data: { node: { id: "f-code", name: "code.py", type: "file", parentId: null } },
  });
  await created;
  a.emit("code:update", {
    roomId: "proj-room-late",
    data: { fileId: "f-code", text: 'print("Hello")', rev: 1, actorId: "a" },
  });

  const c = client();
  await waitForEvent(c, "connect");
  const snapshot = await join(c, "proj-room-late", "c");
  const names = snapshot.data.nodes.map((n) => n.name);
  assert.ok(names.includes("Collaborative Code"));
  assert.ok(names.includes("code.py"));
  assert.equal(snapshot.data.files["f-code"].text, 'print("Hello")');
});

test("room isolation: other rooms never see foreign files", async () => {
  const a = client();
  await waitForEvent(a, "connect");
  await join(a, "proj-room-iso-a", "a");

  const d = client();
  await waitForEvent(d, "connect");
  const dSnapshot = await join(d, "proj-room-iso-b", "d");
  assert.deepEqual(
    dSnapshot.data.nodes.map((n) => n.name),
    ["Collaborative Code"],
  );

  d.emit("project:create-node", {
    roomId: "proj-room-iso-b",
    data: { node: { id: "f-b", name: "projectB.js", type: "file", parentId: null } },
  });
  await waitForEvent(d, "project:node-created");
  await expectNoEvent(a, "project:node-created");
});

test("legacy code:update without fileId lands on the shared document", async () => {
  const e = client();
  await waitForEvent(e, "connect");
  await join(e, "proj-room-legacy", "e");
  e.emit("code:update", { roomId: "proj-room-legacy", data: { text: "legacy hello", rev: 1, actorId: "e" } });

  const f = client();
  await waitForEvent(f, "connect");
  const snapshot = await join(f, "proj-room-legacy", "f");
  assert.equal(snapshot.data.files[DEFAULT_FILE_ID].text, "legacy hello");
  assert.ok(nodeByName(snapshot, "Collaborative Code"));
});

test("duplicate names are rejected loudly; simultaneous distinct files both land", async () => {
  const a = client();
  const b = client();
  await Promise.all([waitForEvent(a, "connect"), waitForEvent(b, "connect")]);
  await join(a, "proj-room-dup", "a");
  await join(b, "proj-room-dup", "b");

  a.emit("project:create-node", {
    roomId: "proj-room-dup",
    data: { node: { id: "f-dup1", name: "dup.js", type: "file", parentId: null } },
  });
  await waitForEvent(a, "project:node-created");
  await waitForEvent(b, "project:node-created");

  const err = waitForEvent(b, "connection:error");
  b.emit("project:create-node", {
    roomId: "proj-room-dup",
    data: { node: { id: "f-dup2", name: "DUP.js", type: "file", parentId: null } },
  });
  const [errPayload] = await err;
  assert.equal(errPayload.event, "project:create-node");
  assert.match(errPayload.message, /already exists/);
  assert.equal(errPayload.requestId, "f-dup2");
  await expectNoEvent(a, "project:node-created");

  const ackA = waitForEvent(a, "project:node-created");
  const ackB = waitForEvent(b, "project:node-created");
  a.emit("project:create-node", {
    roomId: "proj-room-dup",
    data: { node: { id: "f-sim-a", name: "sim-a.js", type: "file", parentId: null } },
  });
  b.emit("project:create-node", {
    roomId: "proj-room-dup",
    data: { node: { id: "f-sim-b", name: "sim-b.js", type: "file", parentId: null } },
  });
  await ackA;
  await ackB;

  const c = client();
  await waitForEvent(c, "connect");
  const snapshot = await join(c, "proj-room-dup", "c");
  const names = snapshot.data.nodes.map((n) => n.name);
  assert.ok(names.includes("dup.js"));
  assert.ok(names.includes("sim-a.js"));
  assert.ok(names.includes("sim-b.js"));
  assert.equal(names.filter((n) => n.toLowerCase() === "dup.js").length, 1);
});

test("reconnect restores the full project state", async () => {
  const g = client();
  await waitForEvent(g, "connect");
  await join(g, "proj-room-reconnect", "g");
  const created = waitForEvent(g, "project:node-created");
  g.emit("project:create-node", {
    roomId: "proj-room-reconnect",
    data: { node: { id: "f-r", name: "r.js", type: "file", parentId: null } },
  });
  await created;
  g.emit("code:update", {
    roomId: "proj-room-reconnect",
    data: { fileId: "f-r", text: "reconnect me", rev: 1, actorId: "g" },
  });
  // code:update is fire-and-forget (no ack): yield so the server processes
  // it before the disconnect, otherwise the in-flight op is dropped.
  await new Promise((resolve) => setTimeout(resolve, 150));
  g.disconnect();

  const g2 = client();
  await waitForEvent(g2, "connect");
  const snapshot = await join(g2, "proj-room-reconnect", "g");
  assert.ok(nodeByName(snapshot, "r.js"));
  assert.equal(snapshot.data.files["f-r"].text, "reconnect me");
});

test("spoofed rooms and malformed nodes fail loudly", async () => {
  const a = client();
  await waitForEvent(a, "connect");
  await join(a, "proj-room-spoof", "a");

  const spoof = waitForEvent(a, "connection:error");
  a.emit("project:create-node", {
    roomId: "proj-room-other",
    data: { node: { id: "f-x", name: "x.js", type: "file", parentId: null } },
  });
  assert.match((await spoof)[0].message, /does not belong/);

  const malformed = waitForEvent(a, "connection:error");
  a.emit("project:create-node", { roomId: "proj-room-spoof", data: { node: { id: "f-y", type: "file", parentId: null } } });
  assert.equal((await malformed)[0].event, "project:create-node");
});

test("unknown project events are silently ignored (why the client ack-timeout exists)", async () => {
  // Socket.io has no listener for this event, so a stale server behaves
  // identically: no ack, no error. The client's CREATE_ACK_TIMEOUT_MS guard
  // (useCollaborativeProject.js) is what turns this silence into a visible
  // draft error instead of a stuck input.
  const a = client();
  await waitForEvent(a, "connect");
  await join(a, "proj-room-silence", "a");
  a.emit("project:does-not-exist", { roomId: "proj-room-silence", data: {} });
  await expectNoEvent(a, "project:node-created", 200);
  await expectNoEvent(a, "connection:error", 200);
});

test("creates before room:join are rejected (membership check intact)", async () => {
  // A connected-but-never-joined socket must be refused: the client gates
  // creates on the room:joined ack precisely so users never hit this path.
  const s = client();
  await waitForEvent(s, "connect");
  const err = waitForEvent(s, "connection:error");
  s.emit("project:create-node", {
    roomId: "proj-room-nojoin",
    data: { node: { id: "f-early", name: "early.js", type: "file", parentId: null } },
  });
  const [errPayload] = await err;
  assert.equal(errPayload.event, "project:create-node");
  assert.match(errPayload.message, /does not belong/);
  assert.equal(errPayload.requestId, "f-early");

  // And nothing was stored: a later joiner sees only the default document.
  const j = client();
  await waitForEvent(j, "connect");
  const snapshot = await join(j, "proj-room-nojoin", "j");
  assert.deepEqual(
    snapshot.data.nodes.map((n) => n.name),
    ["Collaborative Code"],
  );
});
