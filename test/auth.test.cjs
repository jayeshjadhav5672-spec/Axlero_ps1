/**
 * auth.test.cjs — authentication foundation tests (no database, no network).
 * Uses an in-memory fake user store behind the real store factory shape,
 * plus live HTTP tests against an express app wiring the real router.
 * JWT uses a throwaway test secret confined to this process.
 */
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { after, before, test } = require("node:test");

process.env.JWT_SECRET = "test-only-secret-0123456789abcdef";
process.env.JWT_EXPIRES_IN = "1h";

const bcrypt = require("bcryptjs");
const express = require("express");
const { createUserStore, toSafeUser } = require("../server/db/users.cjs");
const { signToken, verifyToken } = require("../server/auth/tokens.cjs");
const { createAuthMiddleware } = require("../server/auth/middleware.cjs");
const { createAuthRouter } = require("../server/auth/routes.cjs");

/** Minimal in-memory collection supporting the store's needs. */
function fakeCollection() {
  const docs = [];
  let seq = 0;
  return {
    __docs: docs,
    async createIndex() {
      return "email_1";
    },
    async findOne(query) {
      const keys = Object.keys(query || {});
      return docs.find((d) => keys.every((k) => String(d[k]) === String(query[k]))) ?? null;
    },
    async insertOne(doc) {
      if (docs.some((d) => d.email === doc.email)) {
        const err = new Error("duplicate key");
        err.code = 11000;
        throw err;
      }
      const copy = { ...doc, _id: `test-id-${++seq}` };
      docs.push(copy);
      return { insertedId: copy._id };
    },
  };
}

const asBody = (res) => res.json();

test("passwords are hashed with bcrypt and never stored plaintext", async () => {
  const store = createUserStore(fakeCollection());
  await store.ensureIndexes();
  const created = await store.createUser({
    email: "Ada@Example.COM ",
    password: "correct-horse-123",
    displayName: "Ada",
  });
  assert.equal(created.email, "ada@example.com");
  assert.ok(!("passwordHash" in created));
  const raw = await store.findByEmail("ada@example.com");
  assert.ok(raw.passwordHash.startsWith("$2"));
  assert.notEqual(raw.passwordHash, "correct-horse-123");
  assert.equal(await store.verifyPassword(raw, "correct-horse-123"), true);
  assert.equal(await store.verifyPassword(raw, "wrong-password"), false);
  assert.equal(await store.verifyPassword(null, "x"), false);
});

test("duplicate email rejected (case-insensitive)", async () => {
  const store = createUserStore(fakeCollection());
  await store.createUser({ email: "a@b.co", password: "password-123", displayName: "A" });
  await assert.rejects(
    store.createUser({ email: "A@B.CO", password: "password-123", displayName: "A2" }),
    /already exists/
  );
});

test("signup validation rejects bad input", async () => {
  const store = createUserStore(fakeCollection());
  await assert.rejects(store.createUser({ email: "bad", password: "password-123", displayName: "A" }), /valid email/);
  await assert.rejects(store.createUser({ email: "a@b.co", password: "short", displayName: "A" }), /at least 8/);
  await assert.rejects(store.createUser({ email: "a@b.co", password: "password-123", displayName: "  " }), /Display name/);
});

test("toSafeUser never exposes passwordHash", () => {
  const safe = toSafeUser({ _id: "1", email: "a@b.co", passwordHash: "secret", displayName: "A" });
  assert.deepEqual(Object.keys(safe).sort(), ["createdAt", "displayName", "email", "id", "updatedAt"]);
});

test("JWT round-trips minimal identity; invalid/expired/malformed rejected", async () => {
  const token = signToken({ id: "u1", email: "a@b.co", displayName: "A" });
  const payload = verifyToken(token);
  assert.equal(payload.sub, "u1");
  assert.equal(payload.email, "a@b.co");
  assert.ok(!("passwordHash" in payload));
  assert.throws(() => verifyToken(token + "tampered"), /Invalid authentication token/);
  assert.throws(() => verifyToken("not-a-jwt"), /Invalid authentication token/);
  assert.throws(() => verifyToken(""), /Invalid authentication token/);
  const short = require("jsonwebtoken").sign({ sub: "u1" }, process.env.JWT_SECRET, { expiresIn: "1s" });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.throws(() => verifyToken(short), /Invalid authentication token/);
});

test("middleware rejects missing/malformed/invalid tokens, loads user", async () => {
  const store = createUserStore(fakeCollection());
  const created = await store.createUser({ email: "m@x.io", password: "password-123", displayName: "M" });
  const mw = createAuthMiddleware({ getUserStore: () => store });
  const run = (headers) =>
    new Promise((resolve) => {
      const req = { headers };
      const res = {
        status(code) {
          return { json: (body) => resolve({ code, body }) };
        },
      };
      mw(req, res, () => resolve({ code: 200, req }));
    });
  assert.equal((await run({})).code, 401);
  assert.equal((await run({ authorization: "Bearer nope" })).code, 401);
  const good = await run({ authorization: `Bearer ${signToken(created)}` });
  assert.equal(good.code, 200);
  assert.equal(good.req.user.email, "m@x.io");
  assert.ok(!("passwordHash" in good.req.user));
});

// ---- HTTP-level route tests (real express app, fake store) ----

let appServer;
let appPort;
let authedFetch;

before(async () => {
  const store = createUserStore(fakeCollection());
  const app = express();
  app.use("/api/auth", createAuthRouter({ getUserStore: () => store }));
  appServer = http.createServer(app);
  appServer.listen(0);
  await once(appServer, "listening");
  appPort = appServer.address().port;
  authedFetch = async (path, opts = {}) => {
    const res = await fetch(`http://localhost:${appPort}${path}`, {
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
});

after(async () => {
  await new Promise((resolve) => appServer.close(resolve));
});

test("POST /api/auth/signup validates, dedupes, and returns user+token", async () => {
  const bad = await authedFetch("/api/auth/signup", { method: "POST", body: JSON.stringify({ email: "x" }) });
  assert.equal(bad.status, 400);
  const created = await authedFetch("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email: "HTTP@Example.com", password: "password-123", displayName: "HTTP" }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.email, "http@example.com");
  assert.ok(created.body.token);
  assert.ok(!("passwordHash" in created.body.user));
  const dup = await authedFetch("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email: "http@example.com", password: "password-123", displayName: "Other" }),
  });
  assert.equal(dup.status, 409);
});

test("POST /api/auth/login uses one generic failure for unknown/wrong", async () => {
  const unknown = await authedFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "nobody@nowhere.dev", password: "whatever-123" }),
  });
  assert.equal(unknown.status, 401);
  const wrong = await authedFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "http@example.com", password: "wrong-pass-1" }),
  });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.body.error, wrong.body.error);
  const ok = await authedFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "http@example.com", password: "password-123" }),
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token && ok.body.user);
  assert.ok(!("passwordHash" in ok.body.user));
});

test("GET /api/auth/me requires a live user behind a valid token", async () => {
  const anon = await authedFetch("/api/auth/me");
  assert.equal(anon.status, 401);
  const login = await authedFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "http@example.com", password: "password-123" }),
  });
  const me = await authedFetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${login.body.token}` },
  });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, "http@example.com");
  const bad = await authedFetch("/api/auth/me", { headers: { Authorization: "Bearer deadbeef" } });
  assert.equal(bad.status, 401);
});
