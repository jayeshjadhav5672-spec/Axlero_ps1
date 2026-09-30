/**
 * tokens.js — JWT issuance/verification (no HTTP, no DB).
 *
 * Payload is minimal identity only: { sub, email, displayName }.
 * Never place passwords, hashes, database credentials, or anything
 * else sensitive in the token.
 */

const jwt = require("jsonwebtoken");

function readSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || typeof secret !== "string" || secret.trim().length < 16) {
    throw new Error("JWT_SECRET is not configured. Set a random secret of at least 16 characters.");
  }
  return secret;
}

function readExpiry() {
  const raw = process.env.JWT_EXPIRES_IN;
  if (!raw || typeof raw !== "string" || raw.trim().length === 0) return "7d";
  return raw.trim();
}

/** Sign a token for a safe user object ({ id, email, displayName }). */
function signToken(user) {
  if (!user || (typeof user.id !== "string" && typeof user.id !== "number")) {
    throw new Error("signToken requires a user with an id.");
  }
  return jwt.sign(
    { sub: String(user.id), email: user.email ?? null, displayName: user.displayName ?? null },
    readSecret(),
    { expiresIn: readExpiry() }
  );
}

/**
 * Verify a token. Returns the decoded payload ({ sub, email,
 * displayName, iat, exp }) or throws a generic error — raw
 * jsonwebtoken messages (expired/malformed/signature) are never
 * propagated so callers cannot leak internals or distinguish cases
 * beyond what the HTTP layer already declares.
 */
function verifyToken(token) {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new Error("Invalid authentication token.");
  }
  try {
    return jwt.verify(token.trim(), readSecret());
  } catch {
    throw new Error("Invalid authentication token.");
  }
}

module.exports = { signToken, verifyToken };
