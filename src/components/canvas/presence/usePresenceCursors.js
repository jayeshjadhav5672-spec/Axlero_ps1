import { useCallback, useEffect, useRef, useState } from 'react';

export const CURSOR_THROTTLE_MS = 40;
const PEER_STALE_MS = 5000;

/**
 * usePresenceCursors — live multiplayer cursor & presence broadcasting.
 *
 * - Listens to `stage.on('pointermove')`, throttled to 30–50ms (40ms),
 *   converting pointer coordinates to canvas space (world coords via
 *   `getRelativePointerPosition()`) so zoom and pan never offset cursor
 *   alignment for peers.
 * - WebSocket transport: broadcasts
 *   `{ type: 'cursor-move', userId, userName, color, x, y }` on the
 *   room-scoped `cursor:update` channel (relayed by server/socket.cjs);
 *   on disconnect or `pointerleave` broadcasts `{ type: 'cursor-leave',
 *   userId }`.
 * - Tracks remote peers with last-seen timestamps; stale peers (>5s)
 *   are expired on an interval.
 *
 * All coordinates are canvas-space (world); the overlay component
 * projects them to screen via scale/stagePos.
 */
export default function usePresenceCursors({
  socket = null,
  roomId = null,
  stageRef = null,
  containerRef = null,
  userId = null,
  userName = 'Guest',
  color = '#4f46e5',
  enabled = true,
  throttleMs = CURSOR_THROTTLE_MS,
} = {}) {
  const [peers, setPeers] = useState([]);
  const peersRef = useRef(new Map());
  const lastSentRef = useRef(0);
  const pendingRef = useRef(null);

  const syncPeers = useCallback(() => {
    setPeers([...peersRef.current.values()]);
  }, []);

  const emit = useCallback(
    (data) => {
      try {
        if (!socket || typeof socket.emit !== 'function') return;
        if (!roomId) return;
        if (socket.connected === false) return;
        socket.emit('cursor:update', { roomId, data });
      } catch {
        // presence is best-effort; never throw into the pointer path
      }
    },
    [roomId, socket],
  );

  const broadcastMove = useCallback(
    (world) => {
      if (!world || !Number.isFinite(world.x) || !Number.isFinite(world.y)) return;
      const now = Date.now();
      const interval = Number.isFinite(throttleMs) ? throttleMs : CURSOR_THROTTLE_MS;
      if (now - lastSentRef.current < interval) {
        pendingRef.current = world;
        return;
      }
      lastSentRef.current = now;
      pendingRef.current = null;
      emit({ type: 'cursor-move', userId, userName, color, x: world.x, y: world.y });
    },
    [color, emit, throttleMs, userId, userName],
  );

  const broadcastLeave = useCallback(() => {
    pendingRef.current = null;
    emit({ type: 'cursor-leave', userId });
  }, [emit, userId]);

  // Trailing-edge flush for the throttle window.
  useEffect(() => {
    if (!enabled) return undefined;
    const interval = Number.isFinite(throttleMs) ? throttleMs : CURSOR_THROTTLE_MS;
    const timer = setInterval(() => {
      if (pendingRef.current) {
        const world = pendingRef.current;
        pendingRef.current = null;
        lastSentRef.current = Date.now();
        emit({ type: 'cursor-move', userId, userName, color, x: world.x, y: world.y });
      }
    }, interval);
    return () => clearInterval(timer);
  }, [color, emit, enabled, throttleMs, userId, userName]);

  // Stage pointer tracking (canvas-space coords).
  // Attached to the CONTAINER (always mounted), resolving the live stage
  // lazily per event: the Konva Stage itself mounts asynchronously behind
  // a size gate, so binding `stage.on(...)` once at hook setup silently
  // misses it and cursor broadcast would stay dead until an unrelated
  // re-subscribe. Container tracking works from the first frame and
  // converges to identical world coords once the stage exists.
  useEffect(() => {
    if (!enabled) return undefined;
    const container = containerRef?.current ?? null;
    const toWorld = (clientX, clientY) => {
      try {
        const stage = stageRef?.current ?? null;
        if (stage && typeof stage.getRelativePointerPosition === 'function') {
          const p = stage.getRelativePointerPosition();
          if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
        }
        if (stage && container && typeof stage.getAbsoluteTransform === 'function') {
          const rect = container.getBoundingClientRect();
          const abs = stage.getAbsoluteTransform()?.copy?.()?.invert?.();
          if (abs && typeof abs.point === 'function') {
            const w = abs.point({ x: clientX - rect.left, y: clientY - rect.top });
            if (w && Number.isFinite(w.x) && Number.isFinite(w.y)) return { x: w.x, y: w.y };
          }
        }
      } catch {
        // ignore pointer read failures
      }
      return null;
    };
    const onMove = (e) => {
      const world = toWorld(e?.clientX, e?.clientY);
      if (world) broadcastMove(world);
    };
    const onLeave = () => broadcastLeave();
    // DOM-level tracking (pointer moves + exits over the canvas container).
    if (container && typeof container.addEventListener === 'function') {
      container.addEventListener('pointermove', onMove);
      container.addEventListener('pointerleave', onLeave);
    }
    return () => {
      if (container && typeof container.removeEventListener === 'function') {
        container.removeEventListener('pointermove', onMove);
        container.removeEventListener('pointerleave', onLeave);
      }
      broadcastLeave();
    };
  }, [broadcastLeave, broadcastMove, containerRef, enabled, stageRef]);

  // Remote peer ingress. Listens on BOTH the legacy `cursor:update`
  // channel and the unified `cursor:move` channel (same peer map).
  // `cursor:move` carries the compact unified schema { x, y, user?, tool?,
  // userId?, color? } and is adapted onto the internal cursor-move shape.
  //
  // Per-CONNECTION keying: each socket is an individual cursor/presence
  // instance, so the map keys on the transport socketId (userId fallback
  // for senders that omit it). Keying by userId alone collapses multiple
  // tabs/shares of one account into a single cursor AND produces duplicate
  // React keys downstream (`user-dinlgym2` twice). Self-echo is filtered
  // by our own socket id — never by userId, so a second tab on the same
  // account still renders.
  useEffect(() => {
    if (!enabled || !socket || typeof socket.on !== 'function') return undefined;
    const ownSocketId = () => {
      try {
        return socket?.id ?? null;
      } catch {
        return null;
      }
    };
    const upsertPeer = ({ connectionKey, userId: peerUserId, userName: name, color: peerColor, x, y }) => {
      if (!connectionKey || connectionKey === ownSocketId()) return;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      peersRef.current.set(connectionKey, {
        socketId: connectionKey,
        userId: peerUserId ?? connectionKey,
        userName: name ?? 'Guest',
        color: peerColor ?? '#4f46e5',
        x,
        y,
        lastSeen: Date.now(),
      });
      syncPeers();
    };
    const handleRemote = (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      const data = payload.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'cursor-move') {
        upsertPeer({
          connectionKey: payload.socketId ?? data.userId ?? null,
          userId: data.userId,
          userName: data.userName,
          color: data.color,
          x: data.x,
          y: data.y,
        });
      } else if (data.type === 'cursor-leave') {
        // Exact connection first; fall back to sweeping every entry for
        // the departing userId (covers multi-tab shares of one account).
        let changed = false;
        if (payload.socketId && peersRef.current.delete(payload.socketId)) changed = true;
        if (data.userId) {
          for (const [key, peer] of peersRef.current) {
            if (peer?.userId === data.userId) {
              peersRef.current.delete(key);
              changed = true;
            }
          }
        }
        if (changed) syncPeers();
      }
    };
    // Unified `cursor:move` adapter: { x, y, user?, tool? } (+ optional
    // userId/color from unified senders) → internal cursor-move shape.
    // Sender id falls back to the transport socketId; display name falls
    // back to `user`, then Guest.
    const handleUnifiedMove = (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      const data = payload.data;
      if (!data || typeof data !== 'object') return;
      upsertPeer({
        connectionKey: payload.socketId ?? data.userId ?? null,
        userId: data.userId,
        userName: data.userName ?? data.user ?? 'Guest',
        color: data.color ?? '#4f46e5',
        x: data.x,
        y: data.y,
      });
    };
    socket.on('cursor:update', handleRemote);
    socket.on('cursor:move', handleUnifiedMove);
    return () => {
      try {
        socket.off?.('cursor:update', handleRemote);
        socket.off?.('cursor:move', handleUnifiedMove);
      } catch {
        // ignore
      }
    };
  }, [enabled, roomId, socket, syncPeers]);

  // Expire stale peers.
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, peer] of peersRef.current) {
        if (now - (peer.lastSeen ?? 0) > PEER_STALE_MS) {
          peersRef.current.delete(id);
          changed = true;
        }
      }
      if (changed) syncPeers();
    }, 2000);
    return () => clearInterval(timer);
  }, [enabled, syncPeers]);

  // Broadcast leave on unmount / disconnect.
  useEffect(() => {
    if (!enabled || !socket || typeof socket.on !== 'function') return undefined;
    const onDisconnect = () => broadcastLeave();
    socket.on('disconnect', onDisconnect);
    return () => {
      try {
        socket.off?.('disconnect', onDisconnect);
      } catch {
        // ignore
      }
    };
  }, [broadcastLeave, enabled, socket]);

  return { peers, broadcastMove, broadcastLeave };
}
