/**
 * App — Integration Engineer (core integration composition)
 *
 * Wires the existing modules without modifying them:
 * - Avantee: AppLayout / Workspace / panels (rendered as-is)
 * - Sayon: <Whiteboard /> in CONTROLLED mode (parent owns shapes)
 * - Arun: Socket.io room lifecycle + presence + canvas/code transport
 * - Kishan (pending): CollabTextEditor fallback exposes the exact
 *   { value, onChange } seam his Monaco <CodeEditor /> will fill
 * - Shree (pending): room→doc mapping + op contract documented in
 *   docs/INTEGRATION.md; socket relay is the transport her Yjs sync
 *   provider will reuse
 * - Vaishnavi (pending): identity via getOrCreateIdentity (localStorage);
 *   server already honors socket.user for future auth middleware
 *
 * Offline honesty: when the realtime server is unreachable the banner
 * says so and the whiteboard/editor keep working locally.
 */

import React, { useMemo, useState } from 'react';
import AppLayout from './components/layout/AppLayout';
import Workspace from './components/workspace/Workspace';
import { Whiteboard } from './components/canvas';
import CollabTextEditor from './components/editor/CollabTextEditor';
import useRoomConnection from './hooks/useRoomConnection';
import useCollaborativeWhiteboard from './hooks/useCollaborativeWhiteboard';
import useCollaborativeCode from './hooks/useCollaborativeCode';
import {
  buildRoomUrl,
  getOrCreateIdentity,
  getRoomIdFromUrl,
  presenceToUsers,
} from './lib/room';

export default function App() {
  const [roomId] = useState(() => getRoomIdFromUrl());
  const [identity] = useState(() => getOrCreateIdentity());
  const [shareNote, setShareNote] = useState('');

  const { socket, status, presence, error, left, reconnect, leaveRoom } = useRoomConnection({
    roomId,
    userId: identity.userId,
    displayName: identity.displayName,
  });

  const live = !left && status !== 'error';
  const whiteboardSync = useCollaborativeWhiteboard({ socket, roomId, enabled: live });
  const codeSync = useCollaborativeCode({ socket, roomId, enabled: live });

  const users = useMemo(() => presenceToUsers(presence), [presence]);

  const handleShareRoom = () => {
    const url = buildRoomUrl(roomId);
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(url)
          .then(() => setShareNote('Invite link copied'))
          .catch(() => setShareNote(url));
      } else {
        setShareNote(url);
      }
    } catch {
      setShareNote(url);
    }
  };

  const banner = useMemo(() => {
    if (left) return null;
    if (error) return { tone: 'rose', text: error, showRetry: true };
    if (status === 'disconnected')
      return {
        tone: 'amber',
        text: 'Realtime server unreachable — whiteboard and editor work locally. Start it with `npm run dev:server`, then Retry.',
        showRetry: true,
      };
    if (status === 'reconnecting') return { tone: 'amber', text: 'Reconnecting to the room…', showRetry: false };
    return null;
  }, [error, status, left]);

  return (
    <AppLayout>
      {banner && (
        <div
          role="alert"
          className={`mx-auto mt-3 flex w-full max-w-[1600px] flex-wrap items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${
            banner.tone === 'rose'
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          <span className="min-w-0 flex-1">{banner.text}</span>
          {banner.showRetry && (
            <button
              type="button"
              onClick={reconnect}
              className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {left ? (
        <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
          <p className="text-lg font-semibold text-slate-800">You left room “{roomId}”.</p>
          <p className="text-sm text-slate-500">
            Signed in as {identity.displayName}. Rejoin to resume collaborating.
          </p>
          <button
            type="button"
            onClick={reconnect}
            className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            Rejoin room
          </button>
        </div>
      ) : (
        <Workspace
          roomId={roomId}
          connectionStatus={status}
          users={users}
          whiteboard={
            <Whiteboard
              shapes={whiteboardSync.shapes}
              onShapeCreate={whiteboardSync.onShapeCreate}
              onShapeUpdate={whiteboardSync.onShapeUpdate}
              onShapeDelete={whiteboardSync.onShapeDelete}
              onCanvasClear={whiteboardSync.onCanvasClear}
              onShapesReorder={whiteboardSync.onShapesReorder}
            />
          }
          editor={<CollabTextEditor value={codeSync.text} onChange={codeSync.onLocalChange} />}
          onLeaveRoom={leaveRoom}
          onShareRoom={handleShareRoom}
        />
      )}

      {shareNote && (
        <p role="status" className="mx-auto w-full max-w-[1600px] px-4 pb-3 font-mono text-xs text-slate-500">
          {shareNote}
        </p>
      )}
    </AppLayout>
  );
}
