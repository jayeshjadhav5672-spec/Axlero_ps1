import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ancestorIds,
  childrenOf,
  colorForFileName,
  languageForFileName,
  loadTree,
  saveTree,
  sharedFileNode,
  siblingNameTaken,
  sortTreeNodes,
  validateItemName,
} from '../src/components/workspace/fileTree.js';

function memStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    _store: store,
  };
}

describe('validateItemName', () => {
  it('rejects empty and whitespace-only names', () => {
    assert.equal(validateItemName('').ok, false);
    assert.equal(validateItemName('   ').ok, false);
    assert.equal(validateItemName(null).ok, false);
  });

  it('rejects path separators and traversal segments', () => {
    assert.equal(validateItemName('src/foo.js').ok, false);
    assert.equal(validateItemName('..\\x').ok, false);
    assert.equal(validateItemName('..').ok, false);
    assert.equal(validateItemName('...').ok, false);
    assert.equal(validateItemName('../something').ok, false);
  });

  it('accepts plain filenames and trims whitespace', () => {
    assert.deepEqual(validateItemName('  App.jsx  '), { ok: true, name: 'App.jsx' });
    assert.deepEqual(validateItemName('components'), { ok: true, name: 'components' });
    assert.deepEqual(validateItemName('README.md'), { ok: true, name: 'README.md' });
  });
});

describe('siblingNameTaken', () => {
  const nodes = [
    { id: 'a', name: 'App.jsx', type: 'file', parentId: null },
    { id: 'b', name: 'src', type: 'folder', parentId: null },
    { id: 'c', name: 'App.jsx', type: 'file', parentId: 'b' },
  ];

  it('blocks duplicates in the same folder (case-insensitive)', () => {
    assert.equal(siblingNameTaken(nodes, null, 'App.jsx'), true);
    assert.equal(siblingNameTaken(nodes, null, 'app.JSX'), true);
    assert.equal(siblingNameTaken(nodes, 'b', 'App.jsx'), true);
  });

  it('allows the same name in different folders', () => {
    assert.equal(siblingNameTaken(nodes, 'other', 'App.jsx'), false);
  });

  it('treats files and folders as one namespace', () => {
    assert.equal(siblingNameTaken(nodes, null, 'src'), true);
  });
});

describe('tree ordering and hierarchy', () => {
  it('sorts shared first, then folders, then files', () => {
    const nodes = [
      { id: '1', name: 'z.js', type: 'file', parentId: null },
      { id: '2', name: 'b', type: 'folder', parentId: null },
      sharedFileNode(),
      { id: '3', name: 'a.js', type: 'file', parentId: null },
    ];
    assert.deepEqual(
      sortTreeNodes(nodes).map((n) => n.name),
      ['Collaborative Code', 'b', 'a.js', 'z.js'],
    );
  });

  it('childrenOf returns only direct children, sorted', () => {
    const nodes = [
      { id: 'f', name: 'src', type: 'folder', parentId: null },
      { id: 'x', name: 'b.js', type: 'file', parentId: 'f' },
      { id: 'y', name: 'a.js', type: 'file', parentId: 'f' },
      { id: 'z', name: 'root.js', type: 'file', parentId: null },
    ];
    assert.deepEqual(
      childrenOf(nodes, 'f').map((n) => n.name),
      ['a.js', 'b.js'],
    );
    assert.deepEqual(
      childrenOf(nodes, null).map((n) => n.name),
      ['src', 'root.js'],
    );
  });

  it('ancestorIds walks to the root', () => {
    const nodes = [
      { id: 'src', name: 'src', type: 'folder', parentId: null },
      { id: 'comp', name: 'components', type: 'folder', parentId: 'src' },
      { id: 'app', name: 'App.jsx', type: 'file', parentId: 'comp' },
    ];
    assert.deepEqual(ancestorIds(nodes, 'app'), ['comp', 'src']);
    assert.deepEqual(ancestorIds(nodes, 'src'), []);
  });
});

describe('language and icon mapping', () => {
  it('maps common extensions to Monaco languages', () => {
    assert.equal(languageForFileName('App.jsx'), 'javascript');
    assert.equal(languageForFileName('main.py'), 'python');
    assert.equal(languageForFileName('a.ts'), 'typescript');
    assert.equal(languageForFileName('README.md'), 'markdown');
    assert.equal(languageForFileName('data.json'), 'json');
    assert.equal(languageForFileName('noext'), 'plaintext');
    assert.equal(languageForFileName('weird.xyz'), 'plaintext');
  });

  it('colors known types, defaults the rest', () => {
    assert.equal(colorForFileName('a.js'), '#f0db4f');
    assert.equal(colorForFileName('a.py'), '#4b8bbe');
    assert.equal(colorForFileName('a.xyz'), '#8db9e2');
  });
});

describe('persistence round-trip', () => {
  it('saves virtual nodes and restores them, never the shared doc', () => {
    const storage = memStorage();
    const nodes = [
      sharedFileNode(),
      { id: 'f', name: 'src', type: 'folder', parentId: null, content: '', updatedAt: 1 },
      { id: 'a', name: 'App.jsx', type: 'file', parentId: 'f', content: 'hello', updatedAt: 2 },
    ];
    assert.equal(saveTree(storage, { nodes, openIds: ['shared-collaborative-code', 'a'], activeId: 'a' }), true);
    const restored = loadTree(storage);
    assert.deepEqual(
      restored.nodes.map((n) => n.name),
      ['src', 'App.jsx'],
    );
    assert.equal(restored.nodes.find((n) => n.id === 'a').content, 'hello');
    assert.deepEqual(restored.openIds, ['shared-collaborative-code', 'a']);
    assert.equal(restored.activeId, 'a');
  });

  it('returns null for missing or corrupt data', () => {
    assert.equal(loadTree(memStorage()), null);
    assert.equal(loadTree(memStorage({ 'syncspace:file-tree': 'not-json' })), null);
  });
});
