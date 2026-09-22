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
      if (docs.some((d) => d.email === doc.email || (doc.googleId && d.googleId === doc.googleId))) {
        const err = new Error("duplicate key");
        err.code = 11000;
        err.keyValue = doc.googleId ? { googleId: doc.googleId } : { email: doc.email };
        throw err;
      }
      const copy = { ...doc, _id: `gid-${++seq}` };
      docs.push(copy);
      return { insertedId: copy._id };
    },
  };
}

// Per-test stores and servers to avoid cross-test contamination.
async function makeTestApp({ seedGoogleUser, seedPasswordUser, verifier }) {
  const store = createUserStore(fakeCollection());
  if (seedPasswordUser) await store.createUser(seedPasswordUser);
  if (seedGoogleUser) await store.createGoogleUser(seedGoogleUser);

  const app = express();
  app.use(
    "/api/auth",
    createAuthRouter({
      getUserStore: () => store,
      verifyFirebaseFn: verifier || (async () => { throw new Error("Invalid Firebase ID token."); }),
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

// ---- Google user store tests (reused) ----

test("Google user store: create, findByGoogleId, duplicates, safe shape", async () => {
  const store = createUserStore(fakeCollection());
  const created = await store.createGoogleUser({ googleId: "g-1", email: "G@Example.com", displayName: " Gee " });
  assert.equal(created.email, "g@example.com");
  assert.equal(created.displayName, "Gee");
  assert.ok(!("passwordHash" in created));
  const raw = await store.findByGoogleId("g-1");
  assert.equal(raw.passwordHash, null);
  assert.equal(await store.findByGoogleId("nope"), null);
  assert.equal(await store.findByGoogleId(""), null);
  await assert.rejects(store.createGoogleUser({ googleId: "g-1", email: "other@x.co", displayName: "X" }), /already linked/);
  await assert.rejects(
    store.createGoogleUser({ googleId: "g-2", email: "g@example.com", displayName: "Y" }),
    /already exists/
  );
  assert.equal(await store.verifyPassword(raw, "anything-123"), false);
});

// ---- HTTP-level tests with faked Firebase verifier ----

test("POST /api/auth/firebase creates new Firebase user (200 + Axlero JWT shape)", async () => {
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

test("POST /api/auth/firebase logs in existing Firebase user", async () => {
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

test("POST /api/auth/firebase 409s when email belongs to a password account", async () => {
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

test("POST /api/auth/firebase rejects bad tokens with safe 4xx", async () => {
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

test("POST /api/auth/firebase reuses Firebase UID even if email differs (login)", async () => {
  const mockVerifier = async (idToken) => {
    if (idToken === "valid-conflict-uid") return { uid: "firebase-same-uid", email: "different@example.com", displayName: "Conflict" };
    throw new Error("Invalid Firebase ID token.");
  };
  const { srv, base, store } = await makeTestApp({ verifier: mockVerifier });
  try {
    await store.createGoogleUser({ googleId: "firebase-same-uid", email: "original@example.com", displayName: "Original" });
    const res = await fetch(`${base}/api/auth/firebase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "valid-conflict-uid" }),
    });
    const body = await res.json();
    // UID is authoritative — existing UID logs in, email in token is ignored for lookup
    assert.equal(res.status, 200);
    assert.equal(body.user.email, "original@example.com");
  } finally {
    await closeTestApp({ srv, base });
  }
});

test("POST /api/auth/firebase rejects missing uid/email from verified token", async () => {
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
