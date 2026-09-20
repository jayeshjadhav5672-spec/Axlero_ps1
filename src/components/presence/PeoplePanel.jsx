import React, { useEffect, useMemo, useState } from 'react';
import { initialsForDisplayName } from '../../lib/room';

/**
 * PeoplePanel — SyncSpace-native participants readout.
 *
 * Pure presentational view over the existing `users` presence array
 * (same entries PresenceList consumes: { id, name, color?, isActive?,
 * role? }). No new presence system: it renders whoever the live
 * presence state says is in the room, re-rendering as participants
 * join/leave. `currentUserId` (the local identity's user id) marks the
 * "You" row; a `role` string is shown only when an entry actually
 * carries one — roles are never invented here.
 *
 * Props: { users, currentUserId, onClose, className }
 */

function statusFor(user, isCurrent) {
  if (isCurrent) return 'You';
  // Display-only: shown when the backend eventually supplies roles.
  if (typeof user?.role === 'string' && user.role.trim()) {
    const role = user.role.trim();
    return role.charAt(0).toUpperCase() + role.slice(1);
  }
  return 'Participant';
}

function displayNameOf(user) {
  return typeof user?.name === 'string' && user.name.trim() ? user.name.trim() : null;
}

export default function PeoplePanel({ users = [], currentUserId = null, onClose, className = '' }) {
  const list = Array.isArray(users) ? users : [];
  const [query, setQuery] = useState('');
  const showSearch = list.length > 1;

  // Escape closes; listeners cleaned up on unmount (no leaks).
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const visible = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return list;
    return list.filter((user) => {
      const haystacks = [user?.name, user?.displayName].filter((value) => typeof value === 'string');
      return haystacks.some((value) => value.toLowerCase().includes(trimmed));
    });
  }, [list, query]);

  return (
    <div
      role="dialog"
      aria-label={`People in this room (${list.length})`}
      className={`w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-bold tracking-tight text-[#111111]">People</h2>
        <span
          aria-label={`${list.length} participant${list.length === 1 ? '' : 's'}`}
          className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600"
        >
          {list.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close people panel"
          className="ml-auto rounded-md px-2 py-1 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#111111] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          ✕
        </button>
      </div>

      <div className="flex max-h-80 flex-col px-4 py-3">
        {showSearch && (
          <div className="pb-2">
            <label htmlFor="people-search" className="sr-only">
              Search people
            </label>
            <input
              id="people-search"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Search people"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#111111] placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            />
          </div>
        )}

        <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">In the room</p>

        {visible.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">
            {list.length === 0 ? 'No one in the room yet.' : `No matches for “${query.trim()}”.`}
          </p>
        ) : (
          <ul className="-mx-1 flex-1 overflow-y-auto px-1 py-1" aria-label="Participants">
            {visible.map((user) => {
              const isCurrent = currentUserId != null && String(user?.id) === String(currentUserId);
              const name = displayNameOf(user) || 'Unknown';
              return (
                <li
                  key={user?.id ?? name}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50"
                >
                  <span
                    aria-hidden="true"
                    className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-white"
                    style={user?.color ? { backgroundColor: user.color } : undefined}
                  >
                    {!user?.color && <span className="absolute inset-0 rounded-full bg-slate-500" aria-hidden="true" />}
                    <span className="relative">{initialsForDisplayName(user?.name)}</span>
                    {user?.isActive !== false && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[#111111]">{name}</span>
                    <span className="block truncate text-xs text-slate-500">{statusFor(user, isCurrent)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
