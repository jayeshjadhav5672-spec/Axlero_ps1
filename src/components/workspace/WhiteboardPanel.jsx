import React from 'react';

/**
 * WhiteboardPanel — Avantee (React UI / Frontend Engineer)
 *
 * Shell around Sayon's <Whiteboard /> (src/components/canvas).
 * Provides the responsive container and loading / error / empty states.
 * The WHITEBOARD label + toolbar header row belongs to Sayon's component
 * (it owns the tool state), so this panel hides its own duplicate title
 * row once the canvas is mounted. Drawing tools and toolbar belong to
 * Sayon's component — this panel intentionally adds none.
 */
export default function WhiteboardPanel({
  children,
  title = 'Whiteboard',
  isLoading = false,
  error = null,
  onRetry,
  className = '',
}) {
  const canvasMounted = !isLoading && !error && Boolean(children);
  return (
    <section className={`flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-white p-2 pl-3 ${className}`} aria-label={title} role="region">
      {!canvasMounted && (
        <div className="flex h-12 shrink-0 items-center justify-between px-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        </div>
      )}
      <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl border border-teal-100 bg-teal-50/80">
            <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-teal-600 border-t-transparent" aria-hidden="true" />
            <span className="text-sm text-slate-500">Loading whiteboard…</span>
          </div>
        )}
        {error && !isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50/90 p-4">
            <div className="max-w-sm text-center">
              <p className="font-medium text-rose-700">Whiteboard failed to load</p>
              <p className="mb-4 mt-1 text-sm text-slate-500">{error}</p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        )}
        {!isLoading && !error && !children && (
          <div className="flex h-full min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-slate-400">
            <p className="text-sm">Whiteboard is not mounted</p>
          </div>
        )}
        {children && (
          <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">{children}</div>
        )}
      </div>
    </section>
  );
}
