/**
 * ZoomBar — Excalidraw-style bottom utility controls. Permanently rendered
 * across ALL tools (select, hand, eraser, and every creation tool).
 * Floating pill: undo/redo (disabled unless wired), zoom out, % badge
 * with reset, zoom in, clear canvas. Plus a canvas status pill
 * (shape count · zoom %).
 */
export default function ZoomBar({
  scale = 1,
  shapeCount = 0,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onClear,
}) {
  const pct = Math.round(scale * 100);
  const btn =
    'flex h-8 w-8 items-center justify-center rounded-md text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-35';

  return (
    <div className="pointer-events-auto flex items-center gap-2">
      <div
        role="toolbar"
        aria-label="Canvas zoom"
        className="flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white px-1.5 py-1 shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
      >
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title={canUndo ? 'Undo (Ctrl+Z)' : 'Nothing to undo'}
          aria-label="Undo"
          className={btn}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 14 4 9 9 4" />
            <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title={canRedo ? 'Redo (Ctrl+Y)' : 'Nothing to redo'}
          aria-label="Redo"
          className={btn}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 14 20 9 15 4" />
            <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
          </svg>
        </button>

        <span className="mx-1 h-5 w-px bg-gray-200" aria-hidden="true" />

        <button type="button" onClick={onZoomOut} title="Zoom out" aria-label="Zoom out" className={btn}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onResetZoom}
          title="Reset zoom to 100%"
          aria-label={`Zoom ${pct} percent — click to reset to 100 percent`}
          className="flex h-8 min-w-[52px] items-center justify-center rounded-md px-1 text-xs font-semibold tabular-nums text-gray-700 transition-colors hover:bg-gray-100"
        >
          {pct}%
        </button>
        <button type="button" onClick={onZoomIn} title="Zoom in" aria-label="Zoom in" className={btn}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        <span className="mx-1 h-5 w-px bg-gray-200" aria-hidden="true" />

        <button
          type="button"
          onClick={onClear}
          title="Clear canvas"
          aria-label="Clear canvas"
          className={btn}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>

      <div
        aria-live="polite"
        className="hidden rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium tabular-nums text-gray-500 shadow-[0_2px_8px_rgba(0,0,0,0.08)] sm:block"
      >
        {shapeCount} {shapeCount === 1 ? 'shape' : 'shapes'} · {pct}%
      </div>
    </div>
  );
}
