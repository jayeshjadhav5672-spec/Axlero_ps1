/**
 * firebaseConfig.js — pure Firebase client-config validation (no React,
 * no networking, no browser APIs, no import.meta access at module scope).
 *
 * Safe to import from node:test. Firebase must only initialize when ALL
 * required client-side fields are present and non-empty; anything less
 * (including a lone API key, or empty strings) means unconfigured, and
 * unconfigured Firebase must never reach initializeApp()/getAuth() —
 * getAuth() throws auth/invalid-api-key at import time, which blanked
 * the whole app even for users who never touch Firebase sign-in.
 */

export const FIREBASE_REQUIRED_KEYS = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
];

/**
 * True only when every required field is a non-empty string.
 * Non-object configs (null/undefined) are unconfigured, never throwing.
 */
export function isFirebaseConfigComplete(config) {
  try {
    if (!config || typeof config !== 'object') return false;
    return FIREBASE_REQUIRED_KEYS.every(
      (key) => typeof config[key] === 'string' && config[key].trim().length > 0,
    );
  } catch {
    return false;
  }
}

/** Controlled error for Firebase actions while unconfigured. */
export function firebaseNotConfiguredError() {
  return new Error(
    'Firebase authentication is not configured (missing or incomplete VITE_FIREBASE_* environment variables). Configure Firebase authentication and try again, or continue as a guest.',
  );
}

/**
 * Return the auth instance when Firebase is configured, else throw the
 * controlled error above — never a null dereference. Pure and testable;
 * callers pass their module-scope (auth, isConfigured) pair.
 */
export function requireFirebaseAuth(auth, isConfigured) {
  if (!isConfigured || !auth) throw firebaseNotConfiguredError();
  return auth;
}
