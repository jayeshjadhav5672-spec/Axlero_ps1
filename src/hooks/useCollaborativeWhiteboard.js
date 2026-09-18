/**
 * useCollaborativeWhiteboard — Integration Engineer (core integration)
 *
 * Binds Sayon's <Whiteboard /> (controlled mode) to Arun's canvas:update
 * transport without touching Sayon's code:
 * - local Whiteboard callbacks update local state AND emit an op
 * - remote ops only update local state — they are never re-emitted,
 *   so synchronization loops are structurally impossible
 * - op validation/dedupe/echo-guards live in lib/collabOps.js (unit-tested)
 *
 * Room isolation: payloads for other rooms are ignored here (the server
 * already scopes delivery per room; this is the second guard).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyWhiteboardOp, isValidWhiteboardOp } from '../lib/collabOps.js';

export default function useCollaborativeWhiteboard({ socket, roomId, enabled = true }) {
  const [shapes, setShapes] = useState([]);
  const roomRef = useRef(roomId);
  roomRef.current = roomId;

  const emit = useCallback(
    (op) => {
      try {
        if (!socket || !enabled || !socket.connected) return;
        socket.emit('canvas:update', {
          roomId: roomRef.current,
          data: { ...op, actorId: socket.id },
        });
      } catch {
        // emit path — local state is already updated, never throw
      }
    },
    [socket, enabled],
  );

  const onShapeCreate = useCallback(
    (shape) => {
      setShapes((prev) => [...prev, shape]);
      emit({ op: 'create', shape });
    },
    [emit],
  );

  const onShapeUpdate = useCallback(
    (shapeId, changes) => {
      setShapes((prev) => prev.map((s) => (s && s.id === shapeId ? { ...s, ...changes } : s)));
      emit({ op: 'update', shapeId, changes });
    },
    [emit],
  );

  const onShapeDelete = useCallback(
    (shapeId) => {
      setShapes((prev) => prev.filter((s) => !s || s.id !== shapeId));
      emit({ op: 'delete', shapeId });
    },
    [emit],
  );

  const onCanvasClear = useCallback(() => {
    setShapes([]);
    emit({ op: 'clear' });
  }, [emit]);

  // Sayon PR #4: z-order + undo/redo restore forward the FULL array via
  // onShapesReorder. Same pattern as the other handlers — local set +
  // emit; receivers apply without re-emitting (loop-free by construction).
  const onShapesReorder = useCallback(
    (nextShapes) => {
      setShapes(Array.isArray(nextShapes) ? nextShapes : []);
      emit({ op: 'reorder', shapes: Array.isArray(nextShapes) ? nextShapes : [] });
    },
    [emit],
  );

  useEffect(() => {
    if (!socket) return undefined;
    const handleRemote = (payload) => {
      if (!payload || payload.roomId !== roomRef.current) return;
      const op = payload.data;
      if (!isValidWhiteboardOp(op)) return;
      const selfId = socket.id;
      setShapes((prev) => applyWhiteboardOp(prev, op, selfId).shapes);
    };
    // Initial hydration: the server sends the room snapshot as
    // `canvas:sync-init` right after `room:joined`. An empty local board
    // adopts it wholesale; otherwise server state wins on id conflicts
    // while local-only shapes are preserved (rejoin with unsynced work).
    // Loop-free: this write never re-emits (receivers apply, never echo).
    const handleSyncInit = (payload) => {
      if (!payload || payload.roomId !== roomRef.current) return;
      if (!Array.isArray(payload.shapes)) return;
      const clean = payload.shapes.filter((s) => s && typeof s.id === 'string');
      setShapes((prev) => {
        if ((prev ?? []).length === 0) return clean;
        const byId = new Map(clean.map((s) => [s.id, s]));
        const merged = clean.slice();
        for (const s of prev) {
          if (!byId.has(s.id)) merged.push(s);
        }
        return merged.length === prev.length && merged.every((s, i) => s === prev[i]) ? prev : merged;
      });
    };
    socket.on('canvas:update', handleRemote);
    socket.on('canvas:sync-init', handleSyncInit);
    return () => {
      socket.off('canvas:update', handleRemote);
      socket.off('canvas:sync-init', handleSyncInit);
    };
  }, [socket]);

  return useMemo(
    () => ({ shapes, onShapeCreate, onShapeUpdate, onShapeDelete, onCanvasClear, onShapesReorder }),
    [shapes, onShapeCreate, onShapeUpdate, onShapeDelete, onCanvasClear, onShapesReorder],
  );
}
