import { ConnectionStatus } from '../connection';
import { PresenceList } from '../presence';
import { RoomInfo } from '../room';

/**
 * WorkspaceHeader — Avantee (React UI / Frontend Engineer)
 *
 * Top bar: branding, room/session, connection state, collaborators.
 * All live data arrives via props so Arun/Shree/Vaishnavi modules can
 * plug in without touching this component.
 */
export default function WorkspaceHeader({
  roomId,
  roomName,
  connectionStatus = 'disconnected',
  users = [],
  onLeaveRoom,
  onShareRoom,
  className = '',
}) {
  return (
    <header
      className={`sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur sm:px-4 ${className}`}
      role="banner"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex shrink-0 items-center gap-2">
          <svg className="h-6 w-6 text-teal-700" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span className="text-base font-bold tracking-tight text-slate-900">SyncSpace</span>
        </span>
        <RoomInfo roomId={roomId} roomName={roomName} onLeave={onLeaveRoom} onShare={onShareRoom} />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <ConnectionStatus status={connectionStatus} showLabel={false} />
        <span className="hidden text-sm text-slate-500 sm:inline" aria-label={`${users.length} collaborators in room`}>
          {users.length} user{users.length === 1 ? '' : 's'}
        </span>
        <PresenceList users={users} maxVisible={4} />
      </div>
    </header>
  );
}
