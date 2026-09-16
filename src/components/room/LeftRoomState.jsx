import React, { useEffect, useRef, useState } from 'react';

/**
 * LeftRoomState — Avantee (React UI / Frontend Engineer)
 *
 * Polished frontend state shown after the user leaves the room.
 * Pure UI: all room/session data arrives via props, all actions are
 * callbacks wired to the existing navigation/room mechanism in App.
 *
 * Countdown: single 1s interval starting at `redirectAfterSeconds`,
 * cleaned up on unmount/action. No realtime logic, no timers left
 * running — safe to mount alongside the dimmed workspace.
 */
export const LEFT_ROOM_REDIRECT_SECONDS = 10;

export default function LeftRoomState({
  roomId = 'lobby',
  displayName,
  redirectAfterSeconds = LEFT_ROOM_REDIRECT_SECONDS,
  onRejoin,
  onGoDashboard,
}) {
  const [secondsLeft, setSecondsLeft] = useState(redirectAfterSeconds);
  const doneRef = useRef(false);
  const timeoutRef = useRef(null);
  const onGoDashboardRef = useRef(onGoDashboard);
  // Keep render pure: sync the latest callback in an effect so the
  // interval (deps: room/seconds only) never restarts on re-renders
  // and stays StrictMode-safe.
  useEffect(() => {
    onGoDashboardRef.current = onGoDashboard;
  });

  // Reset + run a single countdown per mount/room. Cleanup clears the
  // interval AND any deferred navigation timeout, so Rejoin/Dashboard
  // actions (or unmount) can never leave a stray navigation behind —
  // including the tick→timeout window at zero seconds.
  useEffect(() => {
    setSecondsLeft(redirectAfterSeconds);
    doneRef.current = false;
    const timerId = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerId);
          if (!doneRef.current) {
            doneRef.current = true;
            // Defer so the state update above commits before navigating.
            timeoutRef.current = setTimeout(() => onGoDashboardRef.current?.(), 0);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      clearInterval(timerId);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [roomId, redirectAfterSeconds]);

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="left-room-title"
      aria-describedby="left-room-desc left-room-countdown"
      className="flex w-full max-w-md flex-col items-center rounded-2xl border border-slate-200 bg-white px-8 py-10 text-center shadow-lg"
    >
      <span className="flex items-center gap-2">
        <svg className="h-6 w-6 text-[#111111]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
        <span className="text-base font-bold tracking-tight text-[#111111]">SyncSpace</span>
      </span>

      <h2 id="left-room-title" className="mt-5 text-xl font-semibold text-slate-900">
        You left the room
      </h2>
      <p className="mt-1 font-mono text-sm text-teal-700" aria-label={`Room ${roomId}`}>
        &ldquo;{roomId}&rdquo;
      </p>
      <p id="left-room-desc" className="mt-2 text-sm text-slate-500">
        Your session has ended.
        {displayName ? ` Signed in as ${displayName}.` : ''}
      </p>

      <div className="mt-6 flex w-full flex-col gap-2.5">
        <button
          type="button"
          onClick={onRejoin}
          aria-label="Rejoin room"
          autoFocus
          className="w-full rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
        >
          Rejoin Room
        </button>
        <button
          type="button"
          onClick={onGoDashboard}
          aria-label="Go to dashboard"
          className="w-full rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
        >
          Go to Dashboard
        </button>
      </div>

      <p id="left-room-countdown" role="timer" aria-live="polite" className="mt-5 text-xs text-slate-400">
        Returning to dashboard in {secondsLeft}s
      </p>
    </section>
  );
}
