/**
 * collabOps.js — Integration Engineer (core integration)
 *
 * Pure, framework-free reducers for collaborative updates. Used by the
 * React hooks AND by node --test, so the contract is verified in one place.
 *
 * Op envelopes travel inside Arun's transport payloads:
 *   socket.emit('canvas:update', { roomId, data: whiteboardOp })
 *   socket.emit('code:update',   { roomId, data: codeOp })
 *
 * Rules (shared by whiteboard + code):
 * - malformed ops are dropped, never crash the receiver
 * - ops authored by self (actorId === own socket id) are ignored:
 *   the server already excludes the sender, this is the second guard
 * - room isolation is enforced by the caller (payload.roomId check);
 *   these reducers only handle op-level safety
 */

import { isValidShape } from '../components/canvas/utils/shapes.js';

export const WHITEBOARD_OPS = ['create', 'update', 'delete', 'clear'];

/** Structural validation for an inbound whiteboard op. */
export function isValidWhiteboardOp(op) {
  if (!op || typeof op !== 'object' || Array.isArray(op)) return false;
  if (typeof op.actorId !== 'string' || op.actorId.length === 0) return false;
  switch (op.op) {
    case 'create':
      return isValidShape(op.shape);
    case 'update':
      return (
        typeof op.shapeId === 'string' &&
        op.shapeId.length > 0 &&
        !!op.changes &&
        typeof op.changes === 'object' &&
        !Array.isArray(op.changes) &&
        Object.keys(op.changes).length > 0
      );
    case 'delete':
      return typeof op.shapeId === 'string' && op.shapeId.length > 0;
    case 'clear':
      return true;
    default:
      return false;
  }
}

/**
 * Apply a remote whiteboard op to a local shape array.
 * Returns { shapes, applied }. Never mutates the input; returns the same
 * reference when nothing changed so React can skip re-renders.
 */
export function applyWhiteboardOp(shapes, op, selfId) {
  const list = Array.isArray(shapes) ? shapes : [];
  if (!isValidWhiteboardOp(op)) return { shapes: list, applied: false };
  if (op.actorId === selfId) return { shapes: list, applied: false };
  switch (op.op) {
    case 'create':
      if (list.some((s) => s && s.id === op.shape.id)) return { shapes: list, applied: false };
      return { shapes: [...list, op.shape], applied: true };
    case 'update': {
      if (!list.some((s) => s && s.id === op.shapeId)) return { shapes: list, applied: false };
      return {
        shapes: list.map((s) => (s && s.id === op.shapeId ? { ...s, ...op.changes } : s)),
        applied: true,
      };
    }
    case 'delete':
      if (!list.some((s) => s && s.id === op.shapeId)) return { shapes: list, applied: false };
      return { shapes: list.filter((s) => !s || s.id !== op.shapeId), applied: true };
    case 'clear':
      return list.length === 0 ? { shapes: list, applied: false } : { shapes: [], applied: true };
    default:
      return { shapes: list, applied: false };
  }
}

/** Structural validation for an inbound code op (last-writer-wins by rev). */
export function isValidCodeOp(op) {
  return (
    !!op &&
    typeof op === 'object' &&
    !Array.isArray(op) &&
    typeof op.text === 'string' &&
    Number.isFinite(op.rev) &&
    typeof op.actorId === 'string' &&
    op.actorId.length > 0
  );
}

/**
 * Apply a remote code op to local { text, rev } state.
 * Only strictly newer revisions win; stale/duplicate/own ops are dropped.
 * (Shree's Y.Text will replace this LWW relay with CRDT merge when it lands.)
 */
export function applyCodeOp(state, op, selfId) {
  const current =
    state && typeof state === 'object'
      ? { text: typeof state.text === 'string' ? state.text : '', rev: Number.isFinite(state.rev) ? state.rev : 0 }
      : { text: '', rev: 0 };
  if (!isValidCodeOp(op)) return { state: current, applied: false };
  if (op.actorId === selfId) return { state: current, applied: false };
  if (!(op.rev > current.rev)) return { state: current, applied: false };
  return { state: { text: op.text, rev: op.rev }, applied: true };
}
