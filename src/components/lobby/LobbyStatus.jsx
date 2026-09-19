import React from 'react';

/**
 * LobbyStatus — presentational lobby readout for two-person rooms.
 *
 * Renders the lobby state from the existing `users` presence array
 * (same entries PresenceList consumes: { id, name, ... }). Entries may
 * optionally carry a `role` field once the backend sends it — roles are
 * read opportunistically and the component degrades gracefully when
 * they are missing (shows names + a generic waiting note instead of
 * role slots).
 *
 * States:
 * 1. Empty lobby → "No participants yet"
 * 2. Only an instructor → "Instructor" / "Waiting for student..."
 * 3. Only a student → "Student" / "Waiting for instructor..."
 * 4. Both present → "Instructor" / "Student" / "Lobby ready"
 * 5. No "Lobby full" state here on purpose: a full-lobby rejection
 *    arrives as `connection:error` and is already surfaced by the
 *    App banner — this component never duplicates that path.
 *
 * Pure UI: no capacity or role enforcement lives on the client.
 * That belongs entirely to the server.
 */

export const LOBBY_ROOM_PREFIX = 'lobby-';

/**
 * Lobby-mode detection stays a pure frontend concern: room ids starting
 * with `lobby-` are lobbies, everything else is a regular room.
 * No new protocol, no server round-trip.
 */
export function isLobbyRoomId(roomId) {
  return typeof roomId === 'string' && roomId.startsWith(LOBBY_ROOM_PREFIX);
}

function displayNameOf(user) {
  return typeof user?.name === 'string' && user.name.trim() ? user.name.trim() : null;
}

function Slot({ label, name, waitingText, present }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${present ? 'bg-emerald-500' : 'bg-amber-400'}`}
      />
      <span className="font-semibold text-slate-700">{label}:</span>
      <span className="truncate text-slate-500">{present ? name : waitingText}</span>
    </span>
  );
}

export default function LobbyStatus({ users = [], className = '' }) {
  const list = Array.isArray(users) ? users : [];
  const instructors = list.filter((user) => user?.role === 'instructor');
  const students = list.filter((user) => user?.role === 'student');
  const unroled = list.filter((user) => user?.role !== 'instructor' && user?.role !== 'student');
  const hasRoles = instructors.length > 0 || students.length > 0;

  let summary;
  let tone;
  if (list.length === 0) {
    summary = 'No participants yet';
    tone = 'slate';
  } else if (!hasRoles) {
    summary = 'Waiting for partner…';
    tone = 'amber';
  } else if (instructors.length > 0 && students.length > 0) {
    summary = 'Lobby ready';
    tone = 'emerald';
  } else {
    summary = 'Waiting…';
    tone = 'amber';
  }

  const toneDot =
    tone === 'emerald' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-400' : 'bg-slate-300';

  const ariaLabel =
    list.length === 0
      ? 'Lobby: no participants yet'
      : `Lobby: ${summary}`;

  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 bg-white px-4 py-2 text-sm sm:px-6 ${className}`}
    >
      <span className="inline-flex shrink-0 items-center gap-1.5">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${toneDot}`} />
        <span className="font-semibold tracking-tight text-[#111111]">Lobby</span>
        <span className="text-slate-500">{summary}</span>
      </span>

      {list.length > 0 && !hasRoles && (
        <span className="min-w-0 truncate text-slate-500">
          {list.map(displayNameOf).filter(Boolean).join(', ') || `${list.length} here`}
        </span>
      )}

      {hasRoles && (
        <>
          <Slot
            label="Instructor"
            name={displayNameOf(instructors[0]) || 'Joined'}
            waitingText="Waiting for instructor…"
            present={instructors.length > 0}
          />
          <Slot
            label="Student"
            name={displayNameOf(students[0]) || 'Joined'}
            waitingText="Waiting for student…"
            present={students.length > 0}
          />
          {unroled.length > 0 && (
            <span className="min-w-0 truncate text-xs text-slate-400">
              Also here: {unroled.map(displayNameOf).filter(Boolean).join(', ') || unroled.length}
            </span>
          )}
        </>
      )}
    </div>
  );
}
