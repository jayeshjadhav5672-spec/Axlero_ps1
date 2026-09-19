import React, { useEffect, useRef, useState } from 'react';
import {
  buildRoomUrl,
  generateRoomId,
  getRecentRooms,
  isValidRoomId,
} from '../../lib/room';

/**
 * Dashboard — Avantee (React UI / Frontend Engineer)
 *
 * Application home screen for SyncSpace (Day 3). Pure frontend UI:
 * - Welcome section
 * - Create New Room (generates a ROOM_PATTERN-safe id, navigates via the
 *   existing `?room=` mechanism — the realtime layer owns joining)
 * - Join New Room (trim + validate with isValidRoomId, same navigation)
 * - Recent Rooms (browser-local list only, with intentional empty state)
 * - Last-room / Return to Workspace (reuses the existing reconnect seam)
 *
 * Visual system: beige/white/black palette (#F5F1E8 page, #FFFFFF
 * surfaces, #111111 headings and primary actions, #57534E body,
 * #E7DFCC borders). No backend, Socket.io, Yjs, Konva, Monaco, or auth
 * changes here.
 *
 * Aceternity-style integration, dependency-free: Aceternity's Spotlight /
 * CardSpotlight / Grid Background / TextGenerate effects are thin wrappers
 * over motion values; here the same visuals are achieved with CSS variables
 * and plain CSS keyframes so no Motion/Framer Motion, shadcn, or Radix
 * packages are needed. Every effect is static when the user prefers
 * reduced motion.
 *
 * Icons are Lucide-style stroke icons rendered inline (same 24x24 grid,
 * round caps, 1.8px stroke as Lucide: Plus, LogIn, Clock, History,
 * ArrowRight, ArrowUpRight) so no extra icon package is required.
 */

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

