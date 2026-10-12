/**
 * verify-built-firebase.mjs — confirm the built bundle carries the expected
 * Firebase project configuration.
 *
 * Vite bakes VITE_* values into the bundle at build time. A production
 * build without Firebase secrets ships broken authentication, so this
 * script checks the emitted `dist` JavaScript for the expected Firebase
 * project ID and fails loudly when it is absent. Only found/missing status
 * is reported — configuration values are never printed.
 *
 * Usage:
 *   node scripts/verify-built-firebase.mjs <distDir>
 *
 * Reads VITE_FIREBASE_PROJECT_ID from the environment. Exits 0 when the
 * project ID is found, 1 when it is missing, 2 on usage/config errors.
 * Pure helpers are exported for unit tests.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function resolveExpectedProjectId(env = {}) {
  const value = typeof env.VITE_FIREBASE_PROJECT_ID === 'string' ? env.VITE_FIREBASE_PROJECT_ID.trim() : '';
  return value;
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
  const projectId = resolveExpectedProjectId(process.env);
  if (!projectId) {
    console.error('verify-built-firebase: VITE_FIREBASE_PROJECT_ID is not set; refusing to publish.');
    process.exit(1);
  }
  if (!builtBundleContainsFirebaseProject(distDir, projectId)) {
    console.error('verify-built-firebase: built bundle does not contain the expected Firebase project ID — refusing to publish.');
    process.exit(1);
  }
  console.log('verify-built-firebase: built bundle contains the expected Firebase project ID.');
}
