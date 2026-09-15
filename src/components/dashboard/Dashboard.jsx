import React, { useState } from 'react';
import {
  buildRoomUrl,
  generateRoomId,
  getRecentRooms,
  isValidRoomId,
} from '../../lib/room';

/**
 * Dashboard — Avantee (React UI / Frontend Engineer)
 *
 * Full home/start screen for SyncSpace (Day 3). Pure frontend UI:
 * - Welcome section
 * - Create New Room (generates a ROOM_PATTERN-safe id, navigates via the
 *   existing `?room=` mechanism — the realtime layer owns joining)
 * - Join New Room (trim + validate with isValidRoomId, same navigation)
 * - Recent Rooms (browser-local list only, with intentional empty state)
 * - Last-room / Return to Workspace (reuses the existing reconnect seam)
 *
 * No backend, Socket.io, Yjs, Konva, Monaco, or auth changes here.
 */

function LogoMark({ className = 'h-7 w-7' }) {
  return (
    <svg className={`${className} text-teal-700`} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}

function navigateToRoom(roomId) {
  window.location.href = buildRoomUrl(roomId);
}

export default function Dashboard({ currentRoomId, hasActiveRoom = false, onReturnToWorkspace }) {
  const [recentRooms] = useState(() => getRecentRooms());
  const [roomInput, setRoomInput] = useState('');
  const [joinError, setJoinError] = useState('');

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
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8">
      {/* Branding / header row */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <LogoMark />
          <span className="text-lg font-bold tracking-tight text-slate-900">SyncSpace</span>
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-500">
            Dashboard
          </span>
        </span>
        {showLastRoom && (
          <button
            type="button"
            onClick={onReturnToWorkspace}
            aria-label="Return to workspace"
            className="ml-auto shrink-0 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
          >
            Return to Workspace
          </button>
        )}
      </div>

      {/* Welcome */}
      <section aria-labelledby="dashboard-welcome-title" className="mt-6">
        <h1 id="dashboard-welcome-title" className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Welcome to SyncSpace
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500 sm:text-base">
          Collaborate with your team in real time. Create a new room or join an existing one to get started.
        </p>
      </section>

      {/* Create + Join */}
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <section
          aria-labelledby="dashboard-create-title"
          className="flex flex-col rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-sm"
        >
          <h2 id="dashboard-create-title" className="text-base font-semibold text-slate-900">
            Create New Room
          </h2>
          <p className="mt-1.5 text-sm text-slate-500">Start a new collaborative workspace.</p>
          <button
            type="button"
            onClick={handleCreateRoom}
            className="mt-5 w-full rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
          >
            Create New Room
          </button>
        </section>

        <section
          aria-labelledby="dashboard-join-title"
          className="flex flex-col rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-sm"
        >
          <h2 id="dashboard-join-title" className="text-base font-semibold text-slate-900">
            Join a Room
          </h2>
          <p className="mt-1.5 text-sm text-slate-500">Enter a room ID to collaborate with others.</p>
          <form onSubmit={handleJoinSubmit} noValidate className="mt-5 flex w-full flex-col gap-2.5">
            <label htmlFor="dashboard-room-id" className="text-sm font-medium text-slate-700">
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
              className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-800 placeholder:font-sans placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            />
            {joinError && (
              <p id="dashboard-room-error" role="alert" className="text-sm text-rose-600">
                {joinError}
              </p>
            )}
            <button
              type="submit"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
            >
              Join Room
            </button>
          </form>
        </section>
      </div>

      {/* Last room (only when the app already knows one) */}
      {showLastRoom && (
        <section
          aria-labelledby="dashboard-last-room-title"
          className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-slate-200 bg-white px-6 py-4 shadow-sm"
        >
          <h2 id="dashboard-last-room-title" className="text-sm font-semibold text-slate-900">
            Last room:
          </h2>
          <span className="min-w-0 truncate font-mono text-sm text-teal-700">&ldquo;{currentRoomId}&rdquo;</span>
          <button
            type="button"
            onClick={onReturnToWorkspace}
            aria-label="Return to workspace"
            className="ml-auto shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
          >
            Return to Workspace
          </button>
        </section>
      )}

      {/* Recent rooms */}
      <section
        aria-labelledby="dashboard-recent-title"
        className="mt-4 rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-sm"
      >
        <h2 id="dashboard-recent-title" className="text-base font-semibold text-slate-900">
          Recent Rooms
        </h2>
        {showEmptyRecents ? (
          <div className="mt-2">
            <p className="text-sm text-slate-500">No recent rooms yet.</p>
            <p className="mt-1 text-sm text-slate-400">Create or join a room to get started.</p>
          </div>
        ) : (
          <>
            <ul className="mt-4 flex flex-col divide-y divide-slate-100">
              {recentRooms.map((room) => (
                <li key={room} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-sm text-slate-700">{room}</span>
                  <button
                    type="button"
                    onClick={() => navigateToRoom(room)}
                    aria-label={`Open room ${room}`}
                    className="shrink-0 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-400">Stored in this browser only — not shared across devices.</p>
          </>
        )}
      </section>
    </div>
  );
}
