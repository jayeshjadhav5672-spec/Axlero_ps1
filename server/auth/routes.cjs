/**
 * routes.cjs — authentication HTTP API (mounted at /api/auth).
 *
 *   POST /api/auth/signup  { email, password, displayName } -> 201 { user, token }
 *   POST /api/auth/login   { email, password }              -> 200 { user, token }
 *   POST /api/auth/firebase { idToken }                     -> 200 { user, token }
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
const { verifyFirebaseIdToken } = require("./firebase.cjs");

/**
 * Build the router with injectable dependencies (store + token fns +
 * Firebase verifier default to production implementations).
 * Injection keeps tests hermetic (no Firebase network calls).
 */
function createAuthRouter({ getUserStore, signTokenFn, requireAuth, verifyFirebaseFn, logWarn } = {}) {
  const resolveStore = getUserStore || require("../db/users.cjs").getUserStore;
  const sign = signTokenFn || signToken;
  const verifyFirebase = verifyFirebaseFn || verifyFirebaseIdToken;
  const auth = requireAuth || createAuthMiddleware({ getUserStore: resolveStore });
  // Server-side stage diagnostics. Logs contain stage tags only — never
  // tokens, passwords, URIs, keys, or credentials. Injectable for tests.
  const warn = typeof logWarn === "function" ? logWarn : (message) => console.warn(message);
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

  async function withStore(res, fn, stage) {
    let store;
    try {
      store = await readyStore();
    } catch {
      if (stage) warn(`[AUTH] ${stage}: store unavailable`);
      return store503(res);
    }
    try {
      return await fn(store);
    } catch {
      if (stage) warn(`[AUTH] ${stage}: handler failed`);
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
    * Firebase Authentication:
    *   POST /api/auth/firebase  { idToken } -> 200 { user, token }
    *
    * The frontend authenticates with Firebase (email/password or Google),
    * obtains a Firebase ID token, and sends it to this endpoint. The backend
    * verifies the token using Firebase Admin SDK, finds/creates the
    * Axlero user by firebaseUid, and issues the standard Axlero JWT.
    *
    * - Known firebaseUid → log in.
    * - Unknown firebaseUid + new email → create a Firebase-backed account.
    * - Unknown firebaseUid + taken email → 409, no silent merge.
    */
  router.post("/firebase", async (req, res) => {
    return withStore(res, async (store) => {
      const idToken = req.body && req.body.idToken;
      if (typeof idToken !== "string" || !idToken.trim()) {
        return res.status(400).json({ error: "Firebase ID token is required." });
      }

      let verified;
      try {
        verified = await verifyFirebase(idToken.trim());
      } catch {
        return res.status(401).json({ error: "Invalid Firebase ID token." });
      }

      const { uid, email, displayName } = verified;
      if (!uid || !email) {
        return res.status(401).json({ error: "Invalid Firebase ID token." });
      }

      function issueToken(user) {
        try {
          return sign(user);
        } catch (err) {
          warn("[AUTH] firebase exchange: token signing failed");
          throw err;
        }
      }

      // Fail closed on lookup errors (a flaky store must not be mistaken
      // for "user not found", which could otherwise create duplicates).
      let existing = null;
      try {
        existing = await store.findByFirebaseUid(uid);
      } catch (err) {
        warn("[AUTH] firebase exchange: findByFirebaseUid failed");
        throw err;
      }
      if (existing) {
        const user = store.toSafeUser(existing);
        return res.status(200).json({ user, token: issueToken(user) });
      }

      try {
        const created = await store.createFirebaseUser({
          firebaseUid: uid,
          email,
          displayName: displayName || email.split("@")[0],
        });
        return res.status(200).json({ user: created, token: issueToken(created) });
      } catch (err) {
        if (err && err.code === "DUPLICATE_EMAIL") {
          return res.status(409).json({ error: err.message });
        }
        if (err && (err.code === "DUPLICATE_FIREBASE_UID" || err.code === "VALIDATION_ERROR")) {
          return res.status(409).json({ error: err.message });
        }
        warn("[AUTH] firebase exchange: createFirebaseUser failed");
        throw err;
      }
    }, "firebase exchange");
  });

  return router;
}

module.exports = { createAuthRouter };