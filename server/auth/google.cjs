/**
 * google.cjs — Google ID-token verification (no HTTP, no DB).
 *
 * Verifies a Google Identity Services credential cryptographically and
 * returns ONLY the verified identity fields. Everything else about the
 * token is discarded: callers must never trust email/displayName/googleId
 * values sent separately from the browser.
 *
 * Checks (all required):
 * - signature valid (google-auth-library, network-verified keys)
 * - audience === GOOGLE_CLIENT_ID
 * - issuer is a Google accounts issuer
 * - not expired
 * - email present and email_verified === true
 *
 * Failures throw one generic error — raw verification details, the token
 * itself, and the client ID never leave this module in messages.
 */

const { OAuth2Client } = require("google-auth-library");

const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

// Shared client so Google's signing-key fetches stay cached across
// requests (recreated only if GOOGLE_CLIENT_ID changes, e.g. in tests).
let defaultOAuthClient = null;
let defaultOAuthClientId = null;

function readClientId() {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id || typeof id !== "string" || id.trim().length === 0) {
    throw new Error("Google Sign-In is not configured on the server.");
  }
  return id.trim();
}

function defaultClientFor(clientId) {
  if (!defaultOAuthClient || defaultOAuthClientId !== clientId) {
    defaultOAuthClient = new OAuth2Client(clientId);
    defaultOAuthClientId = clientId;
  }
  return defaultOAuthClient;
}

/**
 * Verify a Google ID token. `client` is injectable for deterministic
 * tests (must expose verifyIdToken like OAuth2Client); production uses
 * a real OAuth2Client bound to GOOGLE_CLIENT_ID.
 *
 * Resolves { googleId, email, displayName } — all from the VERIFIED
 * token payload. Rejects with a generic error otherwise.
 */
async function verifyGoogleIdToken(idToken, { client } = {}) {
  if (typeof idToken !== "string" || idToken.trim().length === 0) {
    throw new Error("Invalid Google credential.");
  }
  const expectedAud = readClientId();
  const oauth = client || defaultClientFor(expectedAud);
  let payload;
  try {
    const ticket = await oauth.verifyIdToken({ idToken: idToken.trim(), audience: expectedAud });
    payload = ticket && typeof ticket.getPayload === "function" ? ticket.getPayload() : null;
  } catch {
    throw new Error("Invalid Google credential.");
  }
  if (!payload || typeof payload !== "object") throw new Error("Invalid Google credential.");
  if (payload.aud !== expectedAud) throw new Error("Invalid Google credential.");
  if (!GOOGLE_ISSUERS.has(payload.iss)) throw new Error("Invalid Google credential.");
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || !(payload.exp > nowSec)) {
    throw new Error("Invalid Google credential.");
  }
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("Invalid Google credential.");
  if (typeof payload.email !== "string" || !payload.email) throw new Error("Invalid Google credential.");
  if (payload.email_verified !== true) throw new Error("Invalid Google credential.");
  return {
    googleId: payload.sub,
    email: payload.email,
    displayName: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : null,
  };
}

module.exports = { verifyGoogleIdToken };
