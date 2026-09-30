import React, { useState } from 'react';
import { ConnectionStatus } from '../connection';
import { PeoplePanel, PresenceList } from '../presence';
import { RoomInfo } from '../room';

/**
 * WorkspaceHeader — Avantee (React UI / Frontend Engineer)
 *
 * Top bar: branding, room/session, connection state, collaborators.
 * All live data arrives via props so Arun/Shree/Vaishnavi modules can
 * plug in without touching this component.
 *
 * Day 1: enlarged into a proper application header (taller, roomier
 * padding, clearer hierarchy) while keeping the SyncSpace
 * developer-tool aesthetic. Leave-room still flows through the
 * existing onLeaveRoom callback — no new room lifecycle here.
 */
export default function WorkspaceHeader({
  roomId,
  roomName,
  connectionStatus = 'disconnected',
  users = [],
  // Local identity's user id — marks the "You" row in the people panel.
  // Raw presence data is untouched; this only labels existing entries.
  currentUserId = null,
  onLeaveRoom,
  onShareRoom,
  className = '',
}) {
  const [peopleOpen, setPeopleOpen] = useState(false);

  return (
    <header
      className={`sticky top-0 z-20 flex min-h-[76px] flex-wrap items-center gap-x-5 gap-y-3 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur sm:px-6 sm:py-4 ${className}`}
      role="banner"
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span className="flex shrink-0 items-center gap-2.5">
          <svg className="h-7 w-7 text-[#111111]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span className="text-lg font-bold tracking-tight text-[#111111]">SyncSpace</span>
        </span>
        <span className="hidden h-8 w-px shrink-0 bg-slate-200 sm:inline-block" aria-hidden="true" />
        <RoomInfo roomId={roomId} roomName={roomName} onLeave={onLeaveRoom} onShare={onShareRoom} />
      </div>
      <div className="relative flex shrink-0 items-center gap-3 sm:gap-4">
        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
          <ConnectionStatus status={connectionStatus} showLabel />
        </span>
        {/* People toggle: a div with button semantics (not a <button>)
            because PresenceList renders a block-level list when
            participants exist, which is invalid inside <button>.
            Keyboard activation via Enter/Space matches native buttons. */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setPeopleOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setPeopleOpen((open) => !open);
            }
          }}
          aria-haspopup="dialog"
          aria-expanded={peopleOpen}
          aria-label={`People in this room, ${users.length} participant${users.length === 1 ? '' : 's'}`}
          className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-1 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 sm:gap-4"
        >
          <span className="hidden text-sm text-slate-500 md:inline" aria-hidden="true">
            {users.length} user{users.length === 1 ? '' : 's'}
          </span>
          <PresenceList users={users} maxVisible={4} />
        </div>
        {peopleOpen && (
          <PeoplePanel
            users={users}
            currentUserId={currentUserId}
            onClose={() => setPeopleOpen(false)}
            className="absolute right-0 top-[calc(100%+8px)] z-30"
          />
        )}
      </div>
    </header>
  );
}
