/**
 * yjs-collab.test.cjs — Yjs collaboration through the live Socket.io stack.
 *
 * One OS process shares the getYDoc singleton, so a second client bound to
 * the same room would share state by construction and prove nothing. Every
 * "peer" here is therefore a standalone Y.Doc / Awareness (fresh objects,
 * independent clocks) driven through a REAL socket exactly the way
 * useCollaborativeYjs drives its side: local transactions emit yjs:update,
 * inbound wire bytes apply with a remote origin, sync-requests are
 * answered with diffs. Convergence assertions then prove the full path:
 * local CRDT op → wire encode → server relay → wire decode → remote CRDT.
 */

const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { after, afterEach, before, test } = require("node:test");
const { io: connect } = require("socket.io-client");
const { createSocketServer } = require("../server/socket.cjs");

let Y;
let Awareness;
let encodeAwarenessUpdate;
let applyAwarenessUpdate;
let encodeStateAsUpdate;
let applyUpdate;
let encodeStateVector;

const {
  PROTOCOL,
  YJS_UPDATE_EVENT,
  YJS_AWARENESS_EVENT,
  YJS_HELLO_EVENT,
  ORIGIN_REMOTE,
  attachRoomSync,
  detachRoomSync,
  isValidYjsEnvelope,
  updateToBase64,
  base64ToUpdate,
  resetSyncForTests,
} = require("../src/lib/yjsSocketProvider.js");
const { getYDoc, destroyYDoc, resetForTests } = require("../src/lib/yjsProvider.js");
const {
  resetAwarenessForTests,
  setLocalUser,
  setLocalCursor,
  getAwarenessSnapshot,
} = require("../src/lib/yjsAwareness.js");
const {
  getFileText,
  applyLocalTextEdit,
} = require("../src/lib/yjsText.js");
const { createShape, getSharedShapes } = require("../src/lib/yjsWhiteboard.js");

let httpServer;
let port;
let sockets = [];
let peers = [];

function waitForEvent(socket, event) {
  return once(socket, event);
}

