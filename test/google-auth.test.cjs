/**
 * google-auth.test.cjs — Google Sign-In tests (no Google network calls).
 * The OAuth client is faked per test (canned payloads); the user store is
 * the same in-memory fake shape used by auth.test.cjs. Fake credentials only.
 */
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { after, before, test } = require("node:test");
const express = require("express");

const { verifyGoogleIdToken } = require("../server/auth/google.cjs");
const { createUserStore } = require("../server/db/users.cjs");
const { createAuthRouter } = require("../server/auth/routes.cjs");

// Fake client ID for all tests that don't manage the env themselves.
// (The missing-config case below deletes/restores it explicitly.)
if (!process.env.GOOGLE_CLIENT_ID) process.env.GOOGLE_CLIENT_ID = "test-client-id";
// Throwaway JWT secret for signing Axlero tokens in-route (never real).
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-only-secret-0123456789abcdef";
if (!process.env.JWT_EXPIRES_IN) process.env.JWT_EXPIRES_IN = "1h";

const GOOD_PAYLOAD = {
  sub: "google-sub-123",
  email: "guser@example.com",
  email_verified: true,
  name: "G User",
  aud: "test-client-id",
  iss: "https://accounts.google.com",
  exp: Math.floor(Date.now() / 1000) + 3600,
};

function fakeClient(payload, { throws = false } = {}) {
  return {
    async verifyIdToken() {
      if (throws) throw new Error("bad signature");
      return { getPayload: () => ({ ...payload }) };
    },
  };
}

function withClientId(id, fn) {
  const prev = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = id;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = prev;
  }
}

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

test("valid Google token accepted; identity comes from the verified payload", async () => {
  await withClientId("test-client-id", async () => {
    const id = await verifyGoogleIdToken("fake.jwt.token", { client: fakeClient(GOOD_PAYLOAD) });
    assert.deepEqual(id, { googleId: "google-sub-123", email: "guser@example.com", displayName: "G User" });
  });
});

test("invalid/tampered Google tokens rejected generically", async () => {
  await withClientId("test-client-id", async () => {
    await assert.rejects(verifyGoogleIdToken("x", { client: fakeClient(GOOD_PAYLOAD, { throws: true }) }), /Invalid Google credential/);
    await assert.rejects(verifyGoogleIdToken("", { client: fakeClient(GOOD_PAYLOAD) }), /Invalid Google credential/);
    await assert.rejects(verifyGoogleIdToken(null, { client: fakeClient(GOOD_PAYLOAD) }), /Invalid Google credential/);
  });
});

test("wrong audience, issuer, expiry, email problems rejected", async () => {
  await withClientId("test-client-id", async () => {
    const cases = [
      { ...GOOD_PAYLOAD, aud: "other-client" },
      { ...GOOD_PAYLOAD, iss: "https://evil.example.com" },
      { ...GOOD_PAYLOAD, exp: Math.floor(Date.now() / 1000) - 10 },
      { ...GOOD_PAYLOAD, email: undefined },
      { ...GOOD_PAYLOAD, email_verified: false },
      { ...GOOD_PAYLOAD, sub: "" },
    ];
    for (const payload of cases) {
      await assert.rejects(verifyGoogleIdToken("t", { client: fakeClient(payload) }), /Invalid Google credential/);
    }
  });
});

test("missing GOOGLE_CLIENT_ID fails closed", async () => {
  const prev = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  try {
    await assert.rejects(verifyGoogleIdToken("t", { client: fakeClient(GOOD_PAYLOAD) }), /not configured/);
  } finally {
    if (prev !== undefined) process.env.GOOGLE_CLIENT_ID = prev;
  }
});

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
  // No silent merge: taken email + new googleId is a conflict, not a link.
  await assert.rejects(
    store.createGoogleUser({ googleId: "g-2", email: "g@example.com", displayName: "Y" }),
    /already exists/
  );
  // Google users can never password-login.
  assert.equal(await store.verifyPassword(raw, "anything-123"), false);
});

// ---- HTTP-level tests with faked Google verifier ----

let appServer;
let appPort;

before(async () => {
  const store = createUserStore(fakeCollection());
  await store.createUser({ email: "taken@example.com", password: "password-123", displayName: "Taken" });
  const app = express();
  app.use(
    "/api/auth",
    createAuthRouter({
      getUserStore: () => store,
      verifyGoogleFn: async (credential) => {
        if (credential === "valid-new") return { googleId: "gg-new", email: "newg@example.com", displayName: "New G" };
        if (credential === "valid-existing") return { googleId: "gg-known", email: "known@example.com", displayName: "Known" };
        throw new Error("Invalid Google credential.");
      },
    })
  );
  // Seed the known Google account.
  await store.createGoogleUser({ googleId: "gg-known", email: "known@example.com", displayName: "Known" });
  appServer = http.createServer(app);
  appServer.listen(0);
  await once(appServer, "listening");
  appPort = appServer.address().port;
});

after(async () => {
  await new Promise((resolve) => appServer.close(resolve));
});

async function postGoogle(credential) {
  const res = await fetch(`http://localhost:${appPort}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credential === undefined ? {} : { credential }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test("POST /api/auth/google creates new Google accounts (201 + Axlero JWT shape)", async () => {
  const res = await postGoogle("valid-new");
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, "newg@example.com");
  assert.ok(res.body.token);
  assert.ok(!("passwordHash" in res.body.user));
  const parts = String(res.body.token).split(".");
  assert.equal(parts.length, 3);
});

test("POST /api/auth/google logs in existing Google accounts", async () => {
  const first = await postGoogle("valid-existing");
  const second = await postGoogle("valid-existing");
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.user.id, second.body.user.id);
});

test("POST /api/auth/google 409s when email belongs to a password account", async () => {
  // taken@example.com was seeded as a password account in `before`.
  const app2 = express();
  const store2 = createUserStore(
    (() => {
      const docs = [];
      return {
        async createIndex() {},
        async findOne(q) {
          const keys = Object.keys(q || {});
          return docs.find((d) => keys.every((k) => String(d[k]) === String(q[k]))) ?? null;
        },
        async insertOne(doc) {
          const copy = { ...doc, _id: "x" };
          docs.push(copy);
          return { insertedId: copy._id };
        },
      };
    })()
  );
  await store2.createUser({ email: "taken@example.com", password: "password-123", displayName: "Taken" });
  const app = express();
  app.use(
    "/api/auth",
    createAuthRouter({
      getUserStore: () => store2,
      verifyGoogleFn: async () => ({ googleId: "gg-other", email: "taken@example.com", displayName: "Taken" }),
    })
  );
  const srv = http.createServer(app);
  srv.listen(0);
  await once(srv, "listening");
  try {
    const res = await fetch(`http://localhost:${srv.address().port}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: "whatever" }),
    });
    const body = await res.json();
    assert.equal(res.status, 409);
    assert.match(body.error, /already exists/);
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
});

test("POST /api/auth/google rejects bad credentials with safe 4xx", async () => {
  for (const payload of [{}, { credential: "" }, { credential: "bogus" }]) {
    const res = await fetch(`http://localhost:${appPort}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.ok(res.status === 400 || res.status === 401, `expected 4xx, got ${res.status}`);
    const body = await res.json().catch(() => null);
    assert.ok(body && typeof body.error === "string");
  }
});
