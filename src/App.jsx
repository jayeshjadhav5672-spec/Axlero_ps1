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
 * - Auth: real JWT sessions (signup/login/me/logout) persisted in
 *   localStorage and re-validated on load; the JWT travels in the
 *   Socket.io handshake where server middleware sets socket.user
 *
 * Offline honesty: when the realtime server is unreachable the banner
 * says so and the whiteboard/editor keep working locally.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AppLayout from './components/layout/AppLayout';
import Workspace from './components/workspace/Workspace';
import { LeftRoomState } from './components/room';
import Dashboard from './components/dashboard/Dashboard';
import LandingPage from './components/landing/LandingPage';
import LoginPage from './components/auth/LoginPage';
import SignupPage from './components/auth/SignupPage';
import ProfilePage from './components/auth/ProfilePage';
import { Whiteboard } from './components/canvas';
import CollabTextEditor from './components/editor/CollabTextEditor';
import useRoomConnection from './hooks/useRoomConnection';
import useCollaborativeWhiteboard from './hooks/useCollaborativeWhiteboard';
import useCollaborativeCode from './hooks/useCollaborativeCode';
import {
  buildRoomUrl,
  getOrCreateIdentity,
  getRoomIdFromUrl,
  hasEnteredApp,
  isValidRoomId,
  markEnteredApp,
  presenceToUsers,
  recordRecentRoom,
  shouldShowLanding,
  urlForDashboardView,
  urlForWorkspaceView,
} from './lib/room';
import { clearStoredSession, getStoredSession, meRequest, setStoredSession } from './lib/auth';

