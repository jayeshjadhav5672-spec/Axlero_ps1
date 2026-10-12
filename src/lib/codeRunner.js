/**
 * codeRunner.js — isolated JavaScript execution for the Run Code console.
 *
 * Threat model (read this before weakening anything):
 *
 * What IS enforced:
 * - User code (possibly written by another room participant) runs inside
 *   a dedicated Web Worker, never in the application page context. The
 *   worker realm has no DOM (`document`/`window`), no `localStorage` or
 *   session storage by construction.
 * - `applyWorkerHardening()` neuters network, code-loading, storage, and
 *   string-to-code APIs on the worker global AND its prototype chain, so
 *   `Object.getPrototypeOf(self).fetch`-style bypasses fail too: fetch,
 *   XMLHttpRequest, WebSocket, WebSocketStream, EventSource, fetchLater,
 *   importScripts, eval, Function, WebAssembly, Worker, SharedWorker,
 *   indexedDB, caches, Notification, BroadcastChannel, navigator.sendBeacon,
 *   navigator.serviceWorker, navigator.locks, navigator.storage,
 *   navigator.clipboard.
 * - Dynamic `import()` (the one network path that is syntax, not an API,
 *   and therefore cannot be neutered) is rejected BEFORE any worker is
 *   spawned by a conservative lexical scan (`rejectsDynamicImport`): any
 *   `import(` token outside strings/comments/plain-template-text refuses
 *   the run. Fail-closed: ambiguous input is rejected, never executed.
 * - The host enforces a wall-clock timeout and ALWAYS terminates the
 *   worker, revokes the Blob URL, and detaches listeners — success,
 *   error, or timeout. No accumulation across runs.
 * - Controlled console output only: the worker collects logs and posts
 *   `{ ok, output }`; the application console is never patched.
 *
 * What is NOT guaranteed (honest limits of a client-side runner):
 * - CPU/time side channels within the timeout; memory use within one run.
 * - `location.href` and basic `navigator` fields remain readable (the room
 *   URL is already known to every participant; no page data is exposed).
 * - Fingerprinting-style reads (`userAgent`, `hardwareConcurrency`) are
 *   not blocked — they cannot reach application secrets or the network.
 * - The lexical import scan may reject exotic-but-harmless code (e.g. a
 *   regex literal containing the text `import(`); that direction is safe.
 *
 * This is NOT a complete security sandbox. For untrusted code at scale,
 * use a backend runner. Only JavaScript is supported — nothing here
 * transpiles, so TypeScript is honestly rejected (see isRunnableLanguage).
 *
 * No React, no DOM at import time (Worker/Blob/URL are only touched when
 * a run starts, via an injectable factory so unit tests can substitute a
 * fake). Safe to import from components and node --test.
 */

export const RUN_TIMEOUT_MS = 5000;

/** Languages the isolated runner can actually execute. */
export function isRunnableLanguage(language) {
  return String(language ?? '').toLowerCase() === 'javascript';
}

/**
 * Neuter dangerous APIs on a worker-like global scope, walking the whole
 * prototype chain so `Object.getPrototypeOf(self).fetch`-style escapes
 * fail the same way direct reads do. Self-contained (no closure or
 * imports) so the identical function can be serialized into the worker
 * source — `buildWorkerSource` embeds `applyWorkerHardening.toString()`,
 * guaranteeing tests and shipments can never drift apart.
 * Returns the list of neutralized key paths (for diagnostics, not secrets).
 */
