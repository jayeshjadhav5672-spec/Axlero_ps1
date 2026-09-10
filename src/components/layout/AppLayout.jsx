import React from 'react';

/**
 * AppLayout — Avantee (React UI / Frontend Engineer)
 *
 * Full-viewport application shell. Pure layout; no data fetching.
 */
export default function AppLayout({ children, className = '' }) {
  return (
    <div className={`flex min-h-screen flex-col bg-slate-50 text-slate-800 ${className}`}>
      <a
        href="#workspace-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-teal-700 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to workspace
      </a>
      <div className="flex min-h-screen flex-1 flex-col">{children}</div>
    </div>
  );
}
