import { useCallback, useState } from 'react';
import { isValidShape, normalizeShape, serializeShape, serializeShapes } from '../utils/shapes.js';

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
 */
export default function useWhiteboardState({
  shapes: controlledShapes,
  selectedShapeId: controlledSelection,
  onShapeCreate,
  onShapeUpdate,
  onShapeDelete,
  onCanvasClear,
  onSelectionChange,
} = {}) {
  const isControlled = controlledShapes !== undefined;

  const [internalShapes, setInternalShapes] = useState([]);
  const [internalSelection, setInternalSelection] = useState(null);

  const shapes = isControlled ? controlledShapes : internalShapes;
  const selectedId =
    controlledSelection !== undefined ? controlledSelection : internalSelection;

  const commitCreate = useCallback(
    (shape) => {
      if (!isValidShape(shape)) return;
      const clean = serializeShape(normalizeShape(shape));
      if (!clean) return;
      if (!isControlled) setInternalShapes((prev) => [...prev, clean]);
      onShapeCreate?.(clean);
    },
    [isControlled, onShapeCreate],
  );

  const commitUpdate = useCallback(
    (shapeId, changes) => {
      if (!shapeId || !changes || Object.keys(changes).length === 0) return;
      const clean = serializeShape(changes);
      if (!clean) return;
      if (!isControlled) {
        setInternalShapes((prev) =>
          prev.map((s) => (s.id === shapeId ? normalizeShape({ ...s, ...clean }) : s)),
        );
      }
      onShapeUpdate?.(shapeId, clean);
    },
    [isControlled, onShapeUpdate],
  );

  const commitDelete = useCallback(
    (shapeId) => {
      if (!shapeId) return;
      if (!isControlled) {
        setInternalShapes((prev) => prev.filter((s) => s.id !== shapeId));
      }
      onShapeDelete?.(shapeId);
    },
    [isControlled, onShapeDelete],
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
      if (!isControlled) {
        setInternalShapes((prev) => prev.filter((s) => s.id !== idToDelete));
      }
      if (controlledSelection === undefined) setInternalSelection(null);
      onShapeDelete?.(idToDelete);
      onSelectionChange?.(null);
    },
    [controlledSelection, isControlled, onSelectionChange, onShapeDelete],
  );

  /**
   * Reconcile an EXTERNAL (remote/Yjs snapshot) shape array into the local
   * uncontrolled store. Invalid entries are dropped; valid ones are
   * normalized + cloned so remote object identity never leaks into state.
   * In controlled mode this is a no-op (parent already owns the array) —
   * remote updates arrive via the `shapes` prop directly.
   *
   * Returns the number of shapes applied.
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
    if (controlledSelection === undefined) setInternalSelection(null);
    onCanvasClear?.();
  }, [controlledSelection, isControlled, onCanvasClear]);

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
  };
}
