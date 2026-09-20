/**
 * routes.cjs — authentication HTTP API (mounted at /api/auth).
 *
 *   POST /api/auth/signup  { email, password, displayName } -> 201 { user, token }
 *   POST /api/auth/login   { email, password }              -> 200 { user, token }
 *   POST /api/auth/google  { credential }                   -> 200 { user, token }
 *   GET  /api/auth/me                                           -> 200 { user } (Bearer JWT)
 *
 * Only safe user objects ({ id, email, displayName, createdAt,
 * updatedAt }) ever leave the server — passwordHash is never returned.
 * Login failures use one generic message so callers cannot tell an
 * unknown email from a wrong password.
 */

const express = require("express");
const { signToken } = require("./tokens.cjs");
const { createAuthMiddleware } = require("./middleware.cjs");
const { verifyGoogleIdToken } = require("./google.cjs");

/**
 * Build the router with injectable dependencies (store + token fns +
 * Google verifier default to production implementations). Injection keeps
 * tests hermetic (no Google network calls).
 */
function createAuthRouter({ getUserStore, signTokenFn, requireAuth, verifyGoogleFn } = {}) {
  const resolveStore = getUserStore || require("../db/users.cjs").getUserStore;
  const sign = signTokenFn || signToken;
  const verifyGoogle = verifyGoogleFn || verifyGoogleIdToken;
  const auth = requireAuth || createAuthMiddleware({ getUserStore: resolveStore });
  const router = express.Router();

  router.use(express.json({ limit: "64kb" }));

  function store503(res) {
    return res.status(503).json({ error: "Authentication service unavailable. Try again shortly." });
  }

  // getUserStore() throws while the initial connection is still in
  // flight — await it once instead of failing cold-start requests.
  async function readyStore() {
    try {
      return resolveStore();
    } catch {
      const { connectMongo } = require("../db/mongodb.cjs");
      await connectMongo();
      return resolveStore();
    }
  }

  async function withStore(res, fn) {
    let store;
    try {
      store = await readyStore();
    } catch {
      return store503(res);
    }
    try {
      return await fn(store);
    } catch {
      return store503(res);
    }
  }

  router.post("/signup", async (req, res) => {
    return withStore(res, async (store) => {
      let user;
      try {
        user = await store.createUser({
          email: req.body && req.body.email,
          password: req.body && req.body.password,
          displayName: req.body && req.body.displayName,
        });
      } catch (err) {
        if (err && err.code === "DUPLICATE_EMAIL") {
          return res.status(409).json({ error: "An account with this email already exists." });
        }
        if (err && err.code === "VALIDATION_ERROR") {
          return res.status(400).json({ error: err.message });
        }
        throw err;
      }
      const token = sign(user);
      return res.status(201).json({ user, token });
    });
  });

  router.post("/login", async (req, res) => {
    return withStore(res, async (store) => {
      const email = req.body && req.body.email;
      const password = req.body && req.body.password;
      const doc = await store.findByEmail(email).catch(() => null);
      const ok = doc ? await store.verifyPassword(doc, password).catch(() => false) : false;
      if (!ok) {
        // Generic on purpose: unknown email and wrong password look alike.
        return res.status(401).json({ error: "Invalid email or password." });
      }
      const user = store.toSafeUser(doc);
      const token = sign(user);
      return res.status(200).json({ user, token });
    });
  });

  router.get("/me", auth, (req, res) => {
    return res.status(200).json({ user: req.user });
  });

  /**
   * Google Sign-In: { credential } (Google ID token) -> 200 { user, token }.
   * The token is verified cryptographically; identity comes ONLY from the
   * verified payload (never from sibling request fields). The issued token
   * is the same Axlero JWT as password login (signToken) — one session
   * system, no Google-specific JWT.
   *
   * - Known googleId            → log in.
   * - Unknown googleId + new email → create a Google-backed account.
   * - Unknown googleId + taken email → 409, no silent merge (account
   *   linking is explicitly out of scope).
   */
  router.post("/google", async (req, res) => {
    return withStore(res, async (store) => {
      const credential = req.body && req.body.credential;
      if (typeof credential !== "string" || credential.trim().length === 0) {
        return res.status(400).json({ error: "Google credential is required." });
      }
      let verified;
      try {
        verified = await verifyGoogle(credential);
      } catch {
        return res.status(401).json({ error: "Invalid Google credential." });
      }
      const existing = await store.findByGoogleId(verified.googleId).catch(() => null);
      if (existing) {
        const user = store.toSafeUser(existing);
        return res.status(200).json({ user, token: sign(user) });
      }
      try {
        const user = await store.createGoogleUser({
          googleId: verified.googleId,
          email: verified.email,
          displayName: verified.displayName,
        });
        return res.status(200).json({ user, token: sign(user) });
      } catch (err) {
        if (err && err.code === "DUPLICATE_EMAIL") {
          return res.status(409).json({ error: err.message });
        }
        if (err && (err.code === "DUPLICATE_GOOGLE_ID" || err.code === "VALIDATION_ERROR")) {
          return res.status(409).json({ error: err.message });
        }
        throw err;
      }
    });
  });

  return router;
}

module.exports = { createAuthRouter };
