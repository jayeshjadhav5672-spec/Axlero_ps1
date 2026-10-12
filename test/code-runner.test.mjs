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
import {
  RUN_TIMEOUT_MS,
  buildWorkerSource,
  isRunnableLanguage,
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
