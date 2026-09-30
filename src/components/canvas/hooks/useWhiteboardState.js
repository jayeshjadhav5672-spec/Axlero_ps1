import { useCallback, useEffect, useRef, useState } from 'react';
import { isValidShape, normalizeShape, serializeShape, serializeShapes } from '../utils/shapes.js';
import useCanvasHistory, { HISTORY_LIMIT } from './useCanvasHistory.js';

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
 * Real-time sync (unified `LIVE_COLLAB_EVENTS` protocol): pass `socket` +
 * `roomId` and the store broadcasts every local mutation
 * (`shapes:commit` / `shapes:update-batch` / `shapes:delete` /
 * `canvas:clear` / `canvas:history-sync`) and applies inbound events from
 * peers — but ONLY in uncontrolled mode. In controlled mode the parent
 * shell owns transport via the collab callbacks (emitting here too would
 * double-apply on peers), so socket emission and inbound listeners stay
 * off and the legacy callback path is the single source of truth.
 * Echo loops are structurally impossible: inbound events apply through
 * silent appliers that never emit, never touch history, and never fire
 * collab callbacks; `fromRemote` options suppress emission for any future
 * caller routing remote ops through the commit helpers.
 *
 * Undo/redo: every local mutation (create/update/transform/delete/clear/
 * reorder) pushes a full-array snapshot onto `history`; `historyStep`
 * indexes the current snapshot. `undo()`/`redo()` move the pointer,
 * restore the snapshot (uncontrolled) or forward it via `onShapesReorder`
 * (controlled/Yjs), and clear the selection. Uncontrolled restores also
 * broadcast `canvas:history-sync` so peers converge.
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
  // Unified-protocol transport (uncontrolled mode only — see header).
  socket = null,
  roomId = null,
} = {}) {
  const isControlled = controlledShapes !== undefined;

  const [internalShapes, setInternalShapes] = useState([]);
  const [internalSelection, setInternalSelection] = useState(null);

  // Room mirror for the inbound subscription (socket identity is stable,
  // so the listener set attaches once and filters on the live room).
  const roomRef = useRef(roomId);
  roomRef.current = roomId;

  /**
   * Best-effort unified broadcast. Controlled mode never emits — the
   * parent shell propagates the same intent through the collab callbacks
   * (`canvas:update` ops), and emitting here too would double-apply every
   * mutation on peers. Never throws into mutation paths.
   */
  const emitUnified = useCallback(
    (event, data) => {
      try {
        if (isControlled) return;
        if (!socket || typeof socket.emit !== 'function') return;
        if (!roomId) return;
        if (socket.connected === false) return;
        socket.emit(event, { roomId, data });
      } catch {
        // sync is best-effort; local state already applied
      }
    },
    [isControlled, socket, roomId],
  );

  // ---- undo/redo history: immutable ring buffer (max 50 states) ----
  // `past` = serialized snapshots, `present` = current shapes,
  // `future` = redo stack. Pushes happen on discrete operations only
  // (create/update/transform/delete/clear/reorder); high-frequency
  // freehand strokes commit once on pointerUp (see useCanvasDrawing).
  const {
    push: pushHistory,
    undo: historyUndo,
    redo: historyRedo,
    canUndo,
    canRedo,
    history,
    historyStep,
  } = useCanvasHistory({ limit: HISTORY_LIMIT });
  // Ref mirrors avoid stale-closure drops when commits fire in quick
  // succession (recordHistory is a stable callback with no state deps).
  const recordHistory = useCallback(
    (nextShapes) => {
      pushHistory(nextShapes);
    },
    [pushHistory],
  );

  const shapes = isControlled ? controlledShapes : internalShapes;
  const selectedId =
    controlledSelection !== undefined ? controlledSelection : internalSelection;

  const commitCreate = useCallback(
    (shape, { fromRemote = false } = {}) => {
      if (!isValidShape(shape)) return;
      const withOpacity = withNormalizedOpacity(shape);
      const clean = serializeShape(normalizeShape(withOpacity));
      if (!clean) return;
      const next = [...(shapes ?? []), clean];
      if (!isControlled) setInternalShapes(next);
      recordHistory(next);
      onShapeCreate?.(clean);
      if (!fromRemote) emitUnified('shapes:commit', { shapes: [clean] });
    },
    [isControlled, onShapeCreate, recordHistory, shapes, emitUnified],
  );

  const commitUpdate = useCallback(
    (shapeId, changes, { fromRemote = false } = {}) => {
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
      if (!fromRemote) emitUnified('shapes:update-batch', { shapes: [{ id: shapeId, ...clean }] });
    },
    [isControlled, onShapeUpdate, recordHistory, shapes, emitUnified],
  );

  const commitDelete = useCallback(
    (shapeId, { fromRemote = false } = {}) => {
      if (!shapeId) return;
      // Already gone (e.g. eraser pointerdown + click double-fire):
      // record nothing and emit nothing — keeps history and the
      // collaboration channel free of duplicate delete ops.
      if (!(shapes ?? []).some((s) => s.id === shapeId)) return;
      const next = (shapes ?? []).filter((s) => s.id !== shapeId);
      if (!isControlled) setInternalShapes(next);
      recordHistory(next);
      onShapeDelete?.(shapeId);
      if (!fromRemote) emitUnified('shapes:delete', { shapeIds: [shapeId] });
    },
    [isControlled, onShapeDelete, recordHistory, shapes, emitUnified],
  );

  const selectShape = useCallback(
    (shapeId) => {
      if (controlledSelection === undefined) setInternalSelection(shapeId);
      onSelectionChange?.(shapeId);
    },
    [controlledSelection, onSelectionChange],
  );

  /**
   * Atomic delete: remove the shape(s), reset the selection to null, and
   * fire onShapeDelete in one synchronized update. Resetting the
   * selection here (rather than leaving it to callers) guarantees the
   * board never points at a removed shape — the root cause of
   * "subsequent deletions fail until Clear" reports.
   * Accepts a single id or an array (multi-select); emits one
   * `shapes:delete` carrying every actually-removed id.
   * The Konva Transformer detach itself happens in the interaction
   * layer (`useCanvasDrawing`), which owns the node refs.
   */
  const deleteShape = useCallback(
    (idToDelete, { fromRemote = false } = {}) => {
      const ids = Array.isArray(idToDelete) ? idToDelete : [idToDelete];
      if (ids.length === 0 || !ids.some(Boolean)) return;
      // Same already-gone guard as commitDelete (see above).
      const removed = (shapes ?? []).filter((s) => ids.includes(s.id)).map((s) => s.id);
      if (removed.length === 0) return;
      const removedSet = new Set(removed);
      const next = (shapes ?? []).filter((s) => !removedSet.has(s.id));
      if (!isControlled) setInternalShapes(next);
      recordHistory(next);
      if (controlledSelection === undefined) setInternalSelection(null);
      for (const id of removed) onShapeDelete?.(id);
      onSelectionChange?.(null);
      if (!fromRemote) emitUnified('shapes:delete', { shapeIds: removed });
    },
    [controlledSelection, isControlled, onSelectionChange, onShapeDelete, recordHistory, shapes, emitUnified],
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

  const clearAll = useCallback(({ fromRemote = false } = {}) => {
    if (!isControlled) setInternalShapes([]);
    recordHistory([]);
    if (controlledSelection === undefined) setInternalSelection(null);
    onCanvasClear?.();
    if (!fromRemote) emitUnified('canvas:clear', {});
  }, [controlledSelection, isControlled, onCanvasClear, recordHistory, emitUnified]);

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
      // Uncontrolled + socket: propagate the reorder as a batch carrying
      // the full new order (peers adopt sender order when id sets match).
      // Always local intent — remote order arrives via the silent inbound
      // appliers below, never through reorder().
      emitUnified('shapes:update-batch', { shapes: next });
    },
    [isControlled, onShapesReorder, recordHistory, shapes, emitUnified],
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
   * Bound to Cmd+Z / Ctrl+Z (undo) and Cmd+Shift+Z / Ctrl+Shift+Z or
   * Cmd+Y (redo) in useCanvasDrawing.
   */
  const restoreSnapshot = useCallback(
    (snapshot) => {
      const clean = serializeShapes(snapshot);
      if (!isControlled) setInternalShapes(clean);
      if (controlledSelection === undefined) setInternalSelection(null);
      onSelectionChange?.(null);
      if (isControlled) onShapesReorder?.(clean);
    },
    [controlledSelection, isControlled, onSelectionChange, onShapesReorder],
  );

  const undo = useCallback(() => {
    const snapshot = historyUndo();
    if (snapshot === null) return;
    restoreSnapshot(snapshot);
    // Uncontrolled + socket: broadcast the restored snapshot so peers
    // converge (controlled mode propagates via onShapesReorder instead).
    if (!isControlled) emitUnified('canvas:history-sync', { shapes: serializeShapes(snapshot) });
  }, [historyUndo, restoreSnapshot, isControlled, emitUnified]);

  const redo = useCallback(() => {
    const snapshot = historyRedo();
    if (snapshot === null) return;
    restoreSnapshot(snapshot);
    if (!isControlled) emitUnified('canvas:history-sync', { shapes: serializeShapes(snapshot) });
  }, [historyRedo, restoreSnapshot, isControlled, emitUnified]);

  /**
   * Inbound unified-protocol listeners (uncontrolled mode only). Every
   * handler applies through SILENT appliers — direct `setInternalShapes`
   * writes with no history push, no re-emit, and no collab callbacks —
   * which makes echo loops structurally impossible (remote state never
   * re-enters the broadcast path). Room filtering uses the live roomRef so
   * a room switch never needs a resubscribe. Like `applyRemoteShapes`,
   * remote state stays out of undo history: undo reverts local intent.
   */
  useEffect(() => {
    if (isControlled || !socket || typeof socket.on !== 'function') return undefined;
    const roomOk = (payload) => !!payload && payload.roomId === roomRef.current;

    // Accept both commit envelopes: { shape } (legacy) and { shapes: [] }.
    const commitListOf = (data) => {
      if (!data || typeof data !== 'object') return [];
      if (Array.isArray(data.shapes)) return data.shapes;
      if (data.shape !== undefined) return [data.shape];
      return [];
    };

    const handleCommit = (payload) => {
      if (!roomOk(payload)) return;
      const clean = serializeShapes(commitListOf(payload.data));
      if (clean.length === 0) return;
      setInternalShapes((prev) => {
        const known = new Set(prev.map((s) => s.id));
        const fresh = clean.filter((s) => !known.has(s.id));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
    };

    const handleBatch = (payload) => {
      if (!roomOk(payload)) return;
      const list = Array.isArray(payload.data?.shapes) ? payload.data.shapes : [];
      if (list.length === 0) return;
      setInternalShapes((prev) => {
        const merged = new Map(prev.map((s) => [s.id, s]));
        for (const inc of list) {
          if (!inc || typeof inc !== 'object' || typeof inc.id !== 'string') continue;
          const { id, ...changes } = inc;
          const cleanChanges = serializeShape(withNormalizedOpacity(changes)) ?? {};
          const base = merged.get(id);
          if (base) {
            merged.set(id, normalizeShape({ ...base, ...cleanChanges }));
          } else {
            const candidate = normalizeShape({ id, ...cleanChanges });
            if (isValidShape(candidate)) merged.set(id, candidate);
          }
        }
        // Adopt sender order when id sets match (reorder sync); otherwise
        // keep local order and append newcomers at the end.
        const inIds = list.filter((s) => s && typeof s.id === 'string').map((s) => s.id);
        if (inIds.length === prev.length && inIds.every((id) => merged.has(id))) {
          const prevIds = new Set(prev.map((s) => s.id));
          if (inIds.every((id) => prevIds.has(id))) return inIds.map((id) => merged.get(id));
        }
        return [...merged.values()];
      });
    };

    const handleDelete = (payload) => {
      if (!roomOk(payload)) return;
      const data = payload.data ?? {};
      const raw = Array.isArray(data.shapeIds) ? data.shapeIds : data.shapeId !== undefined ? [data.shapeId] : [];
      const ids = new Set(raw.filter((id) => typeof id === 'string'));
      if (ids.size === 0) return;
      setInternalShapes((prev) => prev.filter((s) => !ids.has(s.id)));
      setInternalSelection((sel) => (sel && ids.has(sel) ? null : sel));
    };

    const handleClear = (payload) => {
      if (!roomOk(payload)) return;
      setInternalShapes([]);
      setInternalSelection(null);
    };

    const handleHistorySync = (payload) => {
      if (!roomOk(payload)) return;
      if (!payload.data || !Array.isArray(payload.data.shapes)) return;
      setInternalShapes(serializeShapes(payload.data.shapes));
      setInternalSelection(null);
    };

    // Late-joiner convergence: the server sends the room's current
    // snapshot as `canvas:sync-init` right after `room:joined`. An empty
    // local board adopts it wholesale; otherwise server state wins on id
    // conflicts while local-only shapes are preserved (covers rejoin with
    // unsynced work). Silent like all inbound appliers — no history, no
    // emit, no callbacks. Controlled shells own their own snapshot
    // reconciliation, so this listener stays uncontrolled-only.
    const handleSyncInit = (payload) => {
      if (!roomOk(payload)) return;
      if (!payload || !Array.isArray(payload.shapes)) return;
      const clean = serializeShapes(payload.shapes);
      setInternalShapes((prev) => {
        if ((prev ?? []).length === 0) return clean;
        const byId = new Map(clean.map((s) => [s.id, s]));
        const merged = clean.slice();
        for (const s of prev) {
          if (!byId.has(s.id)) merged.push(s);
        }
        return merged.length === prev.length && merged.every((s, i) => s === prev[i]) ? prev : merged;
      });
    };

    socket.on('shapes:commit', handleCommit);
    socket.on('shapes:update-batch', handleBatch);
    socket.on('shapes:delete', handleDelete);
    socket.on('canvas:clear', handleClear);
    socket.on('canvas:history-sync', handleHistorySync);
    socket.on('canvas:sync-init', handleSyncInit);
    return () => {
      try {
        socket.off?.('shapes:commit', handleCommit);
        socket.off?.('shapes:update-batch', handleBatch);
        socket.off?.('shapes:delete', handleDelete);
        socket.off?.('canvas:clear', handleClear);
        socket.off?.('canvas:history-sync', handleHistorySync);
        socket.off?.('canvas:sync-init', handleSyncInit);
      } catch {
        // ignore teardown failures
      }
    };
  }, [isControlled, socket]);

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
