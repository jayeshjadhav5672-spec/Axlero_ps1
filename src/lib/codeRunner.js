/**
 * codeRunner.js — isolated JavaScript execution for the Run Code console.
 *
 * Threat model (read this before weakening anything):
 * - User code (possibly written by another room participant) runs inside a
 *   dedicated Web Worker, NOT in the application page context.
 * - The worker has no DOM (`document`/`window` do not exist there), no
 *   `localStorage`/session storage, and the preamble below removes network
 *   (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`), code-loading
 *   (`importScripts`, nested `Worker`/`SharedWorker`), client storage
 *   (`indexedDB`, `caches`), `WebAssembly`, and notifications. These are
 *   defense-in-depth: a worker already lacks DOM and storage by design.
 * - The host enforces a wall-clock timeout and ALWAYS terminates the
 *   worker (success, error, or timeout), then revokes the Blob URL and
 *   detaches listeners — no accumulation across runs.
 * - This is NOT a complete security sandbox: worker code still gets CPU
 *   time (bounded by the timeout) and can keep in-memory state only for
 *   the duration of one run. It cannot reach same-origin page data,
 *   cookies, `localStorage`, the DOM, or the network through the removed
 *   APIs. Do not claim more than this.
 *
 * Only JavaScript is supported. TypeScript (or any other language) is
 * rejected with a backend-runner message: nothing here transpiles, and
 * pretending `AsyncFunction` can run type annotations would be dishonest.
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
 * Build the worker source for one run. The preamble hardens the worker
 * global first (network/storage/code-loading APIs removed or shadowed),
 * then installs a collecting console, then runs the user code on message
 * and posts back `{ ok, output }`. Pure string builder — unit-tested to
 * guarantee the hardening preamble cannot drift out of the shipped code.
 */
export function buildWorkerSource(userCode) {
  const code = typeof userCode === 'string' ? userCode : '';
  return `'use strict';
const __USER_CODE = ${JSON.stringify(code)};
const __BLOCKED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'WebAssembly', 'Worker', 'SharedWorker', 'Notification', 'BroadcastChannel'];
for (const __k of __BLOCKED) {
  try { delete self[__k]; } catch (__e) {}
  try { self[__k] = undefined; } catch (__e) {}
  try { Object.defineProperty(self, __k, { value: undefined, configurable: true, writable: true }); } catch (__e) {}
}
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
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const __fn = new AsyncFunction(__USER_CODE);
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
 * string; rejects with an Error (runtime failure, timeout, or worker
 * unavailable). The worker is ALWAYS terminated and its Blob URL revoked,
 * and message/error listeners are detached — success, failure, timeout.
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
