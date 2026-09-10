import React from 'react';

/**
 * CodeEditorPanel — Avantee (React UI / Frontend Engineer)
 *
 * Clean container for Kishan's Monaco editor. Kishan mounts his
 * <CodeEditor /> via `children`. Until then, an integration placeholder
 * is shown. No Monaco / Yjs / collaboration logic lives here.
 */
export default function CodeEditorPanel({
  children,
  title = 'Code Editor',
  language,
  isLoading = false,
  error = null,
  onRetry,
  className = '',
}) {
  return (
    <section className={`flex h-full min-h-0 flex-col ${className}`} aria-label={title} role="region">
      <div className="flex shrink-0 items-center justify-between px-1 pb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {language && (
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 font-mono text-xs text-slate-500">
            {language}
          </span>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-slate-100/80">
            <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-teal-600 border-t-transparent" aria-hidden="true" />
            <span className="text-sm text-slate-500">Loading editor…</span>
          </div>
        )}
        {error && !isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50/90 p-4">
            <div className="max-w-sm text-center">
              <p className="font-medium text-rose-700">Editor failed to load</p>
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
          <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-900 p-6 text-center">
            <svg className="h-10 w-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            <p className="font-mono text-sm text-slate-400">Editor integration point</p>
            <p className="max-w-xs text-xs leading-relaxed text-slate-500">
              Kishan&apos;s Monaco collaboration editor mounts here. No editor logic is bundled with the workspace shell.
            </p>
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
