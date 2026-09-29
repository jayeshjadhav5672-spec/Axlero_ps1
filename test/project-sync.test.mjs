import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureSharedNode,
  fileIdOfCodeOp,
  isValidFileCodeOp,
  mergeFileSnapshot,
} from '../src/lib/projectSync.js';
import { SHARED_FILE_ID } from '../src/components/workspace/fileTree.js';
import { CREATE_ACK_TIMEOUT_MS } from '../src/hooks/useCollaborativeProject.js';

describe('fileIdOfCodeOp', () => {
  it('defaults legacy ops without fileId to the shared document', () => {
    assert.equal(fileIdOfCodeOp({ text: 'x', rev: 1, actorId: 'a' }), SHARED_FILE_ID);
    assert.equal(fileIdOfCodeOp(null), SHARED_FILE_ID);
    assert.equal(fileIdOfCodeOp({ fileId: '', text: 'x' }), SHARED_FILE_ID);
  });

  it('passes explicit file ids through', () => {
    assert.equal(fileIdOfCodeOp({ fileId: 'f-1', text: 'x', rev: 1, actorId: 'a' }), 'f-1');
  });
});

describe('isValidFileCodeOp', () => {
  it('accepts legacy and per-file envelopes, rejects garbage', () => {
    assert.equal(isValidFileCodeOp({ text: 'x', rev: 1, actorId: 'a' }), true);
    assert.equal(isValidFileCodeOp({ fileId: 'f', text: 'x', rev: 2, actorId: 'a' }), true);
    assert.equal(isValidFileCodeOp({ fileId: '', text: 'x', rev: 2, actorId: 'a' }), false);
    assert.equal(isValidFileCodeOp({ text: 'x', rev: 1 }), false);
    assert.equal(isValidFileCodeOp('nope'), false);
  });
});

describe('mergeFileSnapshot', () => {
  it('adopts strictly newer snapshot entries only', () => {
    const local = new Map([['a', { text: 'old', rev: 3 }]]);
    const { files, texts, changed, ahead } = mergeFileSnapshot(local, {
      a: { text: 'stale', rev: 2 },
      b: { text: 'new', rev: 1 },
    });
    assert.equal(files.get('a').text, 'old');
    assert.equal(files.get('b').text, 'new');
    assert.equal(texts.b, 'new');
    assert.equal(changed, true);
    // local 'a' (rev 3) is newer than the snapshot (rev 2): kept + flagged.
    assert.deepEqual(ahead, [{ fileId: 'a', text: 'old', rev: 3 }]);
  });

  it('flags locally-newer entries for re-emit (reconnect convergence)', () => {
    const local = new Map([['a', { text: 'mine', rev: 5 }]]);
    const { files, ahead } = mergeFileSnapshot(local, { a: { text: 'theirs', rev: 3 } });
    assert.equal(files.get('a').text, 'mine');
    assert.deepEqual(ahead, [{ fileId: 'a', text: 'mine', rev: 5 }]);
  });

  it('ignores malformed snapshot entries', () => {
    const { files, changed } = mergeFileSnapshot(new Map(), {
      ok: { text: 'v', rev: 0 },
      bad: { text: 42, rev: 1 },
      alsobad: null,
    });
    assert.equal(files.size, 1);
    assert.equal(changed, true);
  });
});

describe('ensureSharedNode', () => {
  it('prepends the shared doc only when missing', () => {
    const shared = { id: SHARED_FILE_ID, name: 'Collaborative Code' };
    assert.deepEqual(ensureSharedNode([], shared), [shared]);
    const withShared = [{ id: SHARED_FILE_ID, name: 'x' }];
    assert.equal(ensureSharedNode(withShared, shared), withShared);
  });
});

describe('create-request timeout contract', () => {
  it('exports a sane positive ack timeout (hook module loads cleanly)', () => {
    assert.ok(Number.isFinite(CREATE_ACK_TIMEOUT_MS));
    assert.ok(CREATE_ACK_TIMEOUT_MS >= 1000);
    assert.ok(CREATE_ACK_TIMEOUT_MS <= 30000);
  });
});
