/**
 * frontend-env-validation.test.mjs — fail-closed production config gates.
 *
 * Covers the pure validators behind scripts/validate-frontend-env.mjs
 * (backend URL + Firebase fields) and scripts/verify-built-backend.mjs
 * (built bundle references the intended host). No network, no secrets in
 * assertions — only hostnames and field names appear.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveBackendUrl,
  validateBackendUrl,
  validateFirebaseConfig,
  validateOptionalOverrides,
  validateProductionEnv,
} from '../scripts/validate-frontend-env.mjs';
import {
  builtBundleContainsBackend,
  hostnameOf,
  resolveExpectedBackendUrl,
} from '../scripts/verify-built-backend.mjs';
import {
  builtBundleContainsFirebaseProject,
  resolveExpectedProjectId,
} from '../scripts/verify-built-firebase.mjs';

const FIREBASE_OK = {
  VITE_FIREBASE_API_KEY: 'key',
  VITE_FIREBASE_AUTH_DOMAIN: 'app.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'app',
  VITE_FIREBASE_STORAGE_BUCKET: 'app.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1',
  VITE_FIREBASE_APP_ID: '1:1:web:1',
};

describe('validateBackendUrl', () => {
  it('rejects missing and empty values without echoing input', () => {
    for (const value of [undefined, null, '', '   ', 'http://[::1']) {
      const result = validateBackendUrl(value);
      assert.equal(result.ok, false);
      const raw = typeof value === 'string' ? value.trim() : '';
      if (raw) assert.ok(!result.reason.includes(raw));
    }
  });

  it('rejects malformed and non-http URLs', () => {
    assert.equal(validateBackendUrl('not a url').ok, false);
    assert.equal(validateBackendUrl('ftp://host/app').ok, false);
    assert.equal(validateBackendUrl('ws://host/app').ok, false);
  });

  it('rejects localhost and loopback variants', () => {
    for (const url of [
      'http://localhost:3000',
      'http://localhost/app',
      'http://127.0.0.1:3000',
      'http://127.0.0.2:3000',
      'http://[::1]:3000',
      'http://0.0.0.0:3000',
    ]) {
      assert.equal(validateBackendUrl(url).ok, false, url);
    }
  });

  it('accepts public http(s) URLs', () => {
    assert.equal(validateBackendUrl('https://api.example.com').ok, true);
    assert.equal(validateBackendUrl('https://backend.up.railway.app:443/x').ok, true);
    // Private LAN addresses are intentionally allowed (self-hosted teams
    // run real backends there); only loopback is rejected for production.
    assert.equal(validateBackendUrl('http://192.168.1.10:3000').ok, true);
  });

  it('rejects lookalike hostnames that merely contain a good host', () => {
    // Bundle verification is boundary-aware: attacker hosts that merely
    // contain the expected hostname must NOT satisfy the check.
    const dir = mkdtempSync(join(tmpdir(), 'syncspace-verify-evil-'));
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'assets', 'index-abc.js'), 'const u="https://evil-api.example.com/x";fetch(u);');
    assert.equal(builtBundleContainsBackend(dir, 'https://api.example.com'), false);
    writeFileSync(join(dir, 'assets', 'index-def.js'), 'const u="https://api.example.com.evil.example/x";fetch(u);');
    assert.equal(builtBundleContainsBackend(dir, 'https://api.example.com'), false);
    writeFileSync(join(dir, 'assets', 'index-ok.js'), 'const u="https://api.example.com/socket.io";fetch(u);');
    assert.equal(builtBundleContainsBackend(dir, 'https://api.example.com'), true);
  });

  it('prefers VITE_BACKEND_URL over the legacy alias', () => {
    assert.equal(
      resolveBackendUrl({ VITE_BACKEND_URL: 'https://a.example', VITE_SYNCSPACE_SERVER_URL: 'https://b.example' }),
      'https://a.example',
    );
    assert.equal(resolveBackendUrl({ VITE_SYNCSPACE_SERVER_URL: 'https://b.example' }), 'https://b.example');
    assert.equal(resolveBackendUrl({}), '');
  });
});

describe('validateFirebaseConfig', () => {
  it('passes when all six fields are present', () => {
    assert.deepEqual(validateFirebaseConfig(FIREBASE_OK), { ok: true });
  });

  it('lists exactly the missing fields (names only)', () => {
    const { VITE_FIREBASE_API_KEY, ...rest } = FIREBASE_OK;
    void VITE_FIREBASE_API_KEY;
    const result = validateFirebaseConfig({ ...rest, VITE_FIREBASE_APP_ID: '   ' });
    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID']);
  });
});

describe('validateOptionalOverrides', () => {
  it('ignores absent overrides (backend fallback applies)', () => {
    assert.deepEqual(validateOptionalOverrides({}), []);
    assert.deepEqual(validateOptionalOverrides({ VITE_WS_URL: '  ' }), []);
  });

  it('accepts valid public overrides including wss:// form', () => {
    assert.deepEqual(
      validateOptionalOverrides({ VITE_WS_URL: 'wss://ws.example.com', VITE_API_URL: 'https://api.example.com' }),
      [],
    );
  });

  it('rejects localhost or malformed overrides without echoing values', () => {
    const errors = validateOptionalOverrides({
      VITE_WS_URL: 'ws://localhost:3000',
      VITE_API_URL: 'not a url',
    });
    assert.equal(errors.length, 2);
    assert.ok(errors[0].startsWith('VITE_WS_URL:'));
    assert.ok(errors[1].startsWith('VITE_API_URL:'));
    assert.ok(!errors.join(' ').includes('localhost:3000'));
    assert.ok(!errors.join(' ').includes('not a url'));
  });

  it('feeds into the production gate', () => {
    const result = validateProductionEnv({
      VITE_BACKEND_URL: 'https://api.example.com',
      ...{
        VITE_FIREBASE_API_KEY: 'k',
        VITE_FIREBASE_AUTH_DOMAIN: 'd',
        VITE_FIREBASE_PROJECT_ID: 'p',
        VITE_FIREBASE_STORAGE_BUCKET: 'b',
        VITE_FIREBASE_MESSAGING_SENDER_ID: 's',
        VITE_FIREBASE_APP_ID: 'a',
      },
      VITE_WS_URL: 'ws://localhost:3000',
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.startsWith('VITE_WS_URL:')));
  });
});

describe('validateProductionEnv', () => {
  it('passes a complete production environment', () => {
    assert.equal(
      validateProductionEnv({ VITE_BACKEND_URL: 'https://api.example.com', ...FIREBASE_OK }).ok,
      true,
    );
  });

  it('collects backend and Firebase failures together', () => {
    const result = validateProductionEnv({ VITE_BACKEND_URL: 'http://localhost:3000' });
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 2);
  });
});

describe('verify-built-backend', () => {
  it('extracts hostnames defensively', () => {
    assert.equal(hostnameOf('https://Api.Example.COM:8443/x'), 'api.example.com');
    assert.equal(hostnameOf('not a url'), '');
    assert.equal(hostnameOf(''), '');
  });

  it('resolves the expected URL with alias fallback', () => {
    assert.equal(
      resolveExpectedBackendUrl({ EXPECTED_BACKEND_URL: 'https://a.example', VITE_BACKEND_URL: 'https://b.example' }),
      'https://a.example',
    );
    assert.equal(resolveExpectedBackendUrl({ VITE_SYNCSPACE_SERVER_URL: 'https://c.example' }), 'https://c.example');
    assert.equal(resolveExpectedBackendUrl({}), '');
  });

  it('finds the backend host in emitted chunks, misses localhost builds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'syncspace-verify-'));
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'assets', 'index-abc.js'), 'const u="https://api.example.com/socket.io";console.log(u);');
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    assert.equal(builtBundleContainsBackend(dir, 'https://api.example.com'), true);
    assert.equal(builtBundleContainsBackend(dir, 'https://other.example.com'), false);
    assert.equal(builtBundleContainsBackend(join(dir, 'missing'), 'https://api.example.com'), false);
    assert.equal(builtBundleContainsBackend(dir, 'not a url'), false);
  });
});

describe('verify-built-firebase', () => {
  it('resolves the expected project ID defensively', () => {
    assert.equal(resolveExpectedProjectId({ VITE_FIREBASE_PROJECT_ID: '  my-app ' }), 'my-app');
    assert.equal(resolveExpectedProjectId({ VITE_FIREBASE_PROJECT_ID: '' }), '');
    assert.equal(resolveExpectedProjectId({}), '');
  });

  it('finds the project ID in emitted chunks, rejects incomplete builds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'syncspace-verify-fb-'));
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(
      join(dir, 'assets', 'index-abc.js'),
      'const cfg={projectId:"my-app",apiKey:"key"};console.log(cfg);',
    );
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    assert.equal(builtBundleContainsFirebaseProject(dir, 'my-app'), true);
    assert.equal(builtBundleContainsFirebaseProject(dir, 'other-app'), false);
    assert.equal(builtBundleContainsFirebaseProject(dir, ''), false);
    assert.equal(builtBundleContainsFirebaseProject(dir, '   '), false);
    assert.equal(builtBundleContainsFirebaseProject(join(dir, 'missing'), 'my-app'), false);
  });
});
