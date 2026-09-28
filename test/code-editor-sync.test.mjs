/**
 * code-editor-sync.test.mjs — Monaco remote-sync guard (no DOM, no Monaco).
 *
 * `src/components/editor/CodeEditor.jsx` cannot be mounted under node:test
 * (it needs a DOM + the Monaco bundle), so this tests the exact mechanism
 * the component uses: `createRemoteSync()` from
 * `src/lib/controlledEditorSync.js`, driven through a FakeEditor that
 * replicates Monaco's semantics — `setValue()` fires model-content
 * listeners synchronously, just like the real editor.
 *
 * Regression: remote socket update → parent `value` changes → editor adopts
 * the value → must NOT invoke the local `onChange` path (otherwise the
 * adoption rebroadcasts as `code:update` → echo loop).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteSync } from '../src/lib/controlledEditorSync.js';

/**
 * Minimal Monaco stand-in: `setValue` synchronously notifies
 * model-content listeners, mirroring `editor.onDidChangeModelContent`.
 */
function createFakeEditor(initial = '') {
  let text = initial;
  const listeners = new Set();
  return {
    getValue() {
      return text;
    },
    setValue(next) {
      text = next;
      for (const fn of [...listeners]) fn();
    },
    // Simulates the user typing (bypasses suppression, like real keystrokes).
    type(next) {
      text = next;
      for (const fn of [...listeners]) fn();
    },
    onDidChangeModelContent(fn) {
      listeners.add(fn);
      return { dispose: () => listeners.delete(fn) };
    },
  };
}

/** Wire a FakeEditor exactly like CodeEditor.jsx does. */
function wire(editor, sync, onChangeRef) {
  editor.onDidChangeModelContent(() => {
    sync.handleModelContent(() => editor.getValue(), onChangeRef.current);
  });
}

function applyRemoteValue(editor, sync, value) {
  sync.applyRemote(
    () => editor.getValue(),
    (next) => editor.setValue(next),
    value,
  );
}

test('local typing invokes onChange with the new text', () => {
  const editor = createFakeEditor('// hello');
  const sync = createRemoteSync();
  const seen = [];
  wire(editor, sync, { current: (t) => seen.push(t) });
  editor.type('const a = 1;');
  assert.deepEqual(seen, ['const a = 1;']);
});

test('remote parent value updates the editor without invoking onChange (no echo)', () => {
  const editor = createFakeEditor('old');
  const sync = createRemoteSync();
  const seen = [];
  wire(editor, sync, { current: (t) => seen.push(t) });
  applyRemoteValue(editor, sync, 'remote text');
  assert.equal(editor.getValue(), 'remote text');
  assert.deepEqual(seen, [], 'remote adoption must not call onChange');
});

test('identical parent value is a no-op (no setValue, no onChange)', () => {
  const editor = createFakeEditor('same');
  const sync = createRemoteSync();
  const seen = [];
  wire(editor, sync, { current: (t) => seen.push(t) });
  let setCalls = 0;
  const applied = sync.applyRemote(
    () => editor.getValue(),
    () => {
      setCalls += 1;
    },
    'same',
  );
  assert.equal(applied, false);
  assert.equal(setCalls, 0);
  assert.equal(editor.getValue(), 'same');
  assert.deepEqual(seen, []);
});

test('empty string remote reset works without echo', () => {
  const editor = createFakeEditor('something');
  const sync = createRemoteSync();
  const seen = [];
  wire(editor, sync, { current: (t) => seen.push(t) });
  applyRemoteValue(editor, sync, '');
  assert.equal(editor.getValue(), '');
  assert.deepEqual(seen, []);
});

test('rapid successive remote updates settle on the latest value without echo', () => {
  const editor = createFakeEditor('v0');
  const sync = createRemoteSync();
  const seen = [];
  wire(editor, sync, { current: (t) => seen.push(t) });
  applyRemoteValue(editor, sync, 'v1');
  applyRemoteValue(editor, sync, 'v2');
  applyRemoteValue(editor, sync, 'v3');
  assert.equal(editor.getValue(), 'v3');
  assert.deepEqual(seen, []);
});

test('local edits still invoke onChange after a remote sync', () => {
  const editor = createFakeEditor('a');
  const sync = createRemoteSync();
  const seen = [];
  const ref = { current: (t) => seen.push(t) };
  wire(editor, sync, ref);
  applyRemoteValue(editor, sync, 'remote');
  editor.type('remote + local edit');
  assert.deepEqual(seen, ['remote + local edit']);
});

test('nullish remote value normalizes to empty string', () => {
  const editor = createFakeEditor('abc');
  const sync = createRemoteSync();
  const seen = [];
  wire(editor, sync, { current: (t) => seen.push(t) });
  const applied = sync.applyRemote(
    () => editor.getValue(),
    (next) => editor.setValue(next),
    undefined,
  );
  assert.equal(applied, true);
  assert.equal(editor.getValue(), '');
  assert.deepEqual(seen, []);
});