export function applyWorkerHardening(scope) {
  const neutralized = [];
  if (!scope || (typeof scope !== 'object' && typeof scope !== 'function')) return neutralized;
  const GLOBAL_KEYS = [
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'WebSocketStream',
    'EventSource',
    'fetchLater',
    'importScripts',
    'eval',
    'Function',
    'WebAssembly',
    'Worker',
    'SharedWorker',
    'indexedDB',
    'caches',
    'Notification',
    'BroadcastChannel',
  ];
  const NAV_KEYS = ['sendBeacon', 'serviceWorker', 'locks', 'storage', 'clipboard'];
  const forgetOwn = (obj, key) => {
    try {
      if (obj === null || obj === undefined) return false;
      Object.defineProperty(obj, key, { value: undefined, writable: true, configurable: true });
      return true;
    } catch (e) {
      return false;
    }
  };
  try {
    const seen = [];
    let obj = scope;
    let depth = 0;
    while (obj !== null && obj !== undefined && obj !== Object.prototype && depth < 8) {
      depth += 1;
      let already = false;
      for (let i = 0; i < seen.length; i += 1) {
        if (seen[i] === obj) {
          already = true;
          break;
        }
      }
      if (already) break;
      seen.push(obj);
      for (let k = 0; k < GLOBAL_KEYS.length; k += 1) {
        const key = GLOBAL_KEYS[k];
        let present = false;
        try {
          present = key in Object(obj);
        } catch (e) {
          present = false;
        }
        if (present && forgetOwn(obj, key)) neutralized.push(key);
      }
      try {
        obj = Object.getPrototypeOf(obj);
      } catch (e) {
        obj = null;
      }
    }
  } catch (e) {
    // Hardening is best-effort per object; failures below still apply.
  }
  try {
    const nav = scope.navigator;
    if (nav && (typeof nav === 'object' || typeof nav === 'function')) {
      for (let k = 0; k < NAV_KEYS.length; k += 1) {
        const key = NAV_KEYS[k];
        let present = false;
        try {
          present = key in Object(nav);
        } catch (e) {
          present = false;
        }
        if (present && forgetOwn(nav, key)) neutralized.push('navigator.' + key);
      }
    }
  } catch (e) {
    // Navigator hardening is additive; global neutering stands alone.
  }
  return neutralized;
}

/**
 * Conservative lexical scan: true when `source` contains a dynamic
 * `import(` token outside string literals, comments, and plain template
 * text (template `${...}` expressions ARE scanned). Fail-closed: on any
 * lexical ambiguity the input is treated as code, so a real dynamic
 * import cannot hide behind obfuscation — `import(` must appear literally
 * (modulo whitespace/comments) to execute, and that is exactly what is
 * detected. Static `import x from 'y'`, `import.meta`, and the text
 * `import(` inside strings/comments/plain-template-text are allowed.
 * Regex literals are deliberately NOT skipped (a `/` always starts code):
 * a regex containing the text `import(` is rejected — safe direction.
 */
