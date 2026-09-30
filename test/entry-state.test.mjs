/**
 * entry-state.test.mjs — MEDIUM-1 reload behavior (no network, no DOM).
 * Covers the session-scoped "entered app" flag in src/lib/room.js and the
 * pure Landing-vs-Dashboard decision used by App.jsx:
 *
 *   First visit:  /           -> Landing
 *   Enter app:    /           -> Dashboard
 *   Reload:       /           -> Dashboard (same session)
 *   Direct room:  /?room=abc -> Workspace (never Landing)
 *   Leave:        /           -> Dashboard
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTERED_APP_STORAGE_KEY,
  hasEnteredApp,
  markEnteredApp,
  shouldShowLanding,
} from '../src/lib/room.js';

function installMemorySessionStorage() {
  const store = {};
  globalThis.sessionStorage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
  return store;
}

beforeEach(() => {
  installMemorySessionStorage();
});

test('first visit: not entered, room-free URL shows Landing', () => {
  assert.equal(hasEnteredApp(), false);
  assert.equal(shouldShowLanding(false, hasEnteredApp()), true);
});

test('enter app: marking entered flips room-free URL to Dashboard', () => {
  markEnteredApp();
  assert.equal(hasEnteredApp(), true);
  assert.equal(shouldShowLanding(false, hasEnteredApp()), false);
});

test('reload: entered flag persists in the same session storage', () => {
  markEnteredApp();
  // Simulate a reload: helpers re-read the same sessionStorage.
  assert.equal(hasEnteredApp(), true);
  assert.equal(shouldShowLanding(false, hasEnteredApp()), false);
  assert.equal(globalThis.sessionStorage.getItem(ENTERED_APP_STORAGE_KEY), '1');
});

test('direct room URLs never show Landing, entered or not', () => {
  assert.equal(shouldShowLanding(true, false), false);
  assert.equal(shouldShowLanding(true, true), false);
});

test('leave workspace: room-free URL after entering shows Dashboard', () => {
  markEnteredApp();
  assert.equal(shouldShowLanding(false, hasEnteredApp()), false);
});

test('storage unavailable falls back to not-entered without throwing', () => {
  delete globalThis.sessionStorage;
  assert.equal(hasEnteredApp(), false);
  assert.doesNotThrow(() => markEnteredApp());
  assert.equal(shouldShowLanding(false, hasEnteredApp()), true);
});
