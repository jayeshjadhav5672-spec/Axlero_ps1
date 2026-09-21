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
const crypto = require("node:crypto");
const { signToken } = require("./tokens.cjs");
const { createAuthMiddleware } = require("./middleware.cjs");
const { verifyGoogleIdToken } = require("./google.cjs");

const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_STATE_COOKIE = "syncspace_oauth_state";
const STATE_TTL_MS = 5 * 60 * 1000;
const GRANT_TTL_MS = 5 * 60 * 1000;

/** Frontend base URL for post-OAuth redirects (configurable, never from request headers). */
function frontendOrigin() {
  const raw = typeof process.env.FRONTEND_ORIGIN === "string" ? process.env.FRONTEND_ORIGIN : "";
  const clean = raw.trim().replace(/\/+$/, "");
  return clean || "http://localhost:5173";
}

function readGoogleOAuthConfig() {
  const clientId = typeof process.env.GOOGLE_CLIENT_ID === "string" ? process.env.GOOGLE_CLIENT_ID.trim() : "";
  const clientSecret = typeof process.env.GOOGLE_CLIENT_SECRET === "string" ? process.env.GOOGLE_CLIENT_SECRET : "";
  const redirectUri =
    typeof process.env.GOOGLE_REDIRECT_URI === "string" ? process.env.GOOGLE_REDIRECT_URI.trim() : "";
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google Sign-In is not configured on the server.");
  }
  return { clientId, clientSecret, redirectUri };
}

// Pending OAuth states: state -> createdAt. Single-use: consumed (deleted)
// exactly once during callback validation. In-memory by design (dev-scale;
// a distributed deployment would move this to shared storage).
const pendingOAuthStates = new Map();

function issueOAuthState() {
  const state = crypto.randomBytes(24).toString("hex");
  pendingOAuthStates.set(state, Date.now());
  return state;
}

function consumeOAuthState(state) {
  const createdAt = pendingOAuthStates.get(state);
  pendingOAuthStates.delete(state);
  return typeof createdAt === "number" && Date.now() - createdAt <= STATE_TTL_MS;
}

// Single-use session grants: grant -> { userId, exp }. The callback mints
// one per successful login; the frontend redeems it exactly once at
// POST /google/consume for the Axlero session. Google tokens never
// travel to the browser through this mechanism.
const sessionGrants = new Map();

function issueSessionGrant(userId) {
  const grant = crypto.randomBytes(24).toString("hex");
  sessionGrants.set(grant, { userId, exp: Date.now() + GRANT_TTL_MS });
  return grant;
}

function consumeSessionGrant(grant) {
  const entry = sessionGrants.get(grant);
  sessionGrants.delete(grant);
  if (!entry || entry.exp <= Date.now()) return null;
  return entry.userId;
}

function readCookie(req, name) {
  try {
    const header = req && req.headers ? req.headers.cookie : null;
    if (typeof header !== "string") return null;
    for (const part of header.split(";")) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
    }
  } catch {
    // ignore malformed cookie headers
  }
  return null;
}

function buildAuthorizationUrl() {
  const { clientId, redirectUri } = readGoogleOAuthConfig();
  const state = issueOAuthState();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
    state,
  });
  return { url: `${OAUTH_AUTH_URL}?${params.toString()}`, state };
}

/**
 * Exchange an authorization code for tokens at Google's token endpoint.
 * Returns the parsed token response; only `id_token` is ever used by
 * callers — access/refresh tokens are discarded, never stored or returned.
 */
