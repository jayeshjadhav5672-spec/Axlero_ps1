/**
 * useCollaborativeCode — Integration Engineer (core integration)
 *
 * Minimal last-writer-wins text sync over Arun's code:update transport.
 * This is the integration seam for Kishan's Monaco editor — NOT a Monaco
 * replacement: it exposes { text, onLocalChange } so his <CodeEditor />
 * drops in by accepting the same two props. Shree's Y.Text will replace
 * the revision guard with CRDT merge when it lands (see docs/INTEGRATION.md).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyCodeOp, isValidCodeOp } from '../lib/collabOps.js';

export default function useCollaborativeCode({ socket, roomId, enabled = true }) {
  const [text, setText] = useState('');
  const stateRef = useRef({ text: '', rev: 0 });
  const roomRef = useRef(roomId);
  roomRef.current = roomId;

  const onLocalChange = useCallback(
    (nextText) => {
      const value = typeof nextText === 'string' ? nextText : '';
      stateRef.current = { text: value, rev: stateRef.current.rev + 1 };
      setText(value);
      try {
        if (!socket || !enabled || !socket.connected) return;
        socket.emit('code:update', {
          roomId: roomRef.current,
          data: { text: value, rev: stateRef.current.rev, actorId: socket.id },
        });
      } catch {
        // emit path — local state is already updated, never throw
      }
    },
    [socket, enabled],
  );

  useEffect(() => {
    if (!socket) return undefined;
    const handleRemote = (payload) => {
      if (!payload || payload.roomId !== roomRef.current) return;
      const op = payload.data;
      if (!isValidCodeOp(op)) return;
      const next = applyCodeOp(stateRef.current, op, socket.id);
      if (!next.applied) return;
      stateRef.current = next.state;
      setText(next.state.text);
    };
    socket.on('code:update', handleRemote);
    return () => {
      socket.off('code:update', handleRemote);
    };
  }, [socket]);

  return useMemo(() => ({ text, onLocalChange }), [text, onLocalChange]);
}
