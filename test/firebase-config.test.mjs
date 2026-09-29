/**
 * firebase-config.test.mjs — Firebase client-config validation.
 *
 * Guards the blank-page regression: getAuth() throws auth/invalid-api-key
 * at import time, so Firebase must initialize ONLY when all six required
 * VITE_FIREBASE_* fields are present and non-empty. Anything less means
 * unconfigured, and unconfigured Firebase must never reach
 * initializeApp()/getAuth() (firebase.js gates both calls on
 * isFirebaseConfigComplete). Auth helpers must then fail with a controlled
 * error, never a null dereference.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FIREBASE_REQUIRED_KEYS,
  firebaseNotConfiguredError,
  isFirebaseConfigComplete,
  requireFirebaseAuth,
} from '../src/lib/firebaseConfig.js';

function completeConfig() {
  return {
    apiKey: 'AIza-test',
    authDomain: 'demo.firebaseapp.com',
    projectId: 'demo',
    storageBucket: 'demo.appspot.com',
    messagingSenderId: '123456',
    appId: '1:123456:web:abc',
  };
}

describe('isFirebaseConfigComplete', () => {
  it('1. all six required fields present -> configured', () => {
    assert.equal(isFirebaseConfigComplete(completeConfig()), true);
  });

  it('2. API key missing -> unconfigured', () => {
    const { apiKey, ...rest } = completeConfig();
    assert.equal(isFirebaseConfigComplete(rest), false);
  });

  it('3. auth domain missing -> unconfigured', () => {
    const { authDomain, ...rest } = completeConfig();
    assert.equal(isFirebaseConfigComplete(rest), false);
  });

  it('4. project ID missing -> unconfigured', () => {
    const { projectId, ...rest } = completeConfig();
    assert.equal(isFirebaseConfigComplete(rest), false);
  });

  it('5. storage bucket missing -> unconfigured', () => {
    const { storageBucket, ...rest } = completeConfig();
    assert.equal(isFirebaseConfigComplete(rest), false);
  });

  it('6. messaging sender ID missing -> unconfigured', () => {
    const { messagingSenderId, ...rest } = completeConfig();
    assert.equal(isFirebaseConfigComplete(rest), false);
  });

  it('7. app ID missing -> unconfigured', () => {
    const { appId, ...rest } = completeConfig();
    assert.equal(isFirebaseConfigComplete(rest), false);
  });

  it('8. empty required values -> unconfigured', () => {
    assert.equal(isFirebaseConfigComplete({}), false);
    assert.equal(isFirebaseConfigComplete(null), false);
    assert.equal(isFirebaseConfigComplete(undefined), false);
    assert.equal(
      isFirebaseConfigComplete({ ...completeConfig(), apiKey: '' }),
      false,
    );
    assert.equal(
      isFirebaseConfigComplete({ ...completeConfig(), projectId: '   ' }),
      false,
    );
  });

  it('requires exactly the six documented keys', () => {
    assert.deepEqual([...FIREBASE_REQUIRED_KEYS].sort(), [
      'apiKey',
      'appId',
      'authDomain',
      'messagingSenderId',
      'projectId',
      'storageBucket',
    ]);
  });
});

describe('requireFirebaseAuth', () => {
  it('returns the auth instance when configured', () => {
    const fakeAuth = { uid: 'x' };
    assert.equal(requireFirebaseAuth(fakeAuth, true), fakeAuth);
  });

  it('throws a controlled error (not a TypeError) when unconfigured', () => {
    for (const [auth, configured] of [
      [null, false],
      [null, true],
      [{ uid: 'x' }, false],
    ]) {
      assert.throws(() => requireFirebaseAuth(auth, configured), (err) => {
        assert.ok(err instanceof Error);
        assert.ok(!(err instanceof TypeError));
        assert.match(err.message, /not configured/);
        return true;
      });
    }
  });

  it('firebaseNotConfiguredError carries actionable guidance', () => {
    const err = firebaseNotConfiguredError();
    assert.ok(err instanceof Error);
    assert.match(err.message, /VITE_FIREBASE_\*/);
  });
});
