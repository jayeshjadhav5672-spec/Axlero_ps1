/**
 * useRoomConnection — Integration Engineer (core integration)
 *
 * Owns the Socket.io lifecycle for one room and exposes it in the exact
 * shape Avantee's UI consumes:
 * - status: 'connected' | 'connecting' | 'reconnecting' | 'disconnected' | 'error'
 * - presence: raw Arun presence entries (map with presenceToUsers for UI)
 * - error / left / reconnect() / leaveRoom()
 *
 * Rules: single shared socket (see lib/socket.js), listeners attached once
 * per mount with full cleanup (no leaks, no duplicates under StrictMode),
 * room:join re-emitted on every (re)connect, graceful offline mode when the
 * server is unreachable — never a silent failure.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '../lib/socket.js';
import { isValidRoomId } from '../lib/room.js';

export default function useRoomConnection({ roomId, userId, displayName, authToken = null }) {
  const [status, setStatus] = useState('connecting');
  const [presence, setPresence] = useState([]);
  const [error, setError] = useState(null);
  const [left, setLeft] = useState(false);

  const roomRef = useRef(roomId);
  roomRef.current = roomId;
  const identityRef = useRef({ userId, displayName });
  identityRef.current = { userId, displayName };

  useEffect(() => {
    const socket = getSocket();
    setLeft(false);

    if (!isValidRoomId(roomRef.current)) {
      setError(`Invalid room id "${roomRef.current}". Use 1-64 letters, numbers, - or _.`);
      setStatus('error');
      return undefined;
    }
    setError(null);

    // Carry the JWT (if any) in the handshake so the server can attribute
    // the connection to the signed-in account. Guests (null token) connect
    // exactly as before. Re-runs when the token changes (login/logout),
    // performing a clean re-join under the new identity.
    try {
      socket.auth = authToken ? { token: authToken } : {};
    } catch {
      // never break connecting on auth plumbing
    }

    const joinPayload = () => ({
      roomId: roomRef.current,
      userId: identityRef.current.userId,
      displayName: identityRef.current.displayName,
    });

    const handleConnect = () => {
      setError(null);
      setStatus('connected');
      socket.emit('room:join', joinPayload());
    };
    const handleJoined = (payload) => {
      if (!payload || payload.roomId !== roomRef.current) return;
      setPresence(Array.isArray(payload.presence) ? payload.presence : []);
      setStatus('connected');
    };
    const handlePresence = (payload) => {
      if (!payload || payload.roomId !== roomRef.current) return;
      setPresence(Array.isArray(payload.users) ? payload.users : []);
    };
    const handleLeft = (payload) => {
      if (!payload || payload.roomId !== roomRef.current) return;
      setPresence([]);
    };
    const handleConnError = (payload) => {
      setError(payload?.message || 'Synchronization error');
    };
    const handleDisconnect = () => {
      try {
        setStatus(socket.active ? 'reconnecting' : 'disconnected');
      } catch {
        setStatus('disconnected');
      }
    };

    socket.on('connect', handleConnect);
    socket.on('room:joined', handleJoined);
    socket.on('presence:update', handlePresence);
    socket.on('room:left', handleLeft);
    socket.on('connection:error', handleConnError);
    socket.on('disconnect', handleDisconnect);

    if (socket.connected) {
      setStatus('connected');
      socket.emit('room:join', joinPayload());
    } else {
      setStatus('connecting');
      try {
        socket.connect();
      } catch (err) {
        setError(err?.message || 'Could not reach the realtime server');
        setStatus('disconnected');
      }
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('room:joined', handleJoined);
      socket.off('presence:update', handlePresence);
      socket.off('room:left', handleLeft);
      socket.off('connection:error', handleConnError);
      socket.off('disconnect', handleDisconnect);
      try {
        if (socket.connected) socket.emit('room:leave', { roomId: roomRef.current });
      } catch {
        // unmount path — never throw
      }
    };
  }, [roomId, userId, displayName, authToken]);

  const reconnect = useCallback(() => {
    setError(null);
    setLeft(false);
    setStatus('connecting');
    try {
      getSocket().connect();
    } catch (err) {
      setError(err?.message || 'Could not reach the realtime server');
      setStatus('disconnected');
    }
  }, []);

  const leaveRoom = useCallback(() => {
    try {
      const socket = getSocket();
      if (socket.connected) socket.emit('room:leave', { roomId: roomRef.current });
      socket.disconnect();
    } catch {
      // leave path — never throw
    }
    setPresence([]);
    setStatus('disconnected');
    setLeft(true);
  }, []);

  return { socket: getSocket(), status, presence, error, left, reconnect, leaveRoom };
}
