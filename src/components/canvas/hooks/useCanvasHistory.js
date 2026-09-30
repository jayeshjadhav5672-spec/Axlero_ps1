import { useCallback, useRef, useState } from 'react';
import { serializeShapes } from '../utils/shapes.js';

export const HISTORY_LIMIT = 50;

/**
 * useCanvasHistory — immutable undo/redo history ring buffer.
 *
 * Lightweight, serializable state history (maximum 50 states, FIFO
 * truncation). Maintains `past` (array of serialized shape snapshots),
 * `present` (current shapes), and `future` (redo stack).
 *
 * Snapshots are pushed on discrete operations only: dragEnd,
 * transformEnd, shape additions, deletions, and morphing. High-frequency
 * freehand strokes must push once on pointerUp (callers commit the
 * finished stroke a single time — see useCanvasDrawing.handleStageMouseUp).
 *
 * All snapshots are JSON-serializable (via serializeShapes) so the stack
 * stays Yjs/CRDT-safe and cheap to clone.
 */
export default function useCanvasHistory({ limit = HISTORY_LIMIT, initial = [] } = {}) {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : HISTORY_LIMIT;
  const [past, setPast] = useState([]);
  const [present, setPresent] = useState(() => serializeShapes(initial));
  const [future, setFuture] = useState([]);

  // Ref mirrors avoid stale-closure drops when commits fire in quick
  // succession (push is a stable callback with no state deps).
  const pastRef = useRef([]);
  const presentRef = useRef(serializeShapes(initial));
  const futureRef = useRef([]);

  const syncState = useCallback(() => {
    setPast([...pastRef.current]);
    setPresent(presentRef.current ? [...presentRef.current] : []);
    setFuture([...futureRef.current]);
  }, []);

  /**
   * Push a new snapshot: current present moves to past (FIFO-capped at
   * `cap`), present becomes the cleaned next state, future clears.
   * No-op when the next state is deep-equal to present.
   */
  const push = useCallback(
    (nextShapes) => {
      const clean = serializeShapes(nextShapes);
      const cur = presentRef.current ?? [];
      if (JSON.stringify(cur) === JSON.stringify(clean)) return;
      const grown = [...pastRef.current, cur];
      const trimmed = grown.length > cap ? grown.slice(grown.length - cap) : grown;
      pastRef.current = trimmed;
      presentRef.current = clean;
      futureRef.current = [];
      syncState();
      return clean;
    },
    [cap, syncState],
  );

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return null;
    const prev = pastRef.current[pastRef.current.length - 1];
    const rest = pastRef.current.slice(0, -1);
    futureRef.current = [presentRef.current, ...futureRef.current];
    pastRef.current = rest;
    presentRef.current = serializeShapes(prev);
    syncState();
    return presentRef.current;
  }, [syncState]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return null;
    const [next, ...rest] = futureRef.current;
    pastRef.current = [...pastRef.current, presentRef.current].slice(-cap);
    presentRef.current = serializeShapes(next);
    futureRef.current = rest;
    syncState();
    return presentRef.current;
  }, [cap, syncState]);

  /** Replace present without touching past/future (remote/Yjs snapshots). */
  const replace = useCallback(
    (nextShapes) => {
      presentRef.current = serializeShapes(nextShapes);
      syncState();
      return presentRef.current;
    },
    [syncState],
  );

  const reset = useCallback(
    (nextShapes = []) => {
      pastRef.current = [];
      presentRef.current = serializeShapes(nextShapes);
      futureRef.current = [];
      syncState();
    },
    [syncState],
  );

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  // Back-compat linear view: history[step] === present.
  const history = [...past, present];
  const historyStep = past.length;

  return {
    past,
    present,
    future,
    history,
    historyStep,
    push,
    undo,
    redo,
    replace,
    reset,
    canUndo,
    canRedo,
    limit: cap,
  };
}
