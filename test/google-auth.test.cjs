/**
 * firebase-auth.test.cjs — Firebase Authentication tests (no Firebase network calls).
 * The Firebase Admin verification is faked per test (canned payloads); the user store is
 * the same in-memory fake shape used by auth.test.cjs. Fake credentials only.
 */
const assert = require("node:assert/strict");
const http = require("node:http");
const { test } = require("node:test");
const express = require("express");

const { verifyFirebaseIdToken } = require("../server/auth/firebase.cjs");
const { createUserStore } = require("../server/db/users.cjs");
const { createAuthRouter } = require("../server/auth/routes.cjs");

// Throwaway JWT secret for signing Axlero tokens in-route (never real).
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-only-secret-0123456789abcdef";
if (!process.env.JWT_EXPIRES_IN) process.env.JWT_EXPIRES_IN = "1h";

function fakeCollection() {
  const docs = [];
  let seq = 0;
  return {
    async createIndex() {
      return "ok";
    },
    async findOne(query) {
      const keys = Object.keys(query || {});
      return docs.find((d) => keys.every((k) => String(d[k]) === String(query[k]))) ?? null;
    },
    async insertOne(doc) {
      const hasDupEmail = docs.some((d) => d.email === doc.email);
      const hasDupUid = doc.firebaseUid && docs.some((d) => d.firebaseUid === doc.firebaseUid);
      if (hasDupEmail || hasDupUid) {
        const err = new Error("duplicate key");
        err.code = 11000;
        if (hasDupEmail) err.keyValue = { email: doc.email };
        else err.keyValue = { firebaseUid: doc.firebaseUid };
        throw err;
      }
      const copy = { ...doc, _id: `gid-${++seq}` };
      docs.push(copy);
      return { insertedId: copy._id };
    },
    get docs() {
      return docs;
    },
  };
}

// Per-test stores and servers to avoid cross-test contamination.
// Pass `logWarn` to capture server-side stage diagnostics instead of
// printing them; pass `getUserStore` through to simulate store outages.
async function makeTestApp({ seedFirebaseUser, seedPasswordUser, verifier, logWarn, getUserStore, storeOverrides, signTokenFn }) {
  const baseStore = createUserStore(fakeCollection());
  if (seedPasswordUser) await baseStore.createUser(seedPasswordUser);
  if (seedFirebaseUser) await baseStore.createFirebaseUser(seedFirebaseUser);
  const store = storeOverrides ? Object.assign(baseStore, storeOverrides) : baseStore;

  const app = express();
  app.use(
    "/api/auth",
    createAuthRouter({
      getUserStore: getUserStore || (() => store),
      verifyFirebaseFn: verifier || (async () => { throw new Error("Invalid Firebase ID token."); }),
      logWarn: logWarn || (() => {}),
      signTokenFn,
    })
  );
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, resolve));
  const port = srv.address().port;
  return { srv, port, store, base: `http://localhost:${port}` };
}

