/**
 * cors.cjs — Express CORS origin policy (no HTTP, no DB).
 *
 * Production stays explicit: only origins listed in FRONTEND_ORIGIN are
 * allowed. Development is robust to Vite picking any free port (5173,
 * 5174, 5175, ...): any http(s) localhost/loopback origin is allowed
 * while NOT in production.
 *
 * No wildcard is ever used, and the app sends no cookies/credentials
 * (JWT travels in the Authorization header), so reflecting a validated
 * origin is safe.
 */

function normalizeOrigin(origin) {
  if (typeof origin !== "string") return "";
  return origin.trim().replace(/\/+$/, "");
}

/**
 * True for loopback origins on any port: http(s)://localhost[:port],
 * http(s)://127.0.0.1[:port], http(s)://[::1][:port]. Vite dev servers,
 * mobile emulators resolving host loopback, and LAN-dev setups that hit
 * the loopback interface all fall under this rule. Never matches
 * non-loopback hosts (e.g. attacker.example.com), regardless of port.
 */
function isLocalhostOrigin(origin) {
  const clean = normalizeOrigin(origin);
  if (!clean) return false;
  let url;
  try {
    url = new URL(clean);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  // URL keeps IPv6 literals bracketed ("[::1]") — strip them for comparison.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * Parse a comma-separated FRONTEND_ORIGIN value into a clean list.
 * Exported for tests and for server startup logging.
 */
function parseAllowedOrigins(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => normalizeOrigin(s))
    .filter(Boolean);
}

/**
 * True when running in a production deployment. Checks BOTH signals
 * because Render.com does not guarantee NODE_ENV=production on every
 * service, but it always sets RENDER=true on hosted services:
 *
 * - NODE_ENV === "production" → production (explicit).
 * - RENDER === "true"         → production (Render-hosted service).
 * - anything else             → development (local dev, CI, tests).
 *
 * Exported for tests. Accepts an env-like object for hermetic testing.
 */
function isProductionEnv(env = process.env) {
  if (!env || typeof env !== "object") return false;
  if (env.NODE_ENV === "production") return true;
  if (env.RENDER === "true") return true;
  return false;
}

/**
 * Build the origin predicate used by the `cors` middleware.
 *
 * @param {string[]} allowedOrigins - explicit production origins (exact match).
 * @param {object} [options]
 * @param {boolean} [options.allowLocalhost] - allow any loopback origin.
 *   Defaults to true in development, false in production (see
 *   isProductionEnv). Explicitly pass a boolean to override.
 * @returns {(origin: string|undefined) => boolean}
 *
 * Requests without an Origin header (curl, server-to-server, native apps)
 * are always allowed — CORS is a browser mechanism and there is nothing
 * to restrict.
 */
function createOriginChecker(allowedOrigins, options = {}) {
  const allowed = new Set(
    (Array.isArray(allowedOrigins) ? allowedOrigins : []).map(normalizeOrigin).filter(Boolean)
  );
  const allowLocalhost =
    typeof options.allowLocalhost === "boolean" ? options.allowLocalhost : !isProductionEnv();

  return function isOriginAllowed(origin) {
    if (!origin) return true;
    const clean = normalizeOrigin(origin);
    if (allowed.has(clean)) return true;
    if (allowLocalhost && isLocalhostOrigin(clean)) return true;
    return false;
  };
}

/**
 * Adapter from the predicate above to the `cors` package's
 * `origin: (origin, callback) => void` shape.
 */
function createCorsDelegate(isOriginAllowed) {
  return function corsOrigin(origin, callback) {
    let allowed = false;
    try {
      allowed = isOriginAllowed(origin);
    } catch {
      allowed = false;
    }
    if (allowed) {
      callback(null, true);
    } else {
      callback(new Error("Origin not allowed by CORS policy."));
    }
  };
}

module.exports = {
  normalizeOrigin,
  isLocalhostOrigin,
  parseAllowedOrigins,
  isProductionEnv,
  createOriginChecker,
  createCorsDelegate,
};
