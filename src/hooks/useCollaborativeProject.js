/**
 * useCollaborativeProject — shared room project (tree + per-file contents).
 *
 * Generalizes useCollaborativeCode's single-document LWW transport to one
 * collaborative document per fileId:
 * - TREE (server-authoritative): `project:create-node` requests,
 *   `project:node-created` fan-out (ack to creator + broadcast to peers),
 *   `project:state` snapshots on join / reconnect / explicit request.
 * - CONTENTS (per-file LWW, same semantics as the legacy single doc):
 *   `code:update` now carries fileId; legacy ops without fileId land on the
 *   shared document, so old clients keep interoperating.
 *
 * Local-only state (never broadcast): nothing in this hook — active file,
 * open tabs, cursor, and viewport stay in the panel. This hook owns exactly
 * the SHARED state: nodes, per-file texts, and create-request errors.
 *
 * Echo safety: remote content adopts under applyCodeOp's rev + actorId
 * guards (the Monaco-level suppression in controlledEditorSync is
 * untouched), and the server already excludes the sender from relays.
 *
 * Join gating: `joined` must be the server's room:joined confirmation for
 * this roomId (see useRoomConnection.joinedRoom). Emits sent before the
 * server ran socket.join(roomId) are correctly rejected with "socket does
 * not belong to this room" — so createNode refuses loudly while unjoined,
 * and content edits stay local-only until joined (converging through the
 * snapshot re-emit once the join completes). Local state always updates;
 * only the network send is gated, so no keystrokes are ever lost.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyCodeOp } from '../lib/collabOps.js';
import { ensureSharedNode, fileIdOfCodeOp, isValidFileCodeOp, mergeFileSnapshot } from '../lib/projectSync.js';
import { sharedFileNode } from '../components/workspace/fileTree.js';

// How long a create request waits for the server ack/rejection before the
// hook reports a timeout. Without this, talking to a stale server (one
// whose socket.cjs predates the project protocol and silently ignores the
// event) looks exactly like "nothing happens" — the failure that motivated
// this guard. A late ack still applies normally after a timeout.
export const CREATE_ACK_TIMEOUT_MS = 8000;

export default function useCollaborativeProject({ socket, roomId, enabled = true, joined = true }) {
  const [nodes, setNodes] = useState(() => [sharedFileNode()]);
  const [fileTexts, setFileTexts] = useState({});
  const [createError, setCreateError] = useState(null);
  const [operationError, setOperationError] = useState(null);
  // Pending create request ids → ack-timeout handles. Ref (not state): the
  // timers only feed setCreateError, never render output.
  const pendingTimers = useRef(new Map());
  const operationTimers = useRef(new Map());
  // Per-file { text, rev } — the Lamport clock behind LWW. Ref (not state)
  // so high-frequency typing never re-renders beyond the text setState.
  const filesRef = useRef(new Map());
  const roomRef = useRef(roomId);
  roomRef.current = roomId;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  // Server-confirmed join for this room (useRoomConnection.joinedRoom).
  // Gated below: pre-join emits would be rejected with "socket does not
  // belong to this room", so they never leave the client.
  const joinedRef = useRef(joined);
  joinedRef.current = joined;

  const clearCreateError = useCallback(() => setCreateError(null), []);

  const disarmCreateTimeout = useCallback((requestId) => {
    try {
      const timer = pendingTimers.current.get(requestId);
      if (timer) clearTimeout(timer);
      pendingTimers.current.delete(requestId);
    } catch {
      // timer bookkeeping — never throw
    }
  }, []);

  const armOperationTimeout = useCallback((requestId) => {
    if (!requestId) return;
    const previous = operationTimers.current.get(requestId);
    if (previous) clearTimeout(previous);
    operationTimers.current.set(requestId, setTimeout(() => {
      operationTimers.current.delete(requestId);
      setOperationError({ requestId, message: 'No response from the server. Try the operation again.' });
    }, CREATE_ACK_TIMEOUT_MS));
  }, []);

  const disarmOperationTimeout = useCallback((requestId) => {
    const timer = operationTimers.current.get(requestId);
    if (timer) clearTimeout(timer);
    operationTimers.current.delete(requestId);
  }, []);

  // Fail loudly when the server never answers a create request (stale
  // server, dropped packet): the panel shows this in the open draft.
  const armCreateTimeout = useCallback((requestId) => {
    try {
      const prev = pendingTimers.current.get(requestId);
      if (prev) clearTimeout(prev);
      pendingTimers.current.set(
        requestId,
        setTimeout(() => {
          pendingTimers.current.delete(requestId);
          setCreateError({
            requestId,
            message:
              'No response from the server. Make sure the realtime server is running the latest code (`npm run dev:server`), then try again.',
          });
        }, CREATE_ACK_TIMEOUT_MS),
      );
    } catch {
      // timer bookkeeping — never throw
    }
  }, []);

  useEffect(
    () => () => {
      try {
        for (const timer of pendingTimers.current.values()) clearTimeout(timer);
        pendingTimers.current.clear();
        for (const timer of operationTimers.current.values()) clearTimeout(timer);
        operationTimers.current.clear();
      } catch {
        // unmount teardown — never throw
      }
    },
    [],
  );

  const onFileChange = useCallback(
    (fileId, nextText) => {
      const id = typeof fileId === 'string' && fileId ? fileId : null;
      if (!id) return;
      const value = typeof nextText === 'string' ? nextText : '';
      const prev = filesRef.current.get(id) ?? { text: '', rev: 0 };
      const next = { text: value, rev: prev.rev + 1 };
      filesRef.current.set(id, next);
      setFileTexts((texts) => (texts[id] === value ? texts : { ...texts, [id]: value }));
      try {
        // Local-first: unjoined edits stay local (no keystroke loss) and
        // converge through the join snapshot's re-emit once joined.
        if (!socket || !enabledRef.current || !joinedRef.current || !socket.connected) return;
        socket.emit('code:update', {
          roomId: roomRef.current,
          data: { fileId: id, text: value, rev: next.rev, actorId: socket.id },
        });
      } catch {
        // emit path — local state is already updated, never throw
      }
    },
    [socket],
  );

  const createNode = useCallback(
    ({ id, name, type, parentId }) => {
      setCreateError(null);
      const node = { id, name, type, parentId: parentId ?? null };
      try {
        if (!socket || !socket.connected) {
          setCreateError({ requestId: id ?? null, message: 'You are offline — reconnect to create shared files.' });
          return;
        }
        if (!joinedRef.current) {
          setCreateError({ requestId: id ?? null, message: 'Still joining the room — wait for the connection, then try again.' });
          return;
        }
        socket.emit('project:create-node', { roomId: roomRef.current, data: { node } });
        if (typeof id === 'string' && id) armCreateTimeout(id);
      } catch {
        if (typeof id === 'string' && id) disarmCreateTimeout(id);
        setCreateError({ requestId: id ?? null, message: 'Could not send the create request.' });
      }
    },
    [socket, armCreateTimeout, disarmCreateTimeout],
  );

  const requestSnapshot = useCallback(() => {
    try {
      if (!socket || !socket.connected) return;
      socket.emit('project:state-request', { roomId: roomRef.current });
    } catch {
      // refresh hint — never throw
    }
  }, [socket]);

  const renameNode = useCallback(({ id, name }) => {
    setOperationError(null);
    if (!socket?.connected || !joinedRef.current) {
      setOperationError({ requestId: id ?? null, message: 'Room connection is not ready.' });
      return;
    }
    socket.emit('project:rename-node', { roomId: roomRef.current, data: { node: { id, name } } });
    armOperationTimeout(id);
  }, [armOperationTimeout, socket]);

  const deleteNode = useCallback((id) => {
    setOperationError(null);
    if (!socket?.connected || !joinedRef.current) {
      setOperationError({ requestId: id ?? null, message: 'Room connection is not ready.' });
      return;
    }
    socket.emit('project:delete-node', { roomId: roomRef.current, data: { nodeId: id } });
    armOperationTimeout(id);
  }, [armOperationTimeout, socket]);

  useEffect(() => {
    if (!socket) return undefined;
    const inRoom = (payload) => !!payload && payload.roomId === roomRef.current;

    const handleState = (payload) => {
      if (!inRoom(payload) || !payload.data || typeof payload.data !== 'object') return;
      const snap = payload.data;
      if (Array.isArray(snap.nodes)) {
        const clean = snap.nodes.filter((n) => n && typeof n.id === 'string' && typeof n.name === 'string');
        setNodes(ensureSharedNode(clean, sharedFileNode()));
      }
      if (snap.files && typeof snap.files === 'object' && !Array.isArray(snap.files)) {
        const merged = mergeFileSnapshot(filesRef.current, snap.files);
        filesRef.current = merged.files;
        setFileTexts(merged.texts);
        // Reconnect convergence: re-emit docs that are causally newer than
        // the snapshot so offline edits are not silently reset by a join.
        for (const { fileId, text, rev } of merged.ahead) {
          try {
            if (socket.connected) {
              socket.emit('code:update', {
                roomId: roomRef.current,
                data: { fileId, text, rev, actorId: socket.id },
              });
            }
          } catch {
            // re-emit path — never throw
          }
        }
      }
    };

    const handleNodeCreated = (payload) => {
      if (!inRoom(payload)) return;
      const node = payload.data && payload.data.node;
      if (!node || typeof node.id !== 'string' || typeof node.name !== 'string') return;
      if (node.type !== 'file' && node.type !== 'folder') return;
      disarmCreateTimeout(node.id);
      setCreateError((prev) => (prev && prev.requestId === node.id ? null : prev));
      setNodes((prev) => {
        if (prev.some((n) => n && n.id === node.id)) return prev;
        return [
          ...prev,
          { id: node.id, name: node.name, type: node.type, parentId: node.parentId ?? null },
        ];
      });
    };

    const handleNodeRenamed = (payload) => {
      if (!inRoom(payload)) return;
      const node = payload.data?.node;
      if (!node || typeof node.id !== 'string' || typeof node.name !== 'string') return;
      disarmOperationTimeout(node.id);
      setOperationError((prev) => (prev?.requestId === node.id ? null : prev));
      setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, name: node.name } : item)));
    };

    const handleNodesDeleted = (payload) => {
      if (!inRoom(payload)) return;
      const ids = Array.isArray(payload.data?.deletedIds) ? new Set(payload.data.deletedIds) : new Set();
      if (ids.size === 0) return;
      ids.forEach((id) => disarmOperationTimeout(id));
      setOperationError((prev) => (prev && ids.has(prev.requestId) ? null : prev));
      setNodes((prev) => prev.filter((item) => !ids.has(item.id)));
      setFileTexts((prev) => {
        const next = { ...prev };
        ids.forEach((id) => delete next[id]);
        return next;
      });
      ids.forEach((id) => filesRef.current.delete(id));
    };

    const handleRemoteCode = (payload) => {
      if (!inRoom(payload)) return;
      const op = payload.data;
      if (!isValidFileCodeOp(op)) return;
      const fileId = fileIdOfCodeOp(op);
      const current = filesRef.current.get(fileId) ?? { text: '', rev: 0 };
      const next = applyCodeOp(current, op, socket.id);
      if (!next.applied) return;
      filesRef.current.set(fileId, next.state);
      setFileTexts((texts) => ({ ...texts, [fileId]: next.state.text }));
    };

    const handleCreateError = (payload) => {
      if (!payload || !['project:create-node', 'project:rename-node', 'project:delete-node'].includes(payload.event)) return;
      const requestId = typeof payload.requestId === 'string' ? payload.requestId : null;
      if (payload.event === 'project:create-node') {
        if (requestId) disarmCreateTimeout(requestId);
        setCreateError({ requestId, message: payload.message || 'The shared file could not be created.' });
      } else {
        if (requestId) disarmOperationTimeout(requestId);
        setOperationError({ requestId, message: payload.message || 'The shared project operation failed.' });
      }
    };

    socket.on('project:state', handleState);
    socket.on('project:node-created', handleNodeCreated);
    socket.on('project:node-renamed', handleNodeRenamed);
    socket.on('project:nodes-deleted', handleNodesDeleted);
    socket.on('code:update', handleRemoteCode);
    socket.on('connection:error', handleCreateError);
    return () => {
      socket.off('project:state', handleState);
      socket.off('project:node-created', handleNodeCreated);
      socket.off('project:node-renamed', handleNodeRenamed);
      socket.off('project:nodes-deleted', handleNodesDeleted);
      socket.off('code:update', handleRemoteCode);
      socket.off('connection:error', handleCreateError);
    };
  }, [socket, disarmCreateTimeout, disarmOperationTimeout]);

  return useMemo(
    () => ({ nodes, fileTexts, createError, operationError, clearCreateError, createNode, renameNode, deleteNode, onFileChange, requestSnapshot }),
    [nodes, fileTexts, createError, operationError, clearCreateError, createNode, renameNode, deleteNode, onFileChange, requestSnapshot],
  );
}
