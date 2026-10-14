/**
 * verify-built-backend.mjs — confirm the built bundle targets the intended
 * public backend URL.
 *
 * Vite bakes VITE_* values into the bundle at build time. This script
 * checks the emitted `dist` JavaScript for the expected backend hostname
 * so a misconfigured build (e.g. localhost baked into a production
 * bundle) fails loudly instead of shipping. Never prints secrets: only
 * the hostname presence (found/missing) is reported.
 *
 * Usage:
 *   node scripts/verify-built-backend.mjs <distDir>
 *
 * Reads EXPECTED_BACKEND_URL (or VITE_BACKEND_URL /
 * VITE_SYNCSPACE_SERVER_URL) from the environment. Exits 0 when found,
 * 1 otherwise. Pure helpers are exported for unit tests.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function hostnameOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Resolve the expected backend URL from an env-like object (alias last). */
export function resolveExpectedBackendUrl(env = {}) {
  for (const key of ['EXPECTED_BACKEND_URL', 'VITE_BACKEND_URL', 'VITE_SYNCSPACE_SERVER_URL']) {
    const value = typeof env[key] === 'string' ? env[key].trim() : '';
    if (value) return value;
  }
  return '';
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

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when any emitted JS chunk references the expected backend hostname
 * as a whole hostname — not as a substring of a longer attacker hostname
 * (e.g. `evil-api.example.com` must NOT satisfy `api.example.com`).
 * Boundary-aware on both sides; a trailing-dot FQDN form is conservatively
 * treated as absent (fail-closed). Pure except for filesystem reads; never
 * returns file contents.
 */
export function builtBundleContainsBackend(distDir, expectedUrl) {
  const hostname = hostnameOf(expectedUrl);
  if (!hostname) return false;
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9.-])${escapeRegExp(hostname)}(?:[^A-Za-z0-9.-]|$)`);
  for (const file of collectJsFiles(distDir)) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (pattern.test(text.toLowerCase())) return true;
  }
  return false;
}

const isMainModule =
  typeof process !== 'undefined' &&
  process.argv &&
  process.argv[1] &&
  process.argv[1].replace(/\\/g, '/').endsWith('scripts/verify-built-backend.mjs');

if (isMainModule) {
  const distDir = process.argv[2];
  if (!distDir) {
    console.error('Usage: node scripts/verify-built-backend.mjs <distDir>');
    process.exit(2);
  }
  const expected = resolveExpectedBackendUrl(process.env);
  if (!expected) {
    console.error('verify-built-backend: no expected backend URL in environment (EXPECTED_BACKEND_URL or VITE_BACKEND_URL).');
    process.exit(2);
  }
  if (!builtBundleContainsBackend(distDir, expected)) {
    console.error('verify-built-backend: built bundle does not reference the intended backend host — refusing to publish.');
    process.exit(1);
  }
  console.log('verify-built-backend: built bundle references the intended backend host.');
}
