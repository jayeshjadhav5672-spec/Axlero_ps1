/**
 * fileTree.js — pure helpers for the frontend-only virtual Explorer tree.
 *
 * ARCHITECTURE NOTE (do not remove): the Explorer file/folder tree is
 * frontend-only React state (persisted to localStorage when available).
 * The repository has NO backend filesystem and NO multi-document
 * collaboration architecture. Only the special "Collaborative Code"
 * document (SHARED_FILE_ID) uses the existing `useCollaborativeCode`
 * transport; every other virtual file is local to this browser session
 * and is never sent over Socket.io.
 *
 * Node shape:
 *   { id, name, type: 'file' | 'folder', parentId: string | null,
 *     content: string (files), shared?: true, updatedAt: number }
 *
 * No React, no DOM here — imported by CodeEditorPanel and by node --test.
 */

export const SHARED_FILE_ID = 'shared-collaborative-code';
export const SHARED_FILE_NAME = 'Collaborative Code';
export const TREE_STORAGE_KEY = 'syncspace:file-tree';
export const MAX_NAME_LENGTH = 100;
const MAX_PERSISTED_NODES = 500;

export function sharedFileNode() {
  return {
    id: SHARED_FILE_ID,
    name: SHARED_FILE_NAME,
    type: 'file',
    parentId: null,
    shared: true,
    content: '',
    updatedAt: 0,
  };
}

export function makeNodeId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the Math.random fallback
  }
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Validate a user-typed file/folder name. Users build hierarchy through
 * the Explorer, so path separators and traversal segments are rejected.
 * Returns { ok: true, name } or { ok: false, error }.
 */
export function validateItemName(rawName) {
  const name = (rawName ?? '').trim();
  if (!name) return { ok: false, error: 'Enter a name.' };
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Keep names under ${MAX_NAME_LENGTH} characters.` };
  }
  if (/[\\/]/.test(name)) {
    return { ok: false, error: "Names can't contain / or \\ — create hierarchy with New File / New Folder." };
  }
  if (name === '.' || name === '..' || /^\.+$/.test(name)) {
    return { ok: false, error: 'That name is reserved.' };
  }
  if (/[\0-\x1f\x7f]/.test(name)) {
    return { ok: false, error: "Names can't contain control characters." };
  }
  return { ok: true, name };
}

/** True when a sibling of the same parent already uses the name (case-insensitive). */
export function siblingNameTaken(nodes, parentId, name) {
  const lower = String(name).toLowerCase();
  const parent = parentId ?? null;
  return (nodes ?? []).some(
    (n) => (n?.parentId ?? null) === parent && String(n?.name ?? '').toLowerCase() === lower,
  );
}

function nodeRank(node) {
  if (node?.shared) return 0;
  if (node?.type === 'folder') return 1;
  return 2;
}

/** Shared doc first, then folders, then files — alphabetical within each group. */
export function sortTreeNodes(nodes) {
  return [...(nodes ?? [])].sort(
    (a, b) => nodeRank(a) - nodeRank(b) || String(a?.name ?? '').localeCompare(String(b?.name ?? '')),
  );
}

export function childrenOf(nodes, parentId) {
  const parent = parentId ?? null;
  return sortTreeNodes((nodes ?? []).filter((n) => (n?.parentId ?? null) === parent));
}

/** Ids of all ancestors of a node (nearest first). Empty for root items. */
export function ancestorIds(nodes, id) {
  const byId = new Map((nodes ?? []).map((n) => [n?.id, n]));
  const chain = [];
  let current = byId.get(id);
  let guard = 0;
  while (current && current.parentId != null && guard < 1000) {
    chain.push(current.parentId);
    current = byId.get(current.parentId);
    guard += 1;
  }
  return chain;
}

const EXTENSION_LANGUAGE = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  py: 'python',
  md: 'markdown',
  java: 'java',
  c: 'c',
  h: 'cpp',
  cpp: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  sh: 'shell',
  txt: 'plaintext',
};

/** Monaco language id for a virtual filename (unknown → plaintext). */
export function languageForFileName(name) {
  const base = String(name ?? '');
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return 'plaintext';
  const ext = base.slice(dot + 1).toLowerCase();
  return EXTENSION_LANGUAGE[ext] ?? 'plaintext';
}

const EXTENSION_COLOR = {
  js: '#f0db4f',
  jsx: '#61dafb',
  ts: '#3178c6',
  tsx: '#61dafb',
  json: '#cbcb41',
  html: '#e34c26',
  css: '#42a5f5',
  scss: '#cd6799',
  less: '#2b6ac3',
  py: '#4b8bbe',
  md: '#9e9e9e',
};

/** Accent color for a virtual filename's icon (unknown → default blue). */
export function colorForFileName(name) {
  const base = String(name ?? '');
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '#8db9e2';
  return EXTENSION_COLOR[base.slice(dot + 1).toLowerCase()] ?? '#8db9e2';
}

function isPersistableNode(n) {
  return (
    n &&
    typeof n.id === 'string' &&
    typeof n.name === 'string' &&
    (n.type === 'file' || n.type === 'folder') &&
    (n.parentId === null || typeof n.parentId === 'string') &&
    n.id !== SHARED_FILE_ID
  );
}

/**
 * Persist virtual nodes only (never the shared doc — its content belongs
 * to the collaboration transport). `storage` is injected so tests can pass
 * a stub; the panel passes localStorage. Never throws.
 */
export function saveTree(storage, { nodes, openIds, activeId }) {
  try {
    const virtual = (nodes ?? []).filter(isPersistableNode).slice(0, MAX_PERSISTED_NODES);
    storage.setItem(
      TREE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        nodes: virtual.map((n) => ({
          id: n.id,
          name: n.name,
          type: n.type,
          parentId: n.parentId ?? null,
          content: n.type === 'file' ? String(n.content ?? '') : '',
          updatedAt: Number(n.updatedAt) || 0,
        })),
        openIds: (openIds ?? []).filter((id) => typeof id === 'string'),
        activeId: typeof activeId === 'string' ? activeId : null,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Restore persisted virtual nodes. Returns null when nothing usable exists. */
export function loadTree(storage) {
  try {
    const raw = storage?.getItem?.(TREE_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.nodes)) return null;
    const nodes = data.nodes.filter(isPersistableNode).slice(0, MAX_PERSISTED_NODES);
    return {
      nodes,
      openIds: Array.isArray(data.openIds)
        ? data.openIds.filter((id) => typeof id === 'string')
        : [],
      activeId: typeof data.activeId === 'string' ? data.activeId : null,
    };
  } catch {
    return null;
  }
}
