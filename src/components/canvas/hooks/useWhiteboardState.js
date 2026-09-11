import { useCallback, useRef, useState } from 'react';
import { isValidShape, normalizeShape, serializeShape, serializeShapes } from '../utils/shapes.js';

const HISTORY_LIMIT = 100;

/**
 * hooks/useWhiteboardState.js — Sayon (Whiteboard / Konva.js Engineer)
 *
 * Local shape store for the whiteboard. Holds ONLY plain serializable
 * objects (no Konva nodes). Supports two modes:
 *
 * - Uncontrolled (default): `shapes` prop omitted; the hook owns the array.
 * - Controlled (Yjs/Socket): `shapes` prop provided; the hook treats it as
 *   the source of truth and never mutates it — parents apply the callback
 *   payloads (`onShapeCreate/Update/Delete/Clear`) to their external store.
 *
 * Every commit helper normalizes + serializes before storing/firing, and
 * always fires its collaboration callback in both modes.
 *
 * Undo/redo: every local mutation (create/update/transform/delete/clear/
 * reorder) pushes a full-array snapshot onto `history`; `historyStep`
 * indexes the current snapshot. `undo()`/`redo()` move the pointer,
 * restore the snapshot (uncontrolled) or forward it via `onShapesReorder`
 * (controlled/Yjs), and clear the selection.
 *
 * Contextual inspectors (Arrow / Text) commit through the same JSON
 * boundary: `commitUpdate(id, { arrowType })`, `{ fontFamily,
 * fontFamilyKey }`, `{ fontSize }`, `{ align, textAlign }`, `{ opacity }`,
 * `{ pointer... }` via start/endArrowhead. All values stay plain
 * JSON-serializable so Yjs/CRDT sync needs no new channels.
 */

/** Clamp/normalize an opacity payload: accepts 0-1 or 0-100 slider values. */
function normalizeOpacityValue(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return v;
  if (v > 1) return Math.min(1, Math.max(0, v / 100));
  return Math.min(1, Math.max(0, v));
}

