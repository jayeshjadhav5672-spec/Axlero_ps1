/**
 * useCollaborativeYjs — room-scoped Yjs CRDT integration (single integration point).
 *
 * Coordinates, per room: Y.Doc lifecycle, the Socket.io Yjs transport
 * (attachRoomSync), Awareness (identity/presence/cursor), per-file Y.Text
 * bindings for Monaco, and Yjs whiteboard bindings — all on the EXISTING
 * singleton socket. Never creates its own socket.io client.
 *
 * Text authority: each collaborative file has a stable shared Y.Text
 * (see lib/yjsText.js) keyed by fileId. Local Monaco edits enter Y.Text
 * as character deltas; remote Y.Text content drives the editor through
 * the existing echo guard. The legacy code:update wire is preserved
 * untouched for server snapshots and old clients: this hook still lets
 * callers dual-write it, but NEVER folds fileId-carrying code:update back
 * into Y.Text (that would launder LWW overwrites into the CRDT); only
 * fileId-less legacy ops fold into the default document.
 *
 * Whiteboard authority: Y.Doc shapes registry (see lib/yjsWhiteboard.js)
 * with the SAME callback contract as useCollaborativeWhiteboard
 * (onShapeCreate/Update/Delete, onCanvasClear, onShapesReorder). Local
 * callbacks transact Y.Doc AND emit the legacy socket op (server snapshots
 * and legacy peers stay fresh); legacy inbound ops fold into Y.Doc;
 * remote Yjs state derives the controlled shapes snapshot. Remote updates
 * are never fed back into the CRUD callbacks (loop-free by construction).
 *
 * Lifecycle: attach on (socket + enabled + server-joined); detach, remove
 * local awareness, and destroy the room Y.Doc on leave/switch/unmount
 * (re-attach re-seeds from the authoritative project texts and
 * re-requests diffs, so nothing is lost). Reconnect reuses the same path.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getYDoc, destroyYDoc } from '../lib/yjsProvider.js';
import {
  attachRoomSync,
  detachRoomSync,
  isRoomAttached,
} from '../lib/yjsSocketProvider.js';
import {
  setLocalUser,
  setLocalPresence,
  setLocalCursor,
  setLocalSelection,
  subscribeToAwareness,
  getAwarenessSnapshot,
} from '../lib/yjsAwareness.js';
import {
  PROJECT_FILES_KEY,
  getFileText,
  removeFileText,
  readFileTexts,
  applyLocalTextEdit,
} from '../lib/yjsText.js';
import {
  createShape,
  updateShape,
  deleteShape,
  clearCanvas,
  setZOrder,
  getSharedShapes,
  subscribeToShapeChanges,
} from '../lib/yjsWhiteboard.js';
import { SHARED_FILE_ID } from '../components/workspace/fileTree.js';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function docFor(roomId) {
  try {
    return getYDoc(roomId);
  } catch {
    return null;
  }
}

export default function useCollaborativeYjs({
  socket,
  roomId,
  identity,
  enabled = true,
  joined = true,
  fileIds = [],
  fileTexts = {},
}) {
  const [yjsReady, setYjsReady] = useState(false);
  const [yjsFileTexts, setYjsFileTexts] = useState({});
  const [yjsShapes, setYjsShapes] = useState([]);
  const [awarenessUsers, setAwarenessUsers] = useState([]);
  const [awarenessCursors, setAwarenessCursors] = useState([]);

  const roomRef = useRef(roomId);
  roomRef.current = roomId;
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  // Y.Text ids managed for the current room (seeded/created). Pruned when
  // they leave the authoritative tree; foreign map keys never enter, so
  // unknown ids can never pollute local state.
  const managedIdsRef = useRef(new Set());
  // Last mirrored texts (echo/change detection without extra renders).
  const textsCacheRef = useRef({});
  const userId = identity ? identity.userId : undefined;
  const displayName = identity ? identity.displayName : undefined;

  const refreshTexts = useCallback((doc, force) => {
    try {
      const ids = [...managedIdsRef.current];
      const next = readFileTexts(doc, ids);
      const cache = textsCacheRef.current;
      let changed = !!force;
      if (!changed) {
        for (const id of ids) {
          if (cache[id] !== next[id]) {
            changed = true;
            break;
          }
        }
        if (!changed) {
          for (const id of Object.keys(cache)) {
            if (!(id in next)) {
              changed = true;
              break;
            }
          }
        }
      }
      if (changed) {
        textsCacheRef.current = next;
        setYjsFileTexts(next);
      }
    } catch {
      // mirror is best-effort; transport + doc stay authoritative
    }
  }, []);

  // ---- lifecycle: attach on joined, detach + destroy on leave/switch ----
  useEffect(() => {
    if (!socket || !enabled || !joined || !roomId) {
      try {
        if (roomId && isRoomAttached(roomId)) detachRoomSync(roomId);
      } catch {
        // never throw from lifecycle teardown
      }
      setYjsReady(false);
      return undefined;
    }
    let cancelled = false;
    let unsubShapes = null;
    let unsubAwareness = null;
    let unsubRegistry = null;
    let attachment = null;
    try {
      attachment = attachRoomSync({
        socket,
        roomId,
        identity: userId || displayName ? { userId, displayName } : undefined,
      });
    } catch {
      setYjsReady(false);
      return undefined;
    }
    const doc = attachment.doc;
    try {
      const seeds = fileTextsRef.current || {};
      for (const id of safeArray(fileIdsRef.current)) {
        if (typeof id !== 'string' || id.length === 0) continue;
        if (managedIdsRef.current.has(id)) continue;
        try {
          const ytext = getFileText(doc, id);
          const seed = typeof seeds[id] === 'string' ? seeds[id] : '';
          if (ytext.toString() === '' && seed !== '') {
            doc.transact(() => {
              ytext.insert(0, seed);
            });
          }
        } catch {
          // per-file seeding never breaks attach
        }
        managedIdsRef.current.add(id);
      }
    } catch {
      // seeding is best-effort; sync-request still converges
    }
    // Mirror Y.Text contents (initial + every remote/local transaction).
    const refresh = () => {
      if (cancelled) return;
      refreshTexts(doc);
    };
    try {
      refreshTexts(doc, true);
      const registry = doc.getMap(PROJECT_FILES_KEY);
      const onRegistry = () => refresh();
      registry.observeDeep(onRegistry);
      unsubRegistry = () => {
        try {
          registry.unobserveDeep(onRegistry);
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }
    // Mirror the Yjs shapes registry (initial + every transaction).
    try {
      setYjsShapes(getSharedShapes(doc));
      unsubShapes = subscribeToShapeChanges(doc, (snapshot) => {
        if (cancelled) return;
        setYjsShapes(snapshot);
      });
    } catch {
      // ignore
    }
    // Awareness snapshot for UI (users/cursors lists).
    try {
      const snap = getAwarenessSnapshot(roomId);
      setAwarenessUsers(snap.users);
      setAwarenessCursors(snap.cursors);
      unsubAwareness = subscribeToAwareness(roomId, (next) => {
        if (cancelled) return;
        setAwarenessUsers(next.users);
        setAwarenessCursors(next.cursors);
      });
    } catch {
      // ignore
    }
    if (!cancelled) setYjsReady(true);
    return () => {
      cancelled = true;
      try {
        if (unsubRegistry) unsubRegistry();
      } catch {
        // ignore
      }
      try {
        if (unsubShapes) unsubShapes();
      } catch {
        // ignore
      }
      try {
        if (unsubAwareness) unsubAwareness();
      } catch {
        // ignore
      }
      try {
        detachRoomSync(roomId);
      } catch {
        // ignore
      }
      try {
        destroyYDoc(roomId);
      } catch {
        // ignore
      }
      managedIdsRef.current.clear();
      textsCacheRef.current = {};
      setYjsReady(false);
      setYjsFileTexts({});
      setYjsShapes([]);
      setAwarenessUsers([]);
      setAwarenessCursors([]);
    };
    // fileIds/fileTexts intentionally excluded: seeding + pruning live in
    // the dedicated effect below so typing never re-attaches transport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, roomId, enabled, joined, userId, displayName, refreshTexts]);

  // ---- seed brand-new tree files + prune mappings that left the tree ----
  useEffect(() => {
    if (!yjsReady) return;
    const doc = docFor(roomId);
    if (!doc) return;
    const known = new Set(
      safeArray(fileIds).filter((id) => typeof id === 'string' && id.length > 0),
    );
    for (const id of [...managedIdsRef.current]) {
      if (!known.has(id)) {
        try {
          removeFileText(doc, id);
        } catch {
          // ignore
        }
        managedIdsRef.current.delete(id);
        delete textsCacheRef.current[id];
      }
    }
    const seeds = fileTexts || {};
    let seeded = false;
    for (const id of known) {
      if (managedIdsRef.current.has(id)) continue;
      try {
        const ytext = getFileText(doc, id);
        const seed = typeof seeds[id] === 'string' ? seeds[id] : '';
        if (ytext.toString() === '' && seed !== '') {
          doc.transact(() => {
            ytext.insert(0, seed);
          });
          seeded = true;
        }
        managedIdsRef.current.add(id);
      } catch {
        // per-file seeding never breaks the effect
      }
    }
    if (seeded) refreshTexts(doc, true);
  }, [yjsReady, roomId, fileIds, fileTexts, refreshTexts]);

  const emitOp = useCallback((event, data) => {
    try {
      const sock = socketRef.current;
      if (!sock || !enabledRef.current || !sock.connected) return false;
      sock.emit(event, { roomId: roomRef.current, data: { ...data, actorId: sock.id } });
      return true;
    } catch {
      return false;
    }
  }, []);

  // ---- Monaco text binding ----
  const editYjsFile = useCallback((fileId, nextText) => {
    if (typeof fileId !== 'string' || fileId.length === 0) return false;
    if (typeof nextText !== 'string') return false;
    const doc = docFor(roomRef.current);
    if (!doc) return false;
    try {
      const changed = applyLocalTextEdit(doc, fileId, nextText);
      if (changed) {
        managedIdsRef.current.add(fileId);
        refreshTexts(doc);
      }
      return changed;
    } catch {
      return false;
    }
  }, [refreshTexts]);

  // Fold legacy (fileId-less) code ops into the default Y.Text so old
  // clients interoperate both directions. Ops WITH fileId come from Yjs
  // dual-writes and are deliberately ignored (CRDT already converged them;
  // folding would launder LWW overwrites into the document).
  useEffect(() => {
    if (!socket || !yjsReady) return undefined;
    const handleLegacyCode = (payload) => {
      try {
        if (!payload || payload.roomId !== roomRef.current) return;
        const op = payload.data;
        if (!op || typeof op !== 'object') return;
        if (op.fileId !== undefined) return;
        if (typeof op.text !== 'string') return;
        const doc = docFor(roomRef.current);
        if (!doc) return;
        applyLocalTextEdit(doc, SHARED_FILE_ID, op.text);
        managedIdsRef.current.add(SHARED_FILE_ID);
        refreshTexts(doc);
      } catch {
        // never throw from socket handlers
      }
    };
    socket.on('code:update', handleLegacyCode);
    return () => {
      try {
        socket.off('code:update', handleLegacyCode);
      } catch {
        // ignore
      }
    };
  }, [socket, yjsReady, refreshTexts]);

  // ---- Whiteboard binding (same callback contract as the legacy hook) ----
  const whiteboardEmit = useCallback((op) => emitOp('canvas:update', op), [emitOp]);

  const foldLegacyWhiteboardOp = useCallback((op) => {
    const doc = docFor(roomRef.current);
    if (!doc) return;
    try {
      if (!op || typeof op !== 'object') return;
      switch (op.op) {
        case 'create':
          if (op.shape && typeof op.shape === 'object') createShape(doc, op.shape);
          break;
        case 'update':
          if (typeof op.shapeId === 'string' && op.changes && typeof op.changes === 'object') {
            updateShape(doc, op.shapeId, op.changes);
          }
          break;
        case 'delete':
          if (typeof op.shapeId === 'string') deleteShape(doc, op.shapeId);
          break;
        case 'clear':
          clearCanvas(doc);
          break;
        case 'reorder':
          if (Array.isArray(op.shapes)) {
            setZOrder(
              doc,
              op.shapes.filter((s) => s && typeof s.id === 'string').map((s) => s.id),
            );
          }
          break;
        default:
          break;
      }
    } catch {
      // folding never throws into socket handlers
    }
  }, []);

  const onShapeCreate = useCallback((shape) => {
    const doc = docFor(roomRef.current);
    if (!doc) return;
    try {
      const result = createShape(doc, shape);
      if (result.applied) whiteboardEmit({ op: 'create', shape });
    } catch {
      // never throw into the whiteboard
    }
  }, [whiteboardEmit]);

  const onShapeUpdate = useCallback((shapeId, changes) => {
    const doc = docFor(roomRef.current);
    if (!doc) return;
    try {
      const result = updateShape(doc, shapeId, changes);
      if (result.applied) whiteboardEmit({ op: 'update', shapeId, changes });
    } catch {
      // never throw into the whiteboard
    }
  }, [whiteboardEmit]);

  const onShapeDelete = useCallback((shapeId) => {
    const doc = docFor(roomRef.current);
    if (!doc) return;
    try {
      const result = deleteShape(doc, shapeId);
      if (result.applied) whiteboardEmit({ op: 'delete', shapeId });
    } catch {
      // never throw into the whiteboard
    }
  }, [whiteboardEmit]);

  const onCanvasClear = useCallback(() => {
    const doc = docFor(roomRef.current);
    if (!doc) return;
    try {
      const result = clearCanvas(doc);
      if (result.applied) whiteboardEmit({ op: 'clear' });
    } catch {
      // never throw into the whiteboard
    }
  }, [whiteboardEmit]);

  const onShapesReorder = useCallback((nextShapes) => {
    const doc = docFor(roomRef.current);
    if (!doc) return;
    try {
      const ids = safeArray(nextShapes)
        .filter((s) => s && typeof s.id === 'string')
        .map((s) => s.id);
      const result = setZOrder(doc, ids);
      if (result.applied) whiteboardEmit({ op: 'reorder', shapes: safeArray(nextShapes) });
    } catch {
      // never throw into the whiteboard
    }
  }, [whiteboardEmit]);

  // Legacy whiteboard inbound: fold into Y.Doc (bridge for old clients).
  // Remote Yjs state itself is applied by the transport with REMOTE origin
  // and observed read-only — never routed back through these callbacks.
  useEffect(() => {
    if (!socket || !yjsReady) return undefined;
    const inRoom = (payload) => !!payload && payload.roomId === roomRef.current;
    const fold = (payload) => {
      try {
        if (!inRoom(payload)) return;
        foldLegacyWhiteboardOp(payload.data);
      } catch {
        // never throw from socket handlers
      }
    };
    const foldSyncInit = (payload) => {
      try {
        if (!inRoom(payload) || !Array.isArray(payload.shapes)) return;
        const doc = docFor(roomRef.current);
        if (!doc) return;
        // Adopt server snapshots only into a fresh registry (late join /
        // reconnect with no live Yjs state yet); live CRDT state always
        // wins over a possibly stale snapshot.
        let hasShapes = true;
        try {
          hasShapes = getSharedShapes(doc).length > 0;
        } catch {
          hasShapes = true;
        }
        if (!hasShapes) {
          for (const s of payload.shapes) {
            if (s && typeof s === 'object') {
              try {
                createShape(doc, s);
              } catch {
                // per-shape faults never break the fold
              }
            }
          }
        }
      } catch {
        // never throw from socket handlers
      }
    };
    // shapes:commit/delete carry arrays (not legacy op envelopes).
    const foldCommit = (payload) => {
      try {
        if (!inRoom(payload)) return;
        const doc = docFor(roomRef.current);
        if (!doc || !payload.data || !Array.isArray(payload.data.shapes)) return;
        for (const s of payload.data.shapes) {
          try {
            if (s && typeof s === 'object') createShape(doc, s);
          } catch {
            // per-shape faults never break the fold
          }
        }
      } catch {
        // never throw from socket handlers
      }
    };
    const foldDelete = (payload) => {
      try {
        if (!inRoom(payload)) return;
        const doc = docFor(roomRef.current);
        if (!doc) return;
        const data = payload.data || {};
        const ids = Array.isArray(data.shapeIds)
          ? data.shapeIds
          : typeof data.shapeId === 'string'
            ? [data.shapeId]
            : [];
        for (const id of ids) {
          try {
            if (typeof id === 'string') deleteShape(doc, id);
          } catch {
            // per-shape faults never break the fold
          }
        }
      } catch {
        // never throw from socket handlers
      }
    };
    // history-sync carries a full replacement array (undo/redo restore):
    // adopt it wholesale so legacy restores converge into the CRDT too.
    const foldHistorySync = (payload) => {
      try {
        if (!inRoom(payload)) return;
        const doc = docFor(roomRef.current);
        if (!doc || !payload.data || !Array.isArray(payload.data.shapes)) return;
        clearCanvas(doc);
        for (const s of payload.data.shapes) {
          try {
            if (s && typeof s === 'object') createShape(doc, s);
          } catch {
            // per-shape faults never break the fold
          }
        }
      } catch {
        // never throw from socket handlers
      }
    };
    socket.on('canvas:update', fold);
    socket.on('shapes:commit', foldCommit);
    socket.on('shapes:delete', foldDelete);
    socket.on('canvas:clear', fold);
    socket.on('canvas:history-sync', foldHistorySync);
    socket.on('canvas:sync-init', foldSyncInit);
    return () => {
      for (const [event, handler] of [
        ['canvas:update', fold],
        ['shapes:commit', foldCommit],
        ['shapes:delete', foldDelete],
        ['canvas:clear', fold],
        ['canvas:history-sync', foldHistorySync],
        ['canvas:sync-init', foldSyncInit],
      ]) {
        try {
          socket.off(event, handler);
        } catch {
          // ignore
        }
      }
    };
  }, [socket, yjsReady, foldLegacyWhiteboardOp]);

  // ---- Awareness producers ----
  const setCursor = useCallback((cursor, fileId) => {
    try {
      const value =
        cursor === null
          ? null
          : {
              file: typeof fileId === 'string' ? fileId : null,
              lineNumber: Number(cursor?.lineNumber) || 1,
              column: Number(cursor?.column) || 1,
            };
      return setLocalCursor(roomRef.current, value);
    } catch {
      return false;
    }
  }, []);

  const setSelection = useCallback((ids) => {
    try {
      return setLocalSelection(roomRef.current, ids ?? null);
    } catch {
      return false;
    }
  }, []);

  return useMemo(() => ({
    yjsReady,
    yjsFileTexts,
    editYjsFile,
    yjsShapes,
    onShapeCreate,
    onShapeUpdate,
    onShapeDelete,
    onCanvasClear,
    onShapesReorder,
    awarenessUsers,
    awarenessCursors,
    setCursor,
    setSelection,
  }), [
    yjsReady,
    yjsFileTexts,
    editYjsFile,
    yjsShapes,
    onShapeCreate,
    onShapeUpdate,
    onShapeDelete,
    onCanvasClear,
    onShapesReorder,
    awarenessUsers,
    awarenessCursors,
    setCursor,
    setSelection,
  ]);
}
