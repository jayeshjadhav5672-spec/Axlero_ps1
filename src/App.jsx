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

import React, { useCallback, useMemo, useState } from 'react';
import AppLayout from './components/layout/AppLayout';
import Workspace from './components/workspace/Workspace';
import { LeftRoomState } from './components/room';
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
  // Day 1 dashboard seam (Day 2 builds the real dashboard here):
  // a minimal in-app view entered via "Go to Dashboard" or the
  // 10s left-room countdown. No router, no room-lifecycle changes —
  // `?room=` stays intact so Rejoin returns to the same workspace.
  const [dashboardView, setDashboardView] = useState(false);

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
    if (left || dashboardView) return null;
    if (error) return { tone: 'rose', text: error, showRetry: true };
    if (status === 'disconnected')
      return {
        tone: 'amber',
        text: 'Realtime server unreachable — whiteboard and editor work locally. Start it with `npm run dev:server`, then Retry.',
        showRetry: true,
      };
    if (status === 'reconnecting') return { tone: 'amber', text: 'Reconnecting to the room…', showRetry: false };
    return null;
  }, [error, status, left, dashboardView]);

  // Existing mechanisms, reused as-is: reconnect() re-joins the same
  // `?room=` room via useRoomConnection; leaveRoom() emits room:leave.
  const handleRejoin = useCallback(() => {
    setDashboardView(false);
    reconnect();
  }, [reconnect]);

  const handleGoDashboard = useCallback(() => {
    setDashboardView(true);
  }, []);

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

      {dashboardView ? (
        <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col items-center justify-center px-4 py-16 text-center">
          <section
            aria-labelledby="dashboard-seam-title"
            className="flex w-full max-w-md flex-col items-center rounded-2xl border border-slate-200 bg-white px-8 py-10 shadow-sm"
          >
            <span className="flex items-center gap-2">
              <svg className="h-6 w-6 text-teal-700" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              <span className="text-base font-bold tracking-tight text-slate-900">SyncSpace</span>
            </span>
            <h2 id="dashboard-seam-title" className="mt-5 text-xl font-semibold text-slate-900">
              Dashboard
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Last room <span className="font-mono text-teal-700">&ldquo;{roomId}&rdquo;</span>. The full
              dashboard lands on Day 2.
            </p>
            <button
              type="button"
              onClick={handleRejoin}
              aria-label="Return to workspace"
              className="mt-6 w-full rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
            >
              Return to Workspace
            </button>
          </section>
        </div>
      ) : (
        <div className="relative flex flex-1 flex-col">
          <div
            aria-hidden={left ? true : undefined}
            className={left ? 'pointer-events-none select-none opacity-40 blur-[1px]' : undefined}
          >
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
          </div>

          {left && (
            <div className="absolute inset-0 flex items-start justify-center overflow-y-auto bg-slate-50/60 p-4 sm:items-center">
              <LeftRoomState
                roomId={roomId}
                displayName={identity.displayName}
                onRejoin={handleRejoin}
                onGoDashboard={handleGoDashboard}
              />
            </div>
          )}
        </div>
      )}

      {shareNote && (
        <p role="status" className="mx-auto w-full max-w-[1600px] px-4 pb-3 font-mono text-xs text-slate-500">
          {shareNote}
        </p>
      )}
    </AppLayout>
  );
}
