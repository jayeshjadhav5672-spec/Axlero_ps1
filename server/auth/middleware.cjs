/**
 * middleware.js — JWT authentication middleware for Express.
 *
 * Flow: Authorization: Bearer <JWT> -> extract -> verify signature +
 * expiry -> load user from MongoDB -> attach req.user -> next().
 * Any failure responds 401 with a generic message (no raw JWT errors,
 * no user-enumeration detail beyond what each route declares).
 */

const { verifyToken } = require("./tokens.cjs");

/** Extract a Bearer token from the Authorization header (null when absent). */
function extractBearerToken(req) {
  try {
    const header = req && req.headers ? req.headers.authorization : null;
    if (typeof header !== "string") return null;
    const [scheme, token] = header.split(" ");
    if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
    return token;
  } catch {
    return null;
  }
}

/**
 * Build the middleware with an injected user store (defaults to the real
 * MongoDB store). Injection keeps tests deterministic without a database.
 */
function createAuthMiddleware({ getUserStore } = {}) {
  const resolveStore = getUserStore || require("../db/users.cjs").getUserStore;

  return async function requireAuth(req, res, next) {
    try {
      const token = extractBearerToken(req);
      if (!token) {
        return res.status(401).json({ error: "Authentication required." });
      }
      let payload;
      try {
        payload = verifyToken(token);
      } catch {
        return res.status(401).json({ error: "Authentication required." });
      }
      if (!payload || (typeof payload.sub !== "string" && typeof payload.sub !== "number")) {
        return res.status(401).json({ error: "Authentication required." });
      }
      let store;
      try {
        store = resolveStore();
      } catch {
        // Cold start: the initial connection may still be in flight —
        // await it once instead of failing the request.
        try {
          const { connectMongo } = require("../db/mongodb.cjs");
          await connectMongo();
          store = resolveStore();
        } catch {
          return res.status(503).json({ error: "Authentication service unavailable." });
        }
      }
      const doc = await store.findById(payload.sub);
      if (!doc) {
        return res.status(401).json({ error: "Authentication required." });
      }
      req.user = store.toSafeUser(doc);
      req.auth = { userId: String(payload.sub) };
      return next();
    } catch {
      return res.status(401).json({ error: "Authentication required." });
    }
  };
}

module.exports = { createAuthMiddleware, extractBearerToken };