export function rejectsDynamicImport(source) {
  const s = typeof source === 'string' ? source : '';
  const n = s.length;
  let stripped = '';
  let i = 0;
  // Template stack: each entry tracks ${} brace depth inside one template.
  const templateStack = [];
  const inTemplate = () => templateStack.length > 0;
  while (i < n) {
    const c = s[i];
    const next = i + 1 < n ? s[i + 1] : '';
    if (c === '/' && next === '/') {
      while (i < n && s[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(s[i] === '*' && i + 1 < n && s[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i += 1;
      while (i < n) {
        if (s[i] === '\\') {
          i += 2;
          continue;
        }
        if (s[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === '`') {
      templateStack.push({ braces: 0, inExpr: false });
      i += 1;
      continue;
    }
    if (inTemplate()) {
      const top = templateStack[templateStack.length - 1];
      if (!top.inExpr) {
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '$' && next === '{') {
          top.inExpr = true;
          top.braces = 1;
          stripped += '${';
          i += 2;
          continue;
        }
        if (c === '`' && top.braces === 0) {
          templateStack.pop();
          i += 1;
          continue;
        }
        i += 1;
        continue;
      }
      // Inside ${...}: strings/comments nest; braces track depth.
      if (c === '"' || c === "'") {
        const quote = c;
        i += 1;
        while (i < n) {
          if (s[i] === '\\') {
            i += 2;
            continue;
          }
          if (s[i] === quote) {
            i += 1;
            break;
          }
          i += 1;
        }
        continue;
      }
      if (c === '/' && next === '/') {
        while (i < n && s[i] !== '\n') i += 1;
        continue;
      }
      if (c === '/' && next === '*') {
        i += 2;
        while (i < n && !(s[i] === '*' && i + 1 < n && s[i + 1] === '/')) i += 1;
        i += 2;
        continue;
      }
      if (c === '`') {
        templateStack.push({ braces: 0, inExpr: false });
        i += 1;
        continue;
      }
      if (c === '{') {
        top.braces += 1;
        stripped += c;
        i += 1;
        continue;
      }
      if (c === '}') {
        top.braces -= 1;
        stripped += c;
        i += 1;
        if (top.braces === 0) top.inExpr = false;
        continue;
      }
      stripped += c;
      i += 1;
      continue;
    }
    stripped += c;
    i += 1;
  }
  return /\bimport\s*\(/.test(stripped);
}

/**
 * Build the worker source for one run. Embeds the hardened-global
 * function by serialization (identical code in tests and shipments),
 * captures AsyncFunction BEFORE hardening, patches only the worker's own
 * console, and runs the embedded user code on message.
 */
export function buildWorkerSource(userCode) {
  const code = typeof userCode === 'string' ? userCode : '';
  return `'use strict';
const __AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
(${applyWorkerHardening.toString()})(typeof self !== 'undefined' ? self : this);
const __USER_CODE = ${JSON.stringify(code)};
const __logs = [];
const __fmt = (a) => {
  if (typeof a === 'string') return a;
  try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch (__e) { return String(a); }
};
console.log = (...args) => { __logs.push(args.map(__fmt).join(' ')); };
console.error = (...args) => { __logs.push('[ERROR] ' + args.map(__fmt).join(' ')); };
console.warn = (...args) => { __logs.push('[WARN] ' + args.map(__fmt).join(' ')); };
self.onmessage = async (e) => {
  void e;
  try {
    const __fn = new __AsyncFunction(__USER_CODE);
    const __returned = await __fn();
    if (__returned !== undefined && __logs.length === 0) __logs.push(__fmt(__returned));
    self.postMessage({ ok: true, output: __logs.join('\\n') || 'Program executed successfully (no output).' });
  } catch (err) {
    const __trailing = __logs.length > 0 ? __logs.join('\\n') + '\\n' : '';
    self.postMessage({ ok: false, output: __trailing + 'Error: ' + (err && err.message ? err.message : String(err)) });
  }
};
`;
}

/** Default worker factory (browser only). Injected seam for unit tests. */
export function defaultCreateWorker(source) {
  const blob = new Blob([source], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  return {
    worker,
    cleanup: () => {
      try { worker.terminate(); } catch { /* already gone */ }
      try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
    },
  };
}

/**
 * Execute JavaScript in an isolated worker. Resolves with the output
 * string; rejects with an Error (blocked dynamic import, runtime
 * failure, timeout, or worker unavailable). The worker is ALWAYS
 * terminated and its Blob URL revoked, and message/error listeners are
 * detached — success, failure, timeout.
 */
export function runUserCode(code, { timeout = RUN_TIMEOUT_MS, createWorker = defaultCreateWorker } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let handle = null;
    const onMessage = (event) => {
      const data = event && event.data;
      if (!data || typeof data !== 'object') return;
      if (data.ok) finish(resolve, typeof data.output === 'string' ? data.output : '');
      else finish(reject, new Error(typeof data.output === 'string' && data.output ? data.output : 'Execution failed'));
    };
    const onError = () => finish(reject, new Error('Worker error during execution'));
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      const worker = handle && handle.worker;
      try {
        if (worker && typeof worker.removeEventListener === 'function') {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
        }
      } catch { /* listener teardown — never throw */ }
      try {
        if (handle && typeof handle.cleanup === 'function') handle.cleanup();
      } catch { /* teardown — never throw */ }
      fn(value);
    };
    if (rejectsDynamicImport(code)) {
      reject(new Error('Dynamic import() is blocked in the isolated runner.'));
      return;
    }
    let source;
    try {
      source = buildWorkerSource(code);
    } catch (err) {
      reject(new Error(`Cannot prepare code for execution: ${err?.message ?? String(err)}`));
      return;
    }
    try {
      handle = createWorker(source);
    } catch (err) {
      reject(new Error(`Code runner unavailable: ${err?.message ?? String(err)}`));
      return;
    }
    if (!handle || !handle.worker || typeof handle.worker.postMessage !== 'function') {
      try {
        if (handle && typeof handle.cleanup === 'function') handle.cleanup();
      } catch { /* ignore */ }
      reject(new Error('Code runner unavailable: invalid worker handle'));
      return;
    }
    try {
      const worker = handle.worker;
      if (typeof worker.addEventListener === 'function') {
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
      } else {
        worker.onmessage = onMessage;
        worker.onerror = onError;
      }
    } catch (err) {
      finish(reject, err instanceof Error ? err : new Error(String(err)));
      return;
    }
    timer = setTimeout(() => {
      finish(reject, new Error(`Execution timed out after ${timeout} ms`));
    }, timeout);
    try {
      handle.worker.postMessage({ code: typeof code === 'string' ? code : '' });
    } catch (err) {
      finish(reject, err instanceof Error ? err : new Error(String(err)));
    }
  });
}
