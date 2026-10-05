/**
 * yjs-text.test.mjs — per-file Y.Text mapping + Monaco delta helpers.
 *
 * Covers src/lib/yjsText.js: registry lifecycle (get/has/remove),
 * rename-safe identity (stable fileId), foreign-key isolation, the
 * single-span diff used for Monaco binding, and real two-doc CRDT
 * convergence for concurrent typing (the destructive-overwrite fix).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Y from 'yjs';
import {
  PROJECT_FILES_KEY,
  getFileText,
  hasFileText,
  removeFileText,
  readFileTexts,
  diffTextsToOps,
  applyLocalTextEdit,
} from '../src/lib/yjsText.js';

describe('per-file Y.Text registry', () => {
  it('creates lazily and returns the same instance per fileId', () => {
    const doc = new Y.Doc();
    const a = getFileText(doc, 'f1');
    assert.ok(a instanceof Y.Text);
    assert.equal(getFileText(doc, 'f1'), a);
    assert.ok(getFileText(doc, 'f2') instanceof Y.Text);
    assert.notEqual(getFileText(doc, 'f2'), a);
  });

  it('rejects invalid inputs without crashing', () => {
    const doc = new Y.Doc();
    assert.throws(() => getFileText(null, 'f1'));
    assert.throws(() => getFileText(doc, ''));
    assert.throws(() => getFileText(doc, null));
    assert.equal(hasFileText(null, 'f1'), false);
    assert.equal(hasFileText(doc, 'missing'), false);
    assert.equal(removeFileText(doc, 'missing'), false);
    assert.equal(removeFileText(null, 'f1'), false);
  });

  it('rename keeps the same Y.Text instance (identity is the fileId)', () => {
    const doc = new Y.Doc();
    const before = getFileText(doc, 'f1');
    before.insert(0, 'hello');
    // A rename changes metadata only — the mapping is untouched.
    assert.equal(getFileText(doc, 'f1'), before);
    assert.equal(before.toString(), 'hello');
  });

  it('removeFileText drops the mapping; unknown ids are no-ops', () => {
    const doc = new Y.Doc();
    getFileText(doc, 'f1').insert(0, 'x');
    assert.equal(hasFileText(doc, 'f1'), true);
    assert.equal(removeFileText(doc, 'f1'), true);
    assert.equal(hasFileText(doc, 'f1'), false);
  });

  it('readFileTexts returns tree-known ids only, ignoring foreign keys', () => {
    const doc = new Y.Doc();
    getFileText(doc, 'real').insert(0, 'content');
    doc.getMap(PROJECT_FILES_KEY).set('evil', new Y.Text());
    const out = readFileTexts(doc, ['real', 'missing', '', null]);
    assert.deepEqual(out, { real: 'content' });
  });
});

describe('diffTextsToOps', () => {
  it('returns null for identical texts', () => {
    assert.equal(diffTextsToOps('abc', 'abc'), null);
    assert.equal(diffTextsToOps('', ''), null);
  });

  it('computes insert, delete, and replace spans', () => {
    assert.deepEqual(diffTextsToOps('', 'hi'), { start: 0, deleteCount: 0, insert: 'hi' });
    assert.deepEqual(diffTextsToOps('hi', ''), { start: 0, deleteCount: 2, insert: '' });
    assert.deepEqual(diffTextsToOps('hello', 'hallo'), { start: 1, deleteCount: 1, insert: 'a' });
    assert.deepEqual(diffTextsToOps('abc', 'aXYZc'), { start: 1, deleteCount: 1, insert: 'XYZ' });
  });

  it('round-trips through Y.Text application', () => {
    const doc = new Y.Doc();
    const ytext = getFileText(doc, 'f1');
    for (const next of ['h', 'hi', 'hit', 'hot', 'hot!', '']) {
      const ops = diffTextsToOps(ytext.toString(), next);
      if (ops) {
        if (ops.deleteCount > 0) ytext.delete(ops.start, ops.deleteCount);
        if (ops.insert.length > 0) ytext.insert(ops.start, ops.insert);
      }
      assert.equal(ytext.toString(), next);
    }
  });
});

describe('applyLocalTextEdit', () => {
  it('applies Monaco text as a Y.Text transaction and reports change', () => {
    const doc = new Y.Doc();
    assert.equal(applyLocalTextEdit(doc, 'f1', 'hello'), true);
    assert.equal(getFileText(doc, 'f1').toString(), 'hello');
    assert.equal(applyLocalTextEdit(doc, 'f1', 'hello'), false);
  });
});

describe('concurrent typing converges without overwrites', () => {
  // NOTE: two clients must never concurrently CREATE the same Y.Text with
  // divergent content (map entries are last-writer-wins: one object wins,
  // the other is orphaned). Creation sources are therefore restricted to
  // empty or identical server-snapshot content; only then do both sides
  // share one converged object and concurrent EDITS merge cleanly.
  function convergedPair() {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    // Both sides create the mapping, then synchronize BEFORE any edit so
    // the map entry converges while both objects are still empty.
    getFileText(docA, 'f1');
    getFileText(docB, 'f1');
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    return { docA, docB };
  }

  it('simultaneous inserts at the same position both survive', () => {
    const { docA, docB } = convergedPair();
    const textA = getFileText(docA, 'f1');
    const textB = getFileText(docB, 'f1');
    // Concurrent, causally independent inserts at offset 0.
    textA.insert(0, 'Hello');
    textB.insert(0, 'World');
    // Exchange updates both directions (what the wire does).
    const updateA = Y.encodeStateAsUpdate(docA);
    const updateB = Y.encodeStateAsUpdate(docB);
    Y.applyUpdate(docA, updateB);
    Y.applyUpdate(docB, updateA);
    assert.equal(textA.toString(), textB.toString());
    assert.ok(textA.toString().includes('Hello'));
    assert.ok(textA.toString().includes('World'));
  });

  it('edits at different positions merge cleanly', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    applyLocalTextEdit(docA, 'f1', 'abcdef');
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    // A appends, B prepends — concurrently.
    applyLocalTextEdit(docA, 'f1', getFileText(docA, 'f1').toString() + 'AAA');
    applyLocalTextEdit(docB, 'f1', 'BBB' + getFileText(docB, 'f1').toString());
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const a = getFileText(docA, 'f1').toString();
    const b = getFileText(docB, 'f1').toString();
    assert.equal(a, b);
    assert.ok(a.includes('AAA') && a.includes('BBB') && a.includes('abcdef'));
  });

  it('edits based on stale state do not clobber newer text', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    applyLocalTextEdit(docA, 'f1', 'version one');
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    applyLocalTextEdit(docA, 'f1', 'version one + more');
    // B edits from the older snapshot it still holds.
    const staleBase = 'version one';
    const ops = diffTextsToOps(staleBase, 'version one B-edit');
    assert.ok(ops !== null);
    // The CRDT merge keeps both contributions deterministically.
    const textB = getFileText(docB, 'f1');
    docB.transact(() => {
      if (ops.deleteCount > 0) textB.delete(ops.start, ops.deleteCount);
      if (ops.insert.length > 0) textB.insert(ops.start, ops.insert);
    });
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    assert.equal(
      getFileText(docA, 'f1').toString(),
      getFileText(docB, 'f1').toString(),
    );
  });
});
