/**
 * validate-frontend-env.mjs — fail-closed production config validation.
 *
 * Vite injects VITE_* values at BUILD time: a production bundle built
 * without a backend URL silently falls back to http://localhost:3000 and
 * ships a broken app. This script fails loudly (exit 1) instead, with an
 * actionable message that never prints secret values.
 *
 * Usage (CI production jobs only — never gate local dev builds):
 *   node scripts/validate-frontend-env.mjs --production
 *
 * Reads process.env: VITE_BACKEND_URL (preferred) or
 * VITE_SYNCSPACE_SERVER_URL (legacy alias), plus the six frontend
 * Firebase fields. Pure validators are exported for unit tests.
 */

const FIREBASE_FIELDS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

function isLoopbackHostname(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  if (host === 'localhost') return true;
  if (host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;
  if (host.startsWith('127.')) return true;
  if (host === '0.0.0.0' || host === '[::]') return true;
  return false;
}

/**
 * Validate a backend URL for production use. Returns
 * { ok: true, url } or { ok: false, reason } (reason never echoes input).
 */
export function validateBackendUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return {
      ok: false,
      reason: 'missing backend URL: set VITE_BACKEND_URL (or VITE_SYNCSPACE_SERVER_URL) to the public backend URL',
    };
  }
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return { ok: false, reason: 'malformed backend URL: must be an absolute http(s) URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'backend URL must use http or https' };
  }
  if (isLoopbackHostname(parsed.hostname)) {
    return {
      ok: false,
      reason: 'backend URL points to localhost/loopback: production builds must target the public backend URL',
    };
  }
  return { ok: true, url: parsed.toString() };
}

/** Resolve the effective backend URL from an env-like object (alias last). */
export function resolveBackendUrl(env = {}) {
  const primary = typeof env.VITE_BACKEND_URL === 'string' ? env.VITE_BACKEND_URL.trim() : '';
  if (primary) return primary;
  const alias = typeof env.VITE_SYNCSPACE_SERVER_URL === 'string' ? env.VITE_SYNCSPACE_SERVER_URL.trim() : '';
  return alias;
}

/**
 * Validate the six Firebase fields. Returns { ok: true } or
 * { ok: false, missing: [...] } (names only, never values).
 */
export function validateFirebaseConfig(env = {}) {
  const missing = FIREBASE_FIELDS.filter(
    (key) => typeof env[key] !== 'string' || env[key].trim().length === 0,
  );
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true };
}

/**
 * Validate the optional split overrides when present. VITE_WS_URL feeds
 * Socket.IO and VITE_API_URL feeds HTTP auth; a localhost override would
 * silently redirect production traffic at runtime, so present values must
 * be valid non-loopback URLs. Absent overrides are fine (callers fall
 * back to the backend URL). Returns an array of error strings (possibly
 * empty; never echoes values).
 */
export function validateOptionalOverrides(env = {}) {
  const errors = [];
  for (const key of ['VITE_WS_URL', 'VITE_API_URL']) {
    const raw = typeof env[key] === 'string' ? env[key].trim() : '';
    if (!raw) continue;
    // Socket.IO accepts ws(s):// (normalized to http(s) at runtime);
    // validate the mapped form so the README's wss:// advice passes.
    const mapped = raw.replace(/^ws(s)?:\/\//i, (m) => (m.toLowerCase().startsWith('wss') ? 'https://' : 'http://'));
    const checked = validateBackendUrl(mapped);
    if (!checked.ok) errors.push(`${key}: ${checked.reason}`);
  }
  return errors;
}

/** Full production gate. Returns { ok, errors: [] } (no secret values). */
export function validateProductionEnv(env = process.env) {
  const errors = [];
  const backend = validateBackendUrl(resolveBackendUrl(env));
  if (!backend.ok) errors.push(backend.reason);
  const firebase = validateFirebaseConfig(env);
  if (!firebase.ok) errors.push(`missing Firebase configuration: ${firebase.missing.join(', ')}`);
  errors.push(...validateOptionalOverrides(env));
  return { ok: errors.length === 0, errors };
}

const isMainModule =
  typeof process !== 'undefined' &&
  process.argv &&
  process.argv[1] &&
  process.argv[1].replace(/\\/g, '/').endsWith('scripts/validate-frontend-env.mjs');

if (isMainModule) {
  const production = process.argv.includes('--production');
  if (!production) {
    console.error('Usage: node scripts/validate-frontend-env.mjs --production');
    process.exit(2);
  }
  const result = validateProductionEnv(process.env);
  if (!result.ok) {
    for (const error of result.errors) console.error(`frontend-env: ${error}`);
    console.error('frontend-env: refusing to publish a production frontend with this configuration.');
    process.exit(1);
  }
  console.log('frontend-env: production configuration valid.');
}