function withNormalizedOpacity(payload) {
  if (!payload || typeof payload !== 'object' || payload.opacity === undefined) return payload;
  return { ...payload, opacity: normalizeOpacityValue(payload.opacity) };
}
export default function useWhiteboardState({
  shapes: controlledShapes,
  selectedShapeId: controlledSelection,
  onShapeCreate,
  onShapeUpdate,
  onShapeDelete,
  onCanvasClear,
  onSelectionChange,
  onShapesReorder,
} = {}) {
  const isControlled = controlledShapes !== undefined;

  const [internalShapes, setInternalShapes] = useState([]);
  const [internalSelection, setInternalSelection] = useState(null);

  // ---- undo/redo history: full-array snapshots; historyStep = current ----
  const [history, setHistory] = useState([]);
  const [historyStep, setHistoryStep] = useState(0);
  // Ref mirrors avoid stale-closure drops when commits fire in quick
  // succession (recordHistory is a stable callback with no state deps).
  const historyRef = useRef([]);
  const stepRef = useRef(0);

  const recordHistory = useCallback((nextShapes) => {
    const clean = serializeShapes(nextShapes);
    const prev = historyRef.current;
    const base = prev.length === 0 ? [[]] : prev.slice(0, stepRef.current + 1);
    let grown = [...base, clean];
    if (grown.length > HISTORY_LIMIT) grown = grown.slice(grown.length - HISTORY_LIMIT);
    historyRef.current = grown;
    stepRef.current = grown.length - 1;
    setHistory(grown);
    setHistoryStep(grown.length - 1);
  }, []);

  const shapes = isControlled ? controlledShapes : internalShapes;
  const selectedId =
    controlledSelection !== undefined ? controlledSelection : internalSelection;

  const commitCreate = useCallback(
    (shape) => {
      if (!isValidShape(shape)) return;
      const withOpacity = withNormalizedOpacity(shape);
      const clean = serializeShape(normalizeShape(withOpacity));
      if (!clean) return;
      const next = [...(shapes ?? []), clean];
      if (!isControlled) setInternalShapes(next);
      recordHistory(next);
      onShapeCreate?.(clean);
    },
    [isControlled, onShapeCreate, recordHistory, shapes],
  );

  const commitUpdate = useCallback(
    (shapeId, changes) => {
      if (!shapeId || !changes || Object.keys(changes).length === 0) return;
      // Accept 0-100 slider payloads as well as canonical 0-1.
      const normalized = withNormalizedOpacity(changes);
      const clean = serializeShape(normalized);
      if (!clean) return;
      const next = (shapes ?? []).map((s) =>
        (s.id === shapeId ? normalizeShape({ ...s, ...clean }) : s),
      );
      if (!isControlled) setInternalShapes(next);
      recordHistory(next);
      onShapeUpdate?.(shapeId, clean);
    },
    [isControlled, onShapeUpdate, recordHistory, shapes],
  );

  const commitDelete = useCallback(
    (shapeId) => {
      if (!shapeId) return;
      const next = (shapes ?? []).filter((s) => s.id !== shapeId);
      if (!isControlled) setInternalShapes(next);
      recordHistory(next);
      onShapeDelete?.(shapeId);
    },
    [isControlled, onShapeDelete, recordHistory, shapes],
  );

  const selectShape = useCallback(
    (shapeId) => {
      if (controlledSelection === undefined) setInternalSelection(shapeId);
      onSelectionChange?.(shapeId);
    },
    [controlledSelection, onSelectionChange],
  );

  /**
   * Atomic delete: remove the shape, reset the selection to null, and
   * fire onShapeDelete in one synchronized update. Resetting the
   * selection here (rather than leaving it to callers) guarantees the
   * board never points at a removed shape — the root cause of
   * "subsequent deletions fail until Clear" reports.
   * The Konva Transformer detach itself happens in the interaction
   * layer (`useCanvasDrawing`), which owns the node refs.
   */
  const deleteShape = useCallback(
    (idToDelete) => {
      if (!idToDelete) return;
      const next = (shapes ?? []).filter((s) => s.id !== idToDelete);
      if (!isControlled) setInternalShapes(next);
      recordHistory(next);
      if (controlledSelection === undefined) setInternalSelection(null);
      onShapeDelete?.(idToDelete);
      onSelectionChange?.(null);
    },
    [controlledSelection, isControlled, onSelectionChange, onShapeDelete, recordHistory, shapes],
  );

  /**
   * Reconcile an EXTERNAL (remote/Yjs snapshot) shape array into the local
   * uncontrolled store. Invalid entries are dropped; valid ones are
   * normalized + cloned so remote object identity never leaks into state.
   * In controlled mode this is a no-op (parent already owns the array) —
   * remote updates arrive via the `shapes` prop directly.
   *
   * Returns the number of shapes applied.
   *
   * Remote snapshots are intentionally NOT recorded in undo history —
   * undo reverts local intent; replaying remote state would surprise.
   */
  const applyRemoteShapes = useCallback(
    (remoteShapes) => {
      const clean = serializeShapes(remoteShapes);
      if (!isControlled) setInternalShapes(clean);
      return clean.length;
    },
    [isControlled],
  );

  const clearAll = useCallback(() => {
    if (!isControlled) setInternalShapes([]);
    recordHistory([]);
    if (controlledSelection === undefined) setInternalSelection(null);
    onCanvasClear?.();
  }, [controlledSelection, isControlled, onCanvasClear, recordHistory]);

  /**
   * Z-ordering: `shapes` array order IS the layer order — index 0 renders
   * at the back, the last element renders on top (Konva paints in order).
   * Moving a large enclosing rectangle to the back lets nested inner
   * shapes receive pointer events first.
   */
  const reorder = useCallback(
    (shapeId, mode) => {
      if (!shapeId) return;
      const prev = shapes ?? [];
      const idx = prev.findIndex((s) => s.id === shapeId);
      if (idx === -1) return;
      const next = [...prev];
      const [moving] = next.splice(idx, 1);
      switch (mode) {
        case 'front':
          next.push(moving);
          break;
        case 'back':
          next.unshift(moving);
          break;
        case 'forward':
          next.splice(Math.min(idx + 1, next.length), 0, moving);
          break;
        case 'backward':
          next.splice(Math.max(idx - 1, 0), 0, moving);
          break;
        default:
          return;
      }
      if (!isControlled) setInternalShapes(next);
      recordHistory(next);
      // Controlled parents own the array — apply the new order via callback.
      // Uncontrolled listeners (collab) also receive the full new order.
      onShapesReorder?.(next);
    },
    [isControlled, onShapesReorder, recordHistory, shapes],
  );

  const sendToBack = useCallback((shapeId) => reorder(shapeId, 'back'), [reorder]);
  const bringToFront = useCallback((shapeId) => reorder(shapeId, 'front'), [reorder]);
  const sendBackward = useCallback((shapeId) => reorder(shapeId, 'backward'), [reorder]);
  const bringForward = useCallback((shapeId) => reorder(shapeId, 'forward'), [reorder]);

  /**
   * Restore a history snapshot: uncontrolled writes it directly;
   * controlled forwards the full array through `onShapesReorder` (the
   * existing full-array channel — no new Yjs/Socket surface) so the
   * external store stays in sync. Selection always clears.
   */
  const restoreSnapshot = useCallback(
    (snapshot, nextStep) => {
      const clean = serializeShapes(snapshot);
      stepRef.current = nextStep;
      setHistoryStep(nextStep);
      if (!isControlled) setInternalShapes(clean);
      if (controlledSelection === undefined) setInternalSelection(null);
      onSelectionChange?.(null);
      if (isControlled) onShapesReorder?.(clean);
    },
    [controlledSelection, isControlled, onSelectionChange, onShapesReorder],
  );

  const undo = useCallback(() => {
    if (stepRef.current <= 0 || historyRef.current.length === 0) return;
    const nextStep = stepRef.current - 1;
    restoreSnapshot(historyRef.current[nextStep] ?? [], nextStep);
  }, [restoreSnapshot]);

  const redo = useCallback(() => {
    if (stepRef.current >= historyRef.current.length - 1) return;
    const nextStep = stepRef.current + 1;
    restoreSnapshot(historyRef.current[nextStep] ?? [], nextStep);
  }, [restoreSnapshot]);

  const canUndo = historyStep > 0 && history.length > 0;
  const canRedo = historyStep < history.length - 1;

  return {
    shapes,
    selectedId,
    isControlled,
    commitCreate,
    commitUpdate,
    commitDelete,
    deleteShape,
    selectShape,
    applyRemoteShapes,
    clearAll,
    reorder,
    sendToBack,
    bringToFront,
    sendBackward,
    bringForward,
    undo,
    redo,
    canUndo,
    canRedo,
    history,
    historyStep,
  };
}