async function closeTestApp(appObj) {
  await new Promise((resolve, reject) => {
    appObj.srv.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---- Firebase ID token verification tests (no real Firebase) ----

test("invalid Firebase tokens rejected generically", async () => {
  await assert.rejects(verifyFirebaseIdToken(""), /Invalid Firebase ID token/);
  await assert.rejects(verifyFirebaseIdToken(null), /Invalid Firebase ID token/);
  await assert.rejects(verifyFirebaseIdToken("   "), /Invalid Firebase ID token/);
  await assert.rejects(verifyFirebaseIdToken("bogus"), /Invalid Firebase ID token/);
});

// ---- Firebase user store tests ----

test("Firebase user store: create, findByFirebaseUid, duplicates, safe shape", async () => {
  const col = fakeCollection();
  const store = createUserStore(col);
  const created = await store.createFirebaseUser({ firebaseUid: "fb-1", email: "G@Example.com", displayName: " Gee " });
  assert.equal(created.email, "g@example.com");
  assert.equal(created.displayName, "Gee");
  assert.ok(!("passwordHash" in created));
  const raw = await store.findByFirebaseUid("fb-1");
  assert.ok(!raw.passwordHash);
  assert.equal(await store.findByFirebaseUid("nope"), null);
  assert.equal(await store.findByFirebaseUid(""), null);
  await assert.rejects(store.createFirebaseUser({ firebaseUid: "fb-1", email: "other@x.co", displayName: "X" }), /already linked/);
  await assert.rejects(
    store.createFirebaseUser({ firebaseUid: "fb-2", email: "g@example.com", displayName: "Y" }),
    /already exists/
  );
  assert.equal(await store.verifyPassword(raw, "anything-123"), false);
  // No firebaseUid duplicated, no email duplicated
  assert.equal(col.docs.length, 1);
});

// ---- HTTP-level tests with faked Firebase verifier ----

test("A. Firebase email signup: token → new MongoDB user → 200 + Axlero JWT", async () => {
  const mockVerifier = async (idToken) => {
    if (idToken === "valid-new") return { uid: "firebase-new-123", email: "newf@example.com", displayName: "New Firebase" };
    throw new Error("Invalid Firebase ID token.");
  };
  const { srv, base } = await makeTestApp({ verifier: mockVerifier });
  try {
    const res = await fetch(`${base}/api/auth/firebase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "valid-new" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.email, "newf@example.com");
    assert.ok(body.token);
    assert.ok(!("passwordHash" in body.user));
    assert.equal(String(body.token).split(".").length, 3);
  } finally {
    await closeTestApp({ srv, base });
  }
});

test("B. Firebase email login: token for existing UID → existing MongoDB user → 200", async () => {
  const mockVerifier = async (idToken) => {
    if (idToken === "valid-existing") return { uid: "firebase-known-123", email: "knownf@example.com", displayName: "Known Firebase" };
    throw new Error("Invalid Firebase ID token.");
  };
  const { srv, base } = await makeTestApp({ verifier: mockVerifier });
  try {
    const r1 = await fetch(`${base}/api/auth/firebase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "valid-existing" }),
    });
    const b1 = await r1.json();
    const r2 = await fetch(`${base}/api/auth/firebase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "valid-existing" }),
    });
    const b2 = await r2.json();
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(b1.user.id, b2.user.id);
  } finally {
    await closeTestApp({ srv, base });
  }
});

test("C. Google Firebase login: existing UID → same MongoDB user → 200", async () => {
  const mockVerifier = async () => ({ uid: "fb-google-1", email: "guser@example.com", displayName: "G User" });
  const { srv, base, store } = await makeTestApp({ verifier: mockVerifier });
  try {
    await store.createFirebaseUser({ firebaseUid: "fb-google-1", email: "guser@example.com", displayName: "G User" });
    const res = await fetch(`${base}/api/auth/firebase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "any" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.email, "guser@example.com");
  } finally {
    await closeTestApp({ srv, base });
  }
});

test("D. Same Firebase UID twice: first creates, second logs into same user, no duplicate", async () => {
  const mockVerifier = async (idToken) => {
    if (idToken === "same-uid") return { uid: "dup-uid-123", email: "dup@example.com", displayName: "Dup" };
    throw new Error("Invalid Firebase ID token.");
  };
  const col = fakeCollection();
  const store = createUserStore(col);
  const app = express();
  app.use("/api/auth", createAuthRouter({ getUserStore: () => store, verifyFirebaseFn: mockVerifier, logWarn: () => {} }));
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, r));
  const base = `http://localhost:${srv.address().port}`;
  try {
    const r1 = await fetch(`${base}/api/auth/firebase`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: "same-uid" }) });
    const b1 = await r1.json();
    const r2 = await fetch(`${base}/api/auth/firebase`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: "same-uid" }) });
    const b2 = await r2.json();
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(b1.user.id, b2.user.id);
    assert.equal(col.docs.length, 1);
  } finally {
    await new Promise((r, j) => srv.close((e) => (e ? j(e) : r())));
  }
});

test("E. Duplicate email: new UID with email belonging to old password account → 409 no merge", async () => {
  const mockVerifier = async () => ({ uid: "firebase-other-123", email: "taken@example.com", displayName: "Taken" });
  const { srv, base } = await makeTestApp({
    seedPasswordUser: { email: "taken@example.com", password: "password-123", displayName: "Taken" },
    verifier: mockVerifier,
  });
  try {
    const res = await fetch(`${base}/api/auth/firebase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "whatever" }),
    });
    const body = await res.json();
    assert.equal(res.status, 409);
    assert.match(body.error, /already exists/);
  } finally {
    await closeTestApp({ srv, base });
  }
});

test("F. Invalid Firebase ID token → 401", async () => {
  const { srv, base } = await makeTestApp({});
  try {
    for (const payload of [{}, { idToken: "" }, { idToken: "bogus" }]) {
      const res = await fetch(`${base}/api/auth/firebase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.ok(res.status === 400 || res.status === 401, `expected 4xx, got ${res.status}`);
      const body = await res.json();
      assert.ok(body && typeof body.error === "string");
    }
  } finally {
    await closeTestApp({ srv, base });
  }
});