function waitFor(fn, timeoutMs = 8000, label = "condition") {
  const start = Date.now();
  return (async () => {
    for (;;) {
      try {
        const value = fn();
        if (value) return value;
      } catch {
        // retry
      }
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  })();
}

function freshState() {
  for (const peer of peers) {
    try {
      peer.destroy();
    } catch {
      // ignore
    }
  }
  peers = [];
  try {
    resetSyncForTests();
  } catch {
    // ignore
  }
  try {
    resetAwarenessForTests();
  } catch {
    // ignore
  }
  try {
    resetForTests();
  } catch {
    // ignore
  }
}

before(async () => {
  Y = await import("yjs");
  ({ Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } = await import("y-protocols/awareness"));
  ({ encodeStateAsUpdate, applyUpdate, encodeStateVector } = Y);
  httpServer = http.createServer();
  createSocketServer(httpServer);
  httpServer.listen(0);
  await once(httpServer, "listening");
  port = httpServer.address().port;
});

after(async () => {
  for (const socket of sockets) {
    try {
      socket.disconnect();
    } catch {
      // ignore
    }
  }
  await new Promise((resolve) => httpServer.close(resolve));
});

afterEach(() => freshState());

function client() {
  const socket = connect(`http://localhost:${port}`, { forceNew: true });
  sockets.push(socket);
  return socket;
}

async function join(socket, roomId, userId) {
  const joined = waitForEvent(socket, "room:joined");
  socket.emit("room:join", { roomId, userId });
  await joined;
}

/**
 * Independent peer: fresh Y.Doc + Awareness on a real socket, speaking the
 * exact wire protocol the hook speaks (hello, sync-request answers, update
 * relay with remote origin). Independent clocks — convergence here is real.
 */
function wirePeer(socket, roomId, userId) {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const api = {
    doc,
    awareness,
    destroy() {
      try {
        doc.off("update", onDoc);
      } catch {
        // ignore
      }
      try {
        awareness.off("update", onAware);
      } catch {
        // ignore
      }
      try {
        socket.off(YJS_UPDATE_EVENT, onWireDoc);
      } catch {
        // ignore
      }
      try {
        socket.off(YJS_AWARENESS_EVENT, onWireAware);
      } catch {
        // ignore
      }
      try {
        awareness.destroy();
      } catch {
        // ignore
      }
      try {
        doc.destroy();
      } catch {
        // ignore
      }
    },
  };
  function send(kind, fields) {
    try {
      socket.emit(kind === "awareness" ? YJS_AWARENESS_EVENT : YJS_UPDATE_EVENT, {
        roomId,
        data: { protocol: PROTOCOL, ...fields },
      });
    } catch {
      // ignore
    }
  }
  function onDoc(update, origin) {
    if (origin === ORIGIN_REMOTE) return;
    const b64 = updateToBase64(update);
    if (b64) send("update", { kind: "update", update: b64 });
  }
  function onAware() {
    try {
      const states = awareness.getStates();
      if (states.size === 0) return;
      const encoded = encodeAwarenessUpdate(awareness, [...states.keys()]);
      const b64 = updateToBase64(encoded);
      if (b64) send("awareness", { kind: "awareness", update: b64 });
    } catch {
      // ignore
    }
  }
  function onWireDoc(payload) {
    try {
      if (!payload || payload.roomId !== roomId || !payload.data) return;
      const envelope = isValidYjsEnvelope(payload.data);
      if (!envelope) return;
      if (envelope.kind === "sync-request") {
        const vector = base64ToUpdate(envelope.stateVector);
        if (!vector) return;
        let diff;
        try {
          diff = encodeStateAsUpdate(doc, vector);
        } catch {
          return;
        }
        const b64 = updateToBase64(diff);
        if (b64) send("update", { kind: "sync-state", update: b64 });
        return;
      }
      const bytes = base64ToUpdate(envelope.update);
      if (bytes) applyUpdate(doc, bytes, ORIGIN_REMOTE);
    } catch {
      // never let wire bytes break the peer
    }
  }
  function onWireAware(payload) {
    try {
      if (!payload || payload.roomId !== roomId || !payload.data) return;
      const envelope = isValidYjsEnvelope(payload.data);
      if (!envelope || envelope.kind !== "awareness") return;
      const bytes = base64ToUpdate(envelope.update);
      if (bytes) applyAwarenessUpdate(awareness, bytes, ORIGIN_REMOTE);
    } catch {
      // ignore
    }
  }
  doc.on("update", onDoc);
  awareness.on("update", onAware);
  socket.on(YJS_UPDATE_EVENT, onWireDoc);
  socket.on(YJS_AWARENESS_EVENT, onWireAware);
  awareness.setLocalState({ user: { id: userId, name: userId } });
  try {
    socket.emit(YJS_HELLO_EVENT, {
      roomId,
      data: { protocol: PROTOCOL, kind: "hello", clientId: awareness.clientID },
    });
  } catch {
    // ignore
  }
  // Bootstrap like attachRoomSync: hello + sync-request so the map entry
  // converges BEFORE any concurrent edit (concurrent creation of the same
  // Y.Text with divergent content would orphan one side by map LWW).
  try {
    const vector = Y.encodeStateVector(doc);
    const b64 = updateToBase64(vector);
    if (b64) {
      socket.emit(YJS_UPDATE_EVENT, {
        roomId,
        data: { protocol: PROTOCOL, kind: "sync-request", stateVector: b64 },
      });
    }
  } catch {
    // ignore
  }
  peers.push(api);
  return api;
}

function peerFileText(peer, fileId) {
  const text = peer.doc.getMap("projectFiles").get(fileId);
  return text && typeof text.toString === "function" ? text.toString() : null;
}

test("concurrent typing converges through the live transport", async () => {
  const a = client();
  const b = client();
  await Promise.all([waitForEvent(a, "connect"), waitForEvent(b, "connect")]);
  await join(a, "yjs-conv", "a");
  await join(b, "yjs-conv", "b");
  // Attached side (shared singleton doc, as the hook uses it).
  const attA = attachRoomSync({ socket: a, roomId: "yjs-conv", identity: { userId: "a", displayName: "A" } });
  // Independent peer side (own doc, own clocks).
  const peerB = wirePeer(b, "yjs-conv", "b");
  // Establish the shared mapping first (A writes, B converges via wire —
  // the normal join-then-type order). Concurrent creation of the same Y.Text
  // with divergent content would orphan one side by map LWW, so the map
  // entry must converge before concurrent edits land on it.
  applyLocalTextEdit(attA.doc, "f1", "Hello");
  await waitFor(() => peerFileText(peerB, "f1") === "Hello" ? true : null, 8000, "peer bootstrap");
  // Now causally concurrent edits on the converged object (no sync between):
  // A appends, B prepends — disjoint positions merge deterministically,
  // which arrival-order LWW could never do (one side would lose).
  applyLocalTextEdit(attA.doc, "f1", "Hello A-edit");
  const ytextB = peerB.doc.getMap("projectFiles").get("f1");
  peerB.doc.transact(() => {
    ytextB.insert(0, "B-edit ");
  });
  await waitFor(() => {
    const ta = peerFileText({ doc: attA.doc }, "f1");
    const tb = peerFileText(peerB, "f1");
    return ta !== null && tb !== null && ta === tb && ta.includes("A-edit") && ta.includes("B-edit ") ? ta : null;
  }, 10000, "CRDT convergence");
  detachRoomSync("yjs-conv");
});

test("multiple files converge independently", async () => {
  const a = client();
  const b = client();
  await Promise.all([waitForEvent(a, "connect"), waitForEvent(b, "connect")]);
  await join(a, "yjs-multi", "a");
  await join(b, "yjs-multi", "b");
  const attA = attachRoomSync({ socket: a, roomId: "yjs-multi", identity: { userId: "a", displayName: "A" } });
  const peerB = wirePeer(b, "yjs-multi", "b");
  applyLocalTextEdit(attA.doc, "fa", "alpha");
  const yb = peerB.doc.getMap("projectFiles");
  const tb = new Y.Text();
  yb.set("fb", tb);
  tb.insert(0, "beta");
  await waitFor(() => {
    const aa = peerFileText({ doc: attA.doc }, "fa");
    const ab = peerFileText({ doc: attA.doc }, "fb");
    const ba = peerFileText(peerB, "fa");
    const bb = peerFileText(peerB, "fb");
    return aa === "alpha" && ba === "alpha" && ab === "beta" && bb === "beta" ? true : null;
  }, 10000, "multi-file convergence");
  detachRoomSync("yjs-multi");
});

test("reconnect heals via destroy, re-attach, and sync-request", async () => {
  const a = client();
  const b = client();
  await Promise.all([waitForEvent(a, "connect"), waitForEvent(b, "connect")]);
  await join(a, "yjs-recon", "a");
  await join(b, "yjs-recon", "b");
  const attA = attachRoomSync({ socket: a, roomId: "yjs-recon", identity: { userId: "a", displayName: "A" } });
  const peerB = wirePeer(b, "yjs-recon", "b");
  applyLocalTextEdit(attA.doc, "f1", "before-drop");
  await waitFor(() => peerFileText(peerB, "f1") === "before-drop", 8000, "peer caught up");
  // Full lifecycle teardown exactly as the hook performs it on leave.
  detachRoomSync("yjs-recon");
  destroyYDoc("yjs-recon");
  // Peer keeps editing while A is gone (independent doc survives).
  const yb = peerB.doc.getMap("projectFiles");
  const tb = yb.get("f1");
  peerB.doc.transact(() => {
    tb.delete(0, tb.length);
    tb.insert(0, "before-drop plus more");
  });
  // A returns with a fresh doc: bootstrap must restore everything.
  const attA2 = attachRoomSync({ socket: a, roomId: "yjs-recon", identity: { userId: "a", displayName: "A" } });
  await waitFor(() => peerFileText({ doc: attA2.doc }, "f1") === "before-drop plus more", 10000, "reconnect heal");
  detachRoomSync("yjs-recon");
});

test("late joiner converges via sync-request bootstrap", async () => {
  const a = client();
  await waitForEvent(a, "connect");
  await join(a, "yjs-late", "a");
  const attA = attachRoomSync({ socket: a, roomId: "yjs-late", identity: { userId: "a", displayName: "A" } });
  applyLocalTextEdit(attA.doc, "f1", "established content");
  await waitFor(() => peerFileText({ doc: attA.doc }, "f1") === "established content", 5000, "author settled");
  const c = client();
  await waitForEvent(c, "connect");
  await join(c, "yjs-late", "c");
  const peerC = wirePeer(c, "yjs-late", "c");
  await waitFor(() => peerFileText(peerC, "f1") === "established content", 10000, "late join");
  detachRoomSync("yjs-late");
});

test("whiteboard shapes converge across two live clients", async () => {
  const a = client();
  const b = client();
  await Promise.all([waitForEvent(a, "connect"), waitForEvent(b, "connect")]);
  await join(a, "yjs-board", "a");
  await join(b, "yjs-board", "b");
  const attA = attachRoomSync({ socket: a, roomId: "yjs-board", identity: { userId: "a", displayName: "A" } });
  const peerB = wirePeer(b, "yjs-board", "b");
  const shape = (id, x) => ({ id, type: "rectangle", x, y: 1, width: 10, height: 10, fill: "#ffffff" });
  // Establish the shared registry first (A creates, B converges via wire),
  // then create concurrently on the converged mapping.
  const r1 = createShape(attA.doc, shape("shape-r1", 1));
  assert.equal(r1.applied, true);
  await waitFor(() => {
    const ids = getSharedShapes(peerB.doc).map((s) => s.id);
    return ids.includes("shape-r1") ? true : null;
  }, 8000, "peer bootstrap");
  const r2 = createShape(peerB.doc, shape("shape-r2", 2));
  assert.equal(r2.applied, true);
  await waitFor(() => {
    const ids = (doc) => getSharedShapes(doc).map((s) => s.id).sort().join(",");
    return ids(attA.doc) === "shape-r1,shape-r2" && ids(peerB.doc) === "shape-r1,shape-r2" ? true : null;
  }, 10000, "board convergence");
  detachRoomSync("yjs-board");
});

test("awareness identity and cursor propagate to peers", async () => {
  const a = client();
  const b = client();
  await Promise.all([waitForEvent(a, "connect"), waitForEvent(b, "connect")]);
  await join(a, "yjs-aware", "a");
  await join(b, "yjs-aware", "b");
  attachRoomSync({ socket: a, roomId: "yjs-aware", identity: { userId: "a", displayName: "A" } });
  const peerB = wirePeer(b, "yjs-aware", "b");
  setLocalUser("yjs-aware", { id: "a", name: "A" });
  setLocalCursor("yjs-aware", { file: "f1", lineNumber: 3, column: 7 });
  // Assert on the INDEPENDENT wire peer only: the shared registry cannot
  // distinguish self from other (same Awareness object by design).
  await waitFor(() => {
    let found = null;
    for (const [, state] of peerB.awareness.getStates().entries()) {
      if (state && state.user && state.user.id === "a" && state.cursor) found = state.cursor;
    }
    return found && found.lineNumber === 3 ? found : null;
  }, 8000, "cursor propagation");
  detachRoomSync("yjs-aware");
});

test("rooms stay isolated on the Yjs channel", async () => {
  const a = client();
  const b = client();
  await Promise.all([waitForEvent(a, "connect"), waitForEvent(b, "connect")]);
  await join(a, "yjs-iso-a", "a");
  await join(b, "yjs-iso-b", "b");
  const attA = attachRoomSync({ socket: a, roomId: "yjs-iso-a", identity: { userId: "a", displayName: "A" } });
  attachRoomSync({ socket: b, roomId: "yjs-iso-b", identity: { userId: "b", displayName: "B" } });
  applyLocalTextEdit(attA.doc, "f1", "room-a-only");
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(getYDoc("yjs-iso-b").getMap("projectFiles").get("f1"), undefined);
  detachRoomSync("yjs-iso-a");
  detachRoomSync("yjs-iso-b");
});

test("invalid, oversized, and non-member Yjs traffic is rejected", async () => {
  const a = client();
  const b = client();
  await Promise.all([waitForEvent(a, "connect"), waitForEvent(b, "connect")]);
  await join(a, "yjs-bad", "a");
  await join(b, "yjs-bad", "b");
  attachRoomSync({ socket: a, roomId: "yjs-bad", identity: { userId: "a", displayName: "A" } });
  attachRoomSync({ socket: b, roomId: "yjs-bad", identity: { userId: "b", displayName: "B" } });
  const errors = [];
  a.on("connection:error", (p) => errors.push(p));
  a.emit(YJS_UPDATE_EVENT, { roomId: "yjs-bad", data: { protocol: "nope", kind: "update", update: "eA==" } });
  a.emit(YJS_UPDATE_EVENT, { roomId: "yjs-bad", data: { protocol: PROTOCOL, kind: "nuke", update: "eA==" } });
  a.emit(YJS_UPDATE_EVENT, {
    roomId: "yjs-bad",
    data: { protocol: PROTOCOL, kind: "update", update: "eA==".padEnd(300 * 1024, "A") },
  });
  await waitFor(() => (errors.length >= 3 ? true : null), 5000, "three rejections");
  assert.ok(errors.every((e) => e && typeof e.message === "string"));
  const outsiderErrors = [];
  const outsider = client();
  await waitForEvent(outsider, "connect");
  outsider.on("connection:error", (p) => outsiderErrors.push(p));
  outsider.emit(YJS_UPDATE_EVENT, { roomId: "yjs-bad", data: { protocol: PROTOCOL, kind: "update", update: "eA==" } });
  await waitFor(() => (outsiderErrors.length >= 1 ? true : null), 5000, "non-member rejection");
  assert.match(outsiderErrors[0].message, /does not belong/);
  detachRoomSync("yjs-bad");
});
