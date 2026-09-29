/**
 * projectSync.js — pure client helpers for the shared room project.
 *
 * No React, no DOM — safe to import from hooks and node --test.
 *
 * The server (server/socket.cjs) is the authority for the file TREE;
 * contents converge per file with the same last-writer-wins-by-rev rule as
 * the legacy single document (see collabOps.js applyCodeOp). Because every
 * receiver adopts the sender's rev, revs act as a Lamport clock and the
 * per-file merge below only adopts strictly newer snapshot entries.
 *
 * Collaboration-technology note: this repo's live code sync is
 * Socket.io-based LWW, NOT Yjs wire sync (yjsProvider.js is a local,
 * transport-agnostic Y.Doc registry — Phase 1 only). Multi-file sharing
 * generalizes that same Socket.io mechanism per fileId rather than
 * replacing it. Simultaneous same-file edits therefore keep LWW semantics:
 * concurrent writers converge on the last-arriving write, with no
 * character-level merge. That limitation is documented in
 * docs/architecture.md.
 */

import { isValidCodeOp } from './collabOps.js';
import { SHARED_FILE_ID } from '../components/workspace/fileTree.js';

/** fileId carried by a code op, defaulting to the shared document (legacy ops). */
export function fileIdOfCodeOp(op) {
  if (op && typeof op.fileId === 'string' && op.fileId.length > 0) return op.fileId;
  return SHARED_FILE_ID;
}

/** A code op is receivable when it passes the legacy shape check. fileId is optional. */
export function isValidFileCodeOp(op) {
  if (!isValidCodeOp(op)) return false;
  if (op.fileId !== undefined && (typeof op.fileId !== 'string' || op.fileId.length === 0)) return false;
  return true;
}

/**
 * Merge a `project:state` files snapshot into local per-file state.
 *
 * @param {Map<string, {text, rev}>} localMap current local file states
 * @param {object} snapshotFiles server files: { [fileId]: { text, rev } }
 * @returns {{ files: Map, texts: object, changed: boolean, ahead: Array }}
 *   files/texts are the merged result; ahead lists locally-newer entries
 *   ({ fileId, text, rev }) the caller should re-emit so a reconnect that
 *   raced the snapshot still converges without resetting the room.
 */
export function mergeFileSnapshot(localMap, snapshotFiles) {
  const files = new Map(localMap instanceof Map ? localMap : []);
  const ahead = [];
  let changed = false;
  const entries =
    snapshotFiles && typeof snapshotFiles === 'object' && !Array.isArray(snapshotFiles)
      ? Object.entries(snapshotFiles)
      : [];
  for (const [id, entry] of entries) {
    if (typeof id !== 'string' || id.length === 0) continue;
    if (!entry || typeof entry.text !== 'string' || !Number.isFinite(entry.rev)) continue;
    const local = files.get(id);
    if (!local || entry.rev > local.rev) {
      files.set(id, { text: entry.text, rev: entry.rev });
      changed = true;
    } else if (local.rev > entry.rev) {
      ahead.push({ fileId: id, text: local.text, rev: local.rev });
    }
  }
  const texts = {};
  for (const [id, state] of files) texts[id] = state.text;
  return { files, texts, changed, ahead };
}

/** Ensure the shared document node is present (offline-first paint before any snapshot). */
export function ensureSharedNode(nodes, sharedNode) {
  const list = Array.isArray(nodes) ? nodes : [];
  if (list.some((n) => n && n.id === SHARED_FILE_ID)) return list;
  return [sharedNode, ...list];
}
