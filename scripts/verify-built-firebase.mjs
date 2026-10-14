/**
 * verify-built-firebase.mjs — confirm the built bundle carries the complete
 * expected Firebase client configuration (all six fields, not just the
 * project ID).
 *
 * Vite bakes VITE_* values into the bundle at build time. A production
 * build with missing or partial Firebase secrets ships broken
 * authentication, so this script checks the emitted `dist` JavaScript for
 * every expected Firebase value and fails loudly when any is absent. Only
 * field names and found/missing status are reported — configuration values
 * are never printed.
 *
 * Usage:
 *   node scripts/verify-built-firebase.mjs <distDir>
 *
 * Reads the six VITE_FIREBASE_* variables from the environment. Exits 0
 * when all present values are found, 1 when any expected value is missing
 * from the environment or absent from the bundle, 2 on usage errors.
 * Pure helpers are exported for unit tests.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const FIREBASE_BUNDLE_FIELDS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

export function resolveExpectedProjectId(env = {}) {
  const value = typeof env.VITE_FIREBASE_PROJECT_ID === 'string' ? env.VITE_FIREBASE_PROJECT_ID.trim() : '';
  return value;
}

/** Non-empty expected Firebase values keyed by field name (names only out). */
export function resolveExpectedFirebaseConfig(env = {}) {
  const out = {};
  for (const key of FIREBASE_BUNDLE_FIELDS) {
    const value = typeof env[key] === 'string' ? env[key].trim() : '';
    if (value) out[key] = value;
  }
  return out;
}

function collectJsFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) collectJsFiles(full, out);
    else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * True when any emitted JS chunk contains the expected Firebase project
 * ID. Pure except for filesystem reads; never returns file contents.
 */
export function builtBundleContainsFirebaseProject(distDir, projectId) {
  if (typeof projectId !== 'string' || projectId.trim().length === 0) return false;
  const needle = projectId.trim();
  for (const file of collectJsFiles(distDir)) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (text.includes(needle)) return true;
  }
  return false;
}

/**
 * Check every expected Firebase value against the bundle. Returns
 * `{ ok: true }` or `{ ok: false, missing: [fieldNames] }` — field names
 * only, never values. A project ID alone is NOT sufficient proof: all six
 * configured values must be present.
 */
export function verifyBuiltFirebaseConfig(distDir, expected = {}) {
  const missing = [];
  for (const [key, value] of Object.entries(expected)) {
    if (!builtBundleContainsFirebaseProject(distDir, value)) missing.push(key);
  }
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true };
}

const isMainModule =
  typeof process !== 'undefined' &&
  process.argv &&
  process.argv[1] &&
  process.argv[1].replace(/\\/g, '/').endsWith('scripts/verify-built-firebase.mjs');

if (isMainModule) {
  const distDir = process.argv[2];
  if (!distDir) {
    console.error('Usage: node scripts/verify-built-firebase.mjs <distDir>');
    process.exit(2);
  }
  const expected = resolveExpectedFirebaseConfig(process.env);
  const unconfigured = FIREBASE_BUNDLE_FIELDS.filter((key) => !(key in expected));
  if (unconfigured.length > 0) {
    console.error(
      `verify-built-firebase: Firebase configuration incomplete in environment (${unconfigured.join(', ')}) — refusing to publish.`,
    );
    process.exit(1);
  }
  const result = verifyBuiltFirebaseConfig(distDir, expected);
  if (!result.ok) {
    console.error(
      `verify-built-firebase: built bundle is missing Firebase configuration (${result.missing.join(', ')}) — refusing to publish.`,
    );
    process.exit(1);
  }
  console.log('verify-built-firebase: built bundle contains the complete Firebase configuration.');
}