export default function App() {
  const [roomId] = useState(() => getRoomIdFromUrl());
  // Auth session ({ token, user } | null), persisted in localStorage.
  // Restored on load and re-validated against GET /api/auth/me; a dead
  // token falls back to anonymous Guest collaboration.
  const [session, setSession] = useState(() => getStoredSession());
  // Collaboration identity: the signed-in account when a session exists,
  // otherwise the stable per-browser Guest identity (unchanged behavior).
  const identity = useMemo(() => {
    if (session?.user) {
      return {
        userId: String(session.user.id ?? session.user.email ?? 'guest'),
        displayName: session.user.displayName || session.user.email || 'Guest',
      };
    }
    return getOrCreateIdentity();
  }, [session]);
  const [shareNote, setShareNote] = useState('');
  // Day 3 full Dashboard: the home/start screen. Shown by default when the
  // URL carries no explicit `?room=`, and entered later via "Go to
  // Dashboard" or the 10s left-room countdown. No router, no
  // room-lifecycle changes — `?room=` stays intact so Rejoin / Return to
  // Workspace returns to the same workspace.
  const [initialPresence] = useState(() => {
    try {
      return { hasRoom: isValidRoomId(new URLSearchParams(window.location.search).get('room')) };
    } catch {
      return { hasRoom: false };
    }
  });
  const [dashboardView, setDashboardView] = useState(() => !initialPresence.hasRoom);
  // Landing page: the default entry view on "/" (no `?room=`) for a first
  // visit in this session. Once the user has entered the app the entry
  // is persisted in sessionStorage, so a reload of a room-free URL
  // restores the Dashboard instead of Landing. A valid `?room=` starts
  // in the Workspace directly, exactly as before.
  const [showLanding, setShowLanding] = useState(
    () => shouldShowLanding(initialPresence.hasRoom, hasEnteredApp()),
  );
  // Frontend-only auth views extend the existing useState-based view
  // switching — no router. One of null | 'login' | 'signup' | 'profile'.
  const [authView, setAuthView] = useState(null);

  // Re-validate a restored session once per load: an expired or revoked
  // token drops back to Guest instead of impersonating a dead account.
  useEffect(() => {
    let cancelled = false;
    const stored = getStoredSession();
    if (!stored?.token) return undefined;
    meRequest(stored.token)
      .then((data) => {
        if (cancelled) return;
        if (data?.user) {
          const fresh = { token: stored.token, user: data.user };
          setStoredSession(fresh);
          setSession(fresh);
        } else {
          clearStoredSession();
          setSession(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        clearStoredSession();
        setSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { socket, status, presence, error, left, reconnect, leaveRoom } = useRoomConnection({
    roomId,
    userId: identity.userId,
    displayName: identity.displayName,
    authToken: session?.token ?? null,
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

  // Browser-local recent list (display only — not backend persistence).
  // Recorded when the workspace is visible so the Dashboard can offer it.
  useEffect(() => {
    if (!dashboardView && !left && isValidRoomId(roomId)) recordRecentRoom(roomId);
  }, [dashboardView, left, roomId]);

  // Existing mechanisms, reused as-is: reconnect() re-joins the same
  // `?room=` room via useRoomConnection; leaveRoom() emits room:leave.
  //
  // Address-bar hygiene (replaceState, no reload): the Dashboard is shown
  // with a room-free URL so a reload/bookmark/new tab opens the Dashboard
  // instead of re-entering the last room, while the Workspace keeps
  // `?room=` so a refresh stays in the same room. Room state itself always
  // comes from the `roomId` snapshot + the socket lifecycle - never by
  // re-reading the URL - so this cannot break Rejoin / Return to Workspace.
  const syncUrlForView = (inDashboard, id) => {
    try {
      const current = window.location.href;
      const next = inDashboard ? urlForDashboardView(current) : urlForWorkspaceView(current, id);
      if (next !== current) window.history.replaceState(null, '', next);
    } catch {
      // non-browser / restricted context — view state is unaffected
    }
  };

  const handleRejoin = useCallback(() => {
    syncUrlForView(false, roomId);
    setDashboardView(false);
    reconnect();
  }, [reconnect, roomId]);

  const handleGoDashboard = useCallback(() => {
    markEnteredApp();
    syncUrlForView(true);
    setDashboardView(true);
  }, []);

  // Persist "entered app" once the Landing is dismissed for any reason
  // (entering the Dashboard, or landing directly in a Workspace via
  // `?room=`), so a later reload of a room-free URL restores the
  // Dashboard and "Leave workspace → /" lands on the Dashboard too.
  useEffect(() => {
    if (!showLanding) markEnteredApp();
  }, [showLanding]);

  const handleEnterApp = useCallback(() => {
    markEnteredApp();
    setShowLanding(false);
  }, []);

  const goDashboard = useCallback(() => setAuthView(null), []);

  const handleSignupSuccess = useCallback((nextSession) => {
    // New account → straight into the workspace with a live session.
    if (nextSession?.token && nextSession?.user) {
      setStoredSession(nextSession);
      setSession(nextSession);
    }
    setAuthView(null);
  }, []);

  const handleLoginSuccess = useCallback((nextSession) => {
    if (nextSession?.token && nextSession?.user) {
      setStoredSession(nextSession);
      setSession(nextSession);
    }
    setAuthView(null);
  }, []);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    setSession(null);
    setAuthView(null);
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

      {showLanding ? (
        <LandingPage onEnter={handleEnterApp} />
      ) : authView === 'login' ? (
        <LoginPage
          onSuccess={handleLoginSuccess}
          onSwitchToSignup={() => setAuthView('signup')}
          onBack={goDashboard}
        />
      ) : authView === 'signup' ? (
        <SignupPage
          onSuccess={handleSignupSuccess}
          onSwitchToLogin={() => setAuthView('login')}
          onBack={goDashboard}
        />
      ) : authView === 'profile' ? (
        <ProfilePage
          user={session?.user ?? null}
          onLogout={handleLogout}
          onBack={goDashboard}
          onLogin={() => setAuthView('login')}
          onSignup={() => setAuthView('signup')}
        />
      ) : dashboardView ? (
        <Dashboard
          currentRoomId={roomId}
          hasActiveRoom={initialPresence.hasRoom}
          onReturnToWorkspace={handleRejoin}
          user={session?.user ? { ...session.user, name: session.user.displayName } : null}
          onLogin={() => setAuthView('login')}
          onSignup={() => setAuthView('signup')}
          onProfile={() => setAuthView('profile')}
          onLogout={handleLogout}
        />
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            aria-hidden={left ? true : undefined}
            // inert keeps keyboard focus inside the left-room dialog while
            // the workspace is dimmed (React 19 supports boolean inert).
            inert={left ? true : undefined}
            className={`flex min-h-0 flex-1 flex-col overflow-hidden ${left ? 'pointer-events-none select-none opacity-40 blur-[1px]' : ''}`}
          >
            <Workspace
              roomId={roomId}
              connectionStatus={status}
              users={users}
              currentUserId={identity.userId}
              whiteboard={
                <Whiteboard
                  shapes={whiteboardSync.shapes}
                  roomId={roomId}
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
