/**
 * yjsText.js — per-file Y.Text helpers for collaborative code (no React,
 * no DOM, no networking — safe to import from hooks and node --test).
 *
 * Model: each collaborative file has a stable shared Y.Text inside the
 * room Y.Doc, keyed by fileId (NOT filename — renames never move text):
 *
 *   room Y.Doc
 *    └── 'projectFiles' (Y.Map)
 *         ├── fileIdA → Y.Text
 *         ├── fileIdB → Y.Text
 *         └── ...
 *
 * File metadata (names, hierarchy) stays server-authoritative; ONLY text
 * lives in CRDT state. Unknown map keys (never created through here) are
 * ignored by derivation — only tree-known fileIds are read.
 *
 * Monaco binding (see useCollaborativeYjs): local keystrokes enter Y.Text
 * as character deltas computed by diffTextsToOps (never full replaces, so
 * concurrent typing merges instead of overwriting); remote Y.Text content
 * drives the editor through the existing echo guard (controlledEditorSync).
 */

import * as Y from 'yjs';

export const PROJECT_FILES_KEY = 'projectFiles';

/** Lazily return the shared Y.Text for a file, creating it when absent. */
export function getFileText(doc, fileId) {
  if (!doc || typeof doc.getMap !== 'function') {
    throw new Error('[yjsText] getFileText requires a Y.Doc-like object');
  }
  if (typeof fileId !== 'string' || fileId.length === 0) {
    throw new Error('[yjsText] getFileText requires a non-empty fileId string');
  }
  const registry = doc.getMap(PROJECT_FILES_KEY);
  const existing = registry.get(fileId);
  if (existing instanceof Y.Text) return existing;
  const text = new Y.Text();
  registry.set(fileId, text);
  return text;
}

/** True when the registry holds a Y.Text for the file. */
export function hasFileText(doc, fileId) {
  try {
    if (!doc || typeof doc.getMap !== 'function') return false;
    return doc.getMap(PROJECT_FILES_KEY).get(fileId) instanceof Y.Text;
  } catch {
    return false;
  }
}

/**
 * Delete a file's Y.Text mapping (file deletion path). Unknown ids and
 * missing registries are safe no-ops. Renames intentionally do NOT call
 * this — identity is the stable fileId, so text survives renames.
 */
export function removeFileText(doc, fileId) {
  try {
    if (!doc || typeof doc.getMap !== 'function') return false;
    if (typeof fileId !== 'string' || fileId.length === 0) return false;
    // NOTE: Y.Map.delete() returns undefined — report prior existence.
    const registry = doc.getMap(PROJECT_FILES_KEY);
    const existed = registry.has(fileId);
    registry.delete(fileId);
    return existed;
  } catch {
    return false;
  }
}

/** Current text contents keyed by fileId (tree-known ids only). */
export function readFileTexts(doc, fileIds) {
  const out = {};
  if (!doc || typeof doc.getMap !== 'function' || !Array.isArray(fileIds)) return out;
  let registry;
  try {
    registry = doc.getMap(PROJECT_FILES_KEY);
  } catch {
    return out;
  }
  for (const id of fileIds) {
    if (typeof id !== 'string' || id.length === 0) continue;
    try {
      const text = registry.get(id);
      if (text instanceof Y.Text) out[id] = text.toString();
    } catch {
      // ignore unreadable entries
    }
  }
  return out;
}

/**
 * Compute the minimal single-span edit turning prevText into nextText.
 * Returns { start, deleteCount, insert } (all numbers are UTF-16 code units,
 * matching both Monaco offsets and Y.Text indices), or null when the texts
 * are already identical. Pure and total — never throws for string input.
 */
export function diffTextsToOps(prevText, nextText) {
  const prev = typeof prevText === 'string' ? prevText : '';
  const next = typeof nextText === 'string' ? nextText : '';
  if (prev === next) return null;
  let start = 0;
  const minLength = Math.min(prev.length, next.length);
  while (start < minLength && prev.charCodeAt(start) === next.charCodeAt(start)) {
    start += 1;
  }
  let prevEnd = prev.length;
  let nextEnd = next.length;
  while (prevEnd > start && nextEnd > start && prev.charCodeAt(prevEnd - 1) === next.charCodeAt(nextEnd - 1)) {
    prevEnd -= 1;
    nextEnd -= 1;
  }
  return { start, deleteCount: prevEnd - start, insert: next.slice(start, nextEnd) };
}

/**
 * Apply Monaco-originated text as a Y.Text transaction. Uses the single-span
 * diff so concurrent remote edits merge at character level instead of being
 * overwritten by a full replace. Returns true when the doc changed.
 * `origin` marks the transaction (echo guards skip their own origin).
 */
export function applyLocalTextEdit(doc, fileId, nextText, origin) {
  const ytext = getFileText(doc, fileId);
  const ops = diffTextsToOps(ytext.toString(), nextText);
  if (!ops) return false;
  doc.transact(() => {
    if (ops.deleteCount > 0) ytext.delete(ops.start, ops.deleteCount);
    if (ops.insert.length > 0) ytext.insert(ops.start, ops.insert);
  }, origin);
  return true;
}
