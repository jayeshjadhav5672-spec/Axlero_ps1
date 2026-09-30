import { useCallback, useRef } from 'react';
import { buildSelectionPayload, SELECTION_EVENT } from '../utils/liveSync.js';

/**
 * useRemoteSelection — peer selection presence, emit side only.
 *
 * Tools and local selection stay strictly per-client; this hook broadcasts
 * `{ userId, userName, color, shapeIds }` on the room-scoped
 * `collab:selection` channel (discrete emits on selection change — the
 * caller dedupes so one tap never emits twice).
 *
 * Reception renders through CanvasStage's imperative
 * RemoteSelectionOverlay (raw Konva nodes, zero React re-renders), NOT
 * through React state here — keeping a state mirror would re-render the
 * whole board per selection packet, defeating the overlay.
 */
export default function useRemoteSelection({
  socket = null,
  roomId = null,
  userId = null,
  userName = 'Guest',
  color = '#4f46e5',
} = {}) {
  const roomRef = useRef(roomId);
  roomRef.current = roomId;
  const identityRef = useRef({ userId, userName, color });
  identityRef.current = { userId, userName, color };
  const socketRef = useRef(socket);
  socketRef.current = socket;

  const emitSelection = useCallback(
    (shapeIds) => {
      try {
        const sock = socketRef.current;
        const rid = roomRef.current;
        if (!sock || typeof sock.emit !== 'function') return;
        if (!rid) return;
        if (sock.connected === false) return;
        const me = identityRef.current;
        const data = buildSelectionPayload({
          userId: me.userId,
          userName: me.userName,
          color: me.color,
          shapeIds,
        });
        if (!data) return;
        sock.emit(SELECTION_EVENT, { roomId: rid, data });
      } catch {
        // presence-style best-effort; never throw into selection paths
      }
    },
    [],
  );

  return { emitSelection };
}