test("G. Missing Firebase UID/email → 401", async () => {
  const mockVerifierNoUid = async () => ({ uid: "", email: "user@example.com", displayName: "X" });
  const { srv, base } = await makeTestApp({ verifier: mockVerifierNoUid });
  try {
    const res = await fetch(`${base}/api/auth/firebase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "t" }),
    });
    assert.equal(res.status, 401);
  } finally {
    await closeTestApp({ srv, base });
  }
});

test("H. passwordHash is not returned to clients", async () => {
  const mockVerifier = async () => ({ uid: "fb-no-pw-1", email: "nopw@example.com", displayName: "NoPw" });
  const { srv, base, store } = await makeTestApp({ verifier: mockVerifier });
  try {
    const res = await fetch(`${base}/api/auth/firebase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "x" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(!("passwordHash" in body.user));
    const raw = await store.findByFirebaseUid("fb-no-pw-1");
    assert.ok(!raw.passwordHash);
  } finally {
    await closeTestApp({ srv, base });
  }
});

test("I. Mongo unavailable → 503 with store-unavailable stage log", async () => {
  const prevUri = process.env.MONGODB_URI;
  delete process.env.MONGODB_URI;
  const logs = [];
  const mockVerifier = async () => ({ uid: "u-1", email: "u1@example.com", displayName: "U" });
  const app = express();
  app.use(
    "/api/auth",
    createAuthRouter({
      getUserStore: () => {
        throw new Error("MongoDB is not connected");
      },
      verifyFirebaseFn: mockVerifier,
      logWarn: (m) => logs.push(m),
    })
  );
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, r));
  const base = `http://localhost:${srv.address().port}`;
  try {
    const res = await fetch(`${base}/api/auth/firebase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "x" }),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, "Authentication service unavailable. Try again shortly.");
    assert.ok(logs.some((m) => m.includes("store unavailable")), `expected stage log, got: ${logs.join(" | ")}`);
  } finally {
    await new Promise((r, j) => srv.close((e) => (e ? j(e) : r())));
    if (prevUri !== undefined) process.env.MONGODB_URI = prevUri;
  }
});

test("J. findByFirebaseUid failure → 503 with find stage log (fail closed, no duplicate)", async () => {
  const mockVerifier = async () => ({ uid: "fb-flaky-1", email: "flaky@example.com", displayName: "Flaky" });
  const logs = [];
  const { srv, base, store } = await makeTestApp({
    verifier: mockVerifier,
    logWarn: (m) => logs.push(m),
    storeOverrides: {
      findByFirebaseUid: async () => {
        throw new Error("db flake");
      },
    },
  });
  try {
    const res = await fetch(`${base}/api/auth/firebase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "secret-token-xyz" }),
    });
    assert.equal(res.status, 503);
    assert.ok(logs.some((m) => m.includes("findByFirebaseUid failed")), `expected stage log, got: ${logs.join(" | ")}`);
    assert.ok(!logs.join(" ").includes("secret-token-xyz"), "stage logs must never contain tokens");
    assert.equal(await store.findByEmail("flaky@example.com").catch(() => "threw"), null);
  } finally {
    await closeTestApp({ srv, base });
  }
});

test("K. token signing failure → 503 with signing stage log", async () => {
  const mockVerifier = async () => ({ uid: "fb-sign-1", email: "sign@example.com", displayName: "Sign" });
  const logs = [];
  const { srv, base } = await makeTestApp({
    verifier: mockVerifier,
    logWarn: (m) => logs.push(m),
    signTokenFn: () => {
      throw new Error("bad secret");
    },
  });
  try {
    const res = await fetch(`${base}/api/auth/firebase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "x" }),
    });
    assert.equal(res.status, 503);
    assert.ok(logs.some((m) => m.includes("token signing failed")), `expected stage log, got: ${logs.join(" | ")}`);
  } finally {
    await closeTestApp({ srv, base });
  }
});
