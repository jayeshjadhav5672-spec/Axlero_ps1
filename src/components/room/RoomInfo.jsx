import React from 'react';

/**
 * RoomInfo — Avantee (React UI / Frontend Engineer)
 *
 * Session/room display. Consumes room data via props and exposes
 * leave/share as callbacks for Vaishnavi's backend + App wiring.
 *
 * Day 1: Leave Room is a clearly visible labeled action sized for the
 * enlarged navbar. It still calls the existing onLeave callback —
 * no new room-leave system.
 */
export default function RoomInfo({ roomId = 'demo-room', roomName, onLeave, onShare, className = '' }) {
  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <svg className="h-5 w-5 shrink-0 text-teal-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-[15px] font-semibold text-slate-800">{roomName || roomId}</p>
        {roomName ? (
          <p className="truncate font-mono text-xs text-slate-400">{roomId}</p>
        ) : (
          <p className="truncate font-mono text-xs text-slate-400">id: {roomId}</p>
        )}
      </div>
      {(onShare || onLeave) && (
        <div className="ml-1 flex shrink-0 items-center gap-2 border-l border-slate-200 pl-3">
          {onShare && (
            <button
              type="button"
              onClick={onShare}
              className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-teal-50 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              aria-label="Copy room invite link"
              title="Copy invite link"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </button>
          )}
          {onLeave && (
            <button
              type="button"
              onClick={onLeave}
              aria-label="Leave room"
              title="Leave room"
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-100 hover:text-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-1"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Leave room
            </button>
          )}
        </div>
      )}
    </div>
  );
}