function LogoMark({ className = 'h-7 w-7' }) {
  return (
    <svg className={`${className} text-[#111111]`} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}

function StrokeIcon({ className = 'h-5 w-5', children }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function PlusIcon({ className }) {
  return (
    <StrokeIcon className={className}>
      <path d="M5 12h14M12 5v14" />
    </StrokeIcon>
  );
}

function ArrowRightIcon({ className = 'h-4 w-4' }) {
  return (
    <StrokeIcon className={className}>
      <path d="M5 12h14m-7-7 7 7-7 7" />
    </StrokeIcon>
  );
}

function ArrowUpRightIcon({ className = 'h-4 w-4' }) {
  return (
    <StrokeIcon className={className}>
      <path d="M7 7h10v10M7 17 17 7" />
    </StrokeIcon>
  );
}

function LogInIcon({ className = 'h-5 w-5' }) {
  return (
    <StrokeIcon className={className}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
    </StrokeIcon>
  );
}

function ClockIcon({ className = 'h-8 w-8' }) {
  return (
    <StrokeIcon className={className} >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </StrokeIcon>
  );
}

function HistoryIcon({ className = 'h-4 w-4' }) {
  return (
    <StrokeIcon className={className}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </StrokeIcon>
  );
}

/* ------------------------------------------------------------------ */
/* Effects (Aceternity-style, dependency-free)                         */
/* ------------------------------------------------------------------ */

/**
 * Pointer-tracked radial highlight for a card (Aceternity CardSpotlight
 * pattern). Writes --spot-x/--spot-y custom properties; the visible
 * overlay is rendered separately, so non-pointer and reduced-motion
 * users simply never get one.
 */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return undefined;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

function useSpotlight(disabled) {
  const ref = useRef(null);
  const onMouseMove = disabled
    ? undefined
    : (event) => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        el.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
        el.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
      };
  return { ref, onMouseMove };
}

function navigateToRoom(roomId) {
  window.location.href = buildRoomUrl(roomId);
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export default function Dashboard({
  currentRoomId,
  hasActiveRoom = false,
  onReturnToWorkspace,
  user = null,
  onLogin,
  onSignup,
  onProfile,
  onLogout,
}) {
  const [recentRooms] = useState(() => getRecentRooms());
  const [roomInput, setRoomInput] = useState('');
  const [joinError, setJoinError] = useState('');
  const headingRef = useRef(null);
  const reducedMotion = usePrefersReducedMotion();
  const createSpot = useSpotlight(reducedMotion);
  const joinSpot = useSpotlight(reducedMotion);

  // Leave-flow entry ("Go to Dashboard" click or the 10s countdown)
  // unmounts the focused dialog button, which would drop keyboard focus
  // to <body> with no announcement of the new view. Move focus to the
  // Dashboard heading so keyboard and screen-reader users land inside
  // it. hasActiveRoom is true only on leave-flow entry (an initial page
  // load shows the Dashboard only when there is no room), so the
  // initial load is intentionally left alone.
  useEffect(() => {
    if (hasActiveRoom) headingRef.current?.focus();
  }, [hasActiveRoom]);

  const handleCreateRoom = () => {
    navigateToRoom(generateRoomId());
  };

  const handleJoinSubmit = (event) => {
    event.preventDefault();
    const trimmed = roomInput.trim();
    if (!trimmed) {
      setJoinError('Enter a room ID to join.');
      return;
    }
    if (!isValidRoomId(trimmed)) {
      setJoinError('Room IDs use 1–64 letters, numbers, “-” or “_”.');
      return;
    }
    setJoinError('');
    navigateToRoom(trimmed);
  };

  const showLastRoom = hasActiveRoom && isValidRoomId(currentRoomId);
  const showEmptyRecents = recentRooms.length === 0;

  return (
    <div className="relative flex w-full flex-1 flex-col overflow-hidden bg-[#F5F1E8] text-[#57534E]">
      <style>{`@keyframes dashboard-enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}.dashboard-enter{animation:dashboard-enter 450ms ease-out both}@keyframes dashboard-hero-badge{from{opacity:0;transform:translateY(-6px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}.dashboard-hero-badge{animation:dashboard-hero-badge 400ms cubic-bezier(0.22,1,0.36,1) both}@keyframes dashboard-hero-heading{from{opacity:0;transform:translateY(8px) scale(0.98)}to{opacity:1;transform:translateY(0) scale(1)}}.dashboard-hero-heading{animation:dashboard-hero-heading 500ms cubic-bezier(0.22,1,0.36,1) 120ms both}@keyframes dashboard-hero-desc{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.dashboard-hero-desc{animation:dashboard-hero-desc 450ms cubic-bezier(0.22,1,0.36,1) 220ms both}@media (prefers-reduced-motion:reduce){.dashboard-enter,.dashboard-hero-badge,.dashboard-hero-heading,.dashboard-hero-desc{animation:none;opacity:1;transform:none}}`}</style>
      {/* Backdrop: subtle warm grid + restrained neutral glow, faded
          toward the edges so it never competes with the content. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(87,83,78,0.09)_1px,transparent_1px),linear-gradient(90deg,rgba(87,83,78,0.09)_1px,transparent_1px)] bg-[size:36px_36px] [mask-image:radial-gradient(ellipse_75%_65%_at_50%_0%,black,transparent)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(640px_320px_at_50%_-60px,rgba(17,17,17,0.08),transparent)]"
      />

      <div className="dashboard-enter relative mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
        {/* Application header */}
        <header className="flex flex-wrap items-center gap-3">
          <span className="flex min-w-0 items-center gap-2.5">
            <LogoMark />
            <span className="text-lg font-bold tracking-tight text-[#111111]">SyncSpace</span>
            <span className="rounded-full border border-[#E7DFCC] bg-white px-2.5 py-0.5 text-xs font-semibold text-[#57534E]">
              Dashboard
            </span>
          </span>
          {/* Account area: auth entry points branch on auth state — signed-in
              users get profile/sign-out, guests get log-in/create-account. */}
          <span className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
            {user ? (
              <>
                <span className="hidden max-w-[12rem] truncate text-sm font-medium text-[#57534E] sm:inline" aria-label={`Signed in as ${user.name || user.email}`}>
                  {user.username || user.name || user.email}
                </span>
                <button
                  type="button"
                  onClick={onProfile}
                  className="rounded-lg border border-[#E7DFCC] bg-white px-4 py-2 text-sm font-semibold text-[#111111] transition-colors hover:bg-[#EDE6D6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F1E8]"
                >
                  Profile
                </button>
                <button
                  type="button"
                  onClick={onLogout}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-[#57534E] transition-colors hover:text-[#111111] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onLogin}
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-[#57534E] transition-colors hover:text-[#111111] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
                >
                  Log in
                </button>
                <button
                  type="button"
                  onClick={onSignup}
                  className="rounded-lg bg-[#111111] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F1E8]"
                >
                  Create account
                </button>
              </>
            )}
          </span>
        </header>

        {/* Welcome */}
        <section aria-labelledby="dashboard-welcome-title" className="mt-8 text-center sm:mt-10">
          <p className="dashboard-hero-badge inline-flex items-center gap-2 rounded-full border border-[#E7DFCC] bg-white px-3 py-1 text-xs font-medium text-[#57534E]">
            <span className="relative flex h-1.5 w-1.5">
              {!reducedMotion && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#111111] opacity-60" />
              )}
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#111111]" />
            </span>
            Real-time whiteboard + code
          </p>
          <h1
            ref={headingRef}
            tabIndex={-1}
            id="dashboard-welcome-title"
            className="dashboard-hero-heading mx-auto mt-4 max-w-2xl text-3xl font-extrabold tracking-tight text-[#111111] focus-visible:outline-none sm:text-4xl"
          >
            Your workspace, together.
          </h1>
          <p className="dashboard-hero-desc mx-auto mt-3 max-w-xl text-sm text-[#57534E] sm:text-base">
            Create a room or join your team in real time — shared whiteboard and code, in one place.
          </p>
        </section>

        {/* Last room (only when the app already knows one) */}
        {showLastRoom && (
          <section
            aria-labelledby="dashboard-last-room-title"
            className="mx-auto mt-8 flex w-full max-w-2xl flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[#E7DFCC] bg-white px-5 py-3.5"
          >
            <h2 id="dashboard-last-room-title" className="flex items-center gap-1.5 text-sm font-semibold text-[#111111]">
              <HistoryIcon className="h-4 w-4 text-[#57534E]" />
              Last room:
            </h2>
            <span className="min-w-0 truncate font-mono text-sm text-[#111111]">&ldquo;{currentRoomId}&rdquo;</span>
            <button
              type="button"
              onClick={onReturnToWorkspace}
              aria-label="Return to workspace"
              className="ml-auto shrink-0 rounded-lg border border-[#E7DFCC] bg-white px-4 py-2 text-sm font-semibold text-[#111111] transition-colors hover:bg-[#EDE6D6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F1E8]"
            >
              Return to Workspace
            </button>
          </section>
        )}

        {/* Primary actions */}
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:gap-5">
          <section
            aria-labelledby="dashboard-create-title"
            ref={createSpot.ref}
            onMouseMove={createSpot.onMouseMove}
            className="group relative flex flex-col overflow-hidden rounded-2xl border border-[#E7DFCC] bg-white p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#111111] hover:shadow-[0_8px_40px_-12px_rgba(17,17,17,0.15)] sm:p-7"
          >
            {!reducedMotion && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{
                  background:
                    'radial-gradient(260px circle at var(--spot-x, 50%) var(--spot-y, 50%), rgba(17,17,17,0.06), transparent 70%)',
                }}
              />
            )}
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EDE6D6] text-[#111111] transition-transform duration-200 group-hover:scale-105">
              <PlusIcon className="h-5 w-5" />
            </span>
            <h2 id="dashboard-create-title" className="mt-4 text-lg font-bold tracking-tight text-[#111111]">
              Create a new room
            </h2>
            <p className="mt-1.5 text-sm text-[#57534E]">Start a collaborative workspace for your team.</p>
            <button
              type="button"
              onClick={handleCreateRoom}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[#111111] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F1E8]"
            >
              Create Room
              <ArrowRightIcon />
            </button>
          </section>

          <section
            aria-labelledby="dashboard-join-title"
            ref={joinSpot.ref}
            onMouseMove={joinSpot.onMouseMove}
            className="group relative flex flex-col overflow-hidden rounded-2xl border border-[#E7DFCC] bg-white p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#111111] sm:p-7"
          >
            {!reducedMotion && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{
                  background:
                    'radial-gradient(260px circle at var(--spot-x, 50%) var(--spot-y, 50%), rgba(17,17,17,0.06), transparent 70%)',
                }}
              />
            )}
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EDE6D6] text-[#111111] transition-transform duration-200 group-hover:scale-105">
              <LogInIcon />
            </span>
            <h2 id="dashboard-join-title" className="mt-4 text-lg font-bold tracking-tight text-[#111111]">
              Join a room
            </h2>
            <p className="mt-1.5 text-sm text-[#57534E]">Enter a room ID to collaborate with others.</p>
            <form onSubmit={handleJoinSubmit} noValidate className="mt-5 flex w-full flex-col gap-2.5">
              <label htmlFor="dashboard-room-id" className="text-sm font-medium text-[#57534E]">
                Room ID
              </label>
              <input
                id="dashboard-room-id"
                name="roomId"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. team-standup"
                value={roomInput}
                onChange={(event) => {
                  setRoomInput(event.target.value);
                  if (joinError) setJoinError('');
                }}
                aria-invalid={joinError ? true : undefined}
                aria-describedby={joinError ? 'dashboard-room-error' : undefined}
                className="w-full rounded-lg border border-[#E7DFCC] bg-white px-3.5 py-2.5 font-mono text-sm text-[#111111] placeholder:font-sans placeholder:text-[#57534E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
              />
              {joinError && (
                <p id="dashboard-room-error" role="alert" className="text-sm text-rose-700">
                  {joinError}
                </p>
              )}
              <button
                type="submit"
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg border border-[#E7DFCC] bg-white px-5 py-2.5 text-sm font-semibold text-[#111111] transition-colors hover:bg-[#EDE6D6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F1E8]"
              >
                Join Room
                <ArrowRightIcon />
              </button>
            </form>
          </section>
        </div>

        {/* Recent rooms */}
        <section
          aria-labelledby="dashboard-recent-title"
          className="mt-8 rounded-2xl border border-[#E7DFCC] bg-white p-6 sm:p-7"
        >
          <div className="flex items-center gap-2.5">
            <h2 id="dashboard-recent-title" className="flex items-center gap-2 text-base font-semibold text-[#111111]">
              <ClockIcon className="h-4 w-4 text-[#57534E]" />
              Recent Rooms
            </h2>
            {recentRooms.length > 0 && (
              <span className="rounded-full border border-[#E7DFCC] bg-white px-2 py-0.5 text-xs font-semibold text-[#57534E]">
                {recentRooms.length}
              </span>
            )}
          </div>
          {showEmptyRecents ? (
            <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-[#E7DFCC] px-6 py-10 text-center">
              <span className="text-[#57534E]">
                <ClockIcon />
              </span>
              <p className="mt-3 text-sm font-medium text-[#57534E]">No recent rooms yet</p>
              <p className="mt-1 text-sm text-[#57534E]">Create or join a room to see it appear here.</p>
            </div>
          ) : (
            <>
              <ul className="mt-4 flex flex-col gap-2">
                {recentRooms.map((room) => (
                  <li key={room}>
                    <button
                      type="button"
                      onClick={() => navigateToRoom(room)}
                      aria-label={`Open room ${room}`}
                      className="group flex w-full items-center gap-3 rounded-xl border border-[#E7DFCC] bg-[#F5F1E8] px-4 py-3 text-left transition-colors hover:border-[#111111] hover:bg-[#EDE6D6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F1E8]"
                    >
                      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[#111111]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-sm text-[#111111]">{room}</span>
                        <span className="block truncate text-xs text-[#57534E]">Shared workspace</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-[#57534E] transition-colors group-hover:text-[#111111]">
                        Open
                        <ArrowUpRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:-translate-y-px group-hover:translate-x-px" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-[#57534E]">Stored in this browser only — not shared across devices.</p>
            </>
          )}
        </section>

        <p className="mt-8 text-center text-xs text-[#57534E]">
          Whiteboard and code stay in sync for everyone in the room.
        </p>
      </div>
    </div>
  );
}