async function exchangeGoogleCode({ code }) {
  const { clientId, clientSecret, redirectUri } = readGoogleOAuthConfig();
  if (typeof code !== "string" || !code) throw new Error("Invalid authorization code.");
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  let response;
  try {
    response = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch {
    throw new Error("Google token exchange failed.");
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok || !data || typeof data.id_token !== "string" || !data.id_token) {
    throw new Error("Google token exchange failed.");
  }
  return data;
}

/**
 * Build the router with injectable dependencies (store + token fns +
 * Google verifier/exchanger default to production implementations).
 * Injection keeps tests hermetic (no Google network calls).
 */
function createAuthRouter({ getUserStore, signTokenFn, requireAuth, verifyGoogleFn, exchangeCodeFn } = {}) {
  const resolveStore = getUserStore || require("../db/users.cjs").getUserStore;
  const sign = signTokenFn || signToken;
  const verifyGoogle = verifyGoogleFn || verifyGoogleIdToken;
  const exchangeCode = exchangeCodeFn || exchangeGoogleCode;
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

  // Variant for flows that need the outcome value (OAuth callback):
  // resolves { ok, value } or { ok:false } instead of responding.
  async function withStoreValue(fn) {
    let store;
    try {
      store = await readyStore();
    } catch {
      return { ok: false };
    }
    try {
      return { ok: true, value: await fn(store) };
    } catch {
      return { ok: false };
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
   * Google Sign-In (OAuth 2.0 authorization-code flow):
   *   GET  /api/auth/google          -> 302 to Google (state in httpOnly cookie)
   *   GET  /api/auth/google/callback -> validates state, exchanges code
   *        server-side, verifies identity, then 302s to the frontend with
   *        a short-lived single-use grant (?code=...)
   *   POST /api/auth/google/consume  { code } -> 200 { user, token }
   * The issued token is the same Axlero JWT as password login (signToken)
   * — one session system, no Google-specific JWT. Google access/refresh
   * tokens are discarded immediately and never stored or returned.
   *
   * - Known googleId            → log in.
   * - Unknown googleId + new email → create a Google-backed account.
   * - Unknown googleId + taken email → 409, no silent merge (account
   *   linking is explicitly out of scope).
   */
  router.get("/google", (req, res) => {
    let authUrl;
    try {
      const { url, state } = buildAuthorizationUrl();
      authUrl = url;
      res.setHeader(
        "Set-Cookie",
        `${OAUTH_STATE_COOKIE}=${state}; Max-Age=${Math.floor(STATE_TTL_MS / 1000)}; Path=/api/auth/google; HttpOnly; SameSite=Lax`
      );
    } catch {
      return res.status(503).json({ error: "Google Sign-In is not configured." });
    }
    return res.redirect(authUrl);
  });

  router.get("/google/callback", async (req, res) => {
    const fail = (code) => res.redirect(`${frontendOrigin()}/?authError=${code}`);
    try {
      if (req.query && req.query.error) return fail("access_denied");
      const queryState = typeof req.query?.state === "string" ? req.query.state : null;
      const cookieState = readCookie(req, OAUTH_STATE_COOKIE);
      if (!queryState || !cookieState || queryState !== cookieState || !consumeOAuthState(queryState)) {
        return fail("state_mismatch");
      }
      const code = typeof req.query?.code === "string" && req.query.code ? req.query.code : null;
      if (!code) return fail("missing_code");
      let tokens;
      try {
        tokens = await exchangeCode({ code });
      } catch {
        return fail("exchange_failed");
      }
      if (!tokens || typeof tokens.id_token !== "string" || !tokens.id_token) {
        return fail("invalid_identity");
      }
      let verified;
      try {
        verified = await verifyGoogle(tokens.id_token);
      } catch {
        return fail("invalid_identity");
      }
      const outcome = await withStoreValue(async (store) => {
        const existing = await store.findByGoogleId(verified.googleId).catch(() => null);
        if (existing) return { user: store.toSafeUser(existing) };
        try {
          const created = await store.createGoogleUser({
            googleId: verified.googleId,
            email: verified.email,
            displayName: verified.displayName,
          });
          return { user: created };
        } catch (err) {
          if (err && err.code === "DUPLICATE_EMAIL") {
            return { conflict: err.message };
          }
          if (err && (err.code === "DUPLICATE_GOOGLE_ID" || err.code === "VALIDATION_ERROR")) {
            return { conflict: err.message };
          }
          throw err;
        }
      });
      if (!outcome.ok) return fail("server_error");
      const result = outcome.value || {};
      if (result.conflict) return fail("account_conflict");
      if (!result.user) return fail("invalid_identity");
      const grant = issueSessionGrant(result.user.id);
      return res.redirect(`${frontendOrigin()}/?code=${grant}`);
    } catch {
      return fail("server_error");
    }
  });

  router.post("/google/consume", async (req, res) => {
    const code = req.body && req.body.code;
    if (typeof code !== "string" || !code) {
      return res.status(400).json({ error: "Authorization grant is required." });
    }
    const userId = consumeSessionGrant(code);
    if (!userId) {
      return res.status(400).json({ error: "Invalid or expired grant." });
    }
    return withStore(res, async (store) => {
      const doc = await store.findById(userId).catch(() => null);
      if (!doc) {
        return res.status(401).json({ error: "Invalid or expired grant." });
      }
      const user = store.toSafeUser(doc);
      return res.status(200).json({ user, token: sign(user) });
    });
  });

  return router;
}

module.exports = { createAuthRouter };
