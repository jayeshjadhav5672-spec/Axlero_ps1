import React from 'react';

function ToolIcon({ children }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const SELECT_ICON = (
  <>
    <path d="M4 3l7.5 18 2.5-7.5L21.5 11 4 3z" />
  </>
);

// Excalidraw-order tools (selection, rectangle, diamond, ellipse, arrow,
// line, pen, text, eraser). Diamond maps to the `diamond` shape type in
// utils/shapes.js and renders as a closed 4-point polygon.
const TOOLS = [
  {
    value: 'select',
    label: 'Selection',
    shortcut: '1',
    title: 'Selection (1 or V)',
    icon: SELECT_ICON,
  },
  {
    value: 'rectangle',
    label: 'Rectangle',
    shortcut: '2',
    title: 'Rectangle (2 or R — drag any direction)',
    icon: <rect x="3" y="3" width="18" height="18" rx="2" />,
  },
  {
    value: 'circle',
    label: 'Ellipse',
    shortcut: '3',
    title: 'Ellipse (3 or C — center + radius)',
    icon: <ellipse cx="12" cy="12" rx="9" ry="7" />,
  },
  {
    value: 'diamond',
    label: 'Diamond',
    shortcut: 'D',
    title: 'Diamond (D — drag any direction)',
    icon: <path d="M12 3 L21 12 L12 21 L3 12 Z" />,
  },
  {
    value: 'arrow',
    label: 'Arrow',
    shortcut: 'A',
    title: 'Arrow (A — drag, then drag the midpoint handle to bend)',
    icon: (
      <>
        <line x1="5" y1="19" x2="19" y2="5" />
        <polyline points="9 5 19 5 19 15" />
      </>
    ),
  },
  {
    value: 'line',
    label: 'Line',
    shortcut: 'L',
    title: 'Line (L — two points)',
    icon: <line x1="5" y1="19" x2="19" y2="5" />,
  },
  {
    value: 'freehand',
    label: 'Pen',
    shortcut: 'P',
    title: 'Pen — freehand (P)',
    icon: <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />,
  },
  {
    value: 'text',
    label: 'Text',
    shortcut: 'T',
    title: 'Text (T — click to place, Enter to commit)',
    icon: (
      <>
        <polyline points="4 7 4 4 20 4 20 7" />
        <line x1="9" y1="20" x2="15" y2="20" />
        <line x1="12" y1="4" x2="12" y2="20" />
      </>
    ),
  },
  {
    value: 'eraser',
    label: 'Eraser',
    shortcut: 'E',
    title: 'Eraser (E — click a shape to delete)',
    icon: (
      <>
        <path d="M20 20H8L3 15a1.5 1.5 0 0 1 0-2.1l9.2-9.2a1.5 1.5 0 0 1 2.1 0l5.2 5.2a1.5 1.5 0 0 1 0 2.1L13 18" />
        <line x1="6" y1="21" x2="21" y2="21" />
      </>
    ),
  },
];

const PAN_TOOL = {
  value: 'pan',
  label: 'Pan',
  shortcut: 'H',
  title: 'Pan (H — drag canvas, wheel to zoom)',
  icon: (
    <>
      <path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-5.5v-1a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V12m0-3a1.5 1.5 0 0 1 3 0v4a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.3l-2-3.4a1.5 1.5 0 0 1 2.6-1.5L8 12" />
    </>
  ),
};

const QUICK_COLORS = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00'];

const QUICK_WIDTHS = [
  { label: 'S', width: 2 },
  { label: 'M', width: 4 },
  { label: 'L', width: 6 },
];

function ActionIcon({ children }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const UNDO_ICON = (
  <>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </>
);

const REDO_ICON = (
  <>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </>
);

const TRASH_ICON = (
  <>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </>
);
const BTN_BASE =
  'relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border text-[15px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-1';
const BTN_ACTIVE = 'bg-violet-100 text-violet-700 border-violet-200 shadow-[inset_0_0_0_1px_rgba(109,88,246,0.15)]';
const BTN_IDLE = 'border-transparent text-gray-700 hover:bg-gray-100 hover:text-gray-900';

/**
 * Toolbar — full-width 3-section header bar docked at the top of the
 * whiteboard: drawing tools (left), quick style swatches (center), canvas
 * status (shape count + zoom steppers) with history/actions + 3-dot
 * customization toggle (right). Back-compat: still
 * accepts the legacy props (locked, onLockedChange, hasSelection, onDelete)
 * and ignores them. Style/actions/status props are all optional — each section
 * degrades gracefully when its handlers are absent.
 */
export default function Toolbar({
  tool,
  onToolChange,
  locked,
  onLockedChange,
  // legacy (ignored, kept for integration compat)
  hasSelection,
  onDelete,
  // quick styles: prefer currentStyle/onStyleChange, fall back to the
  // legacy color/strokeWidth + onColorChange/onStrokeWidthChange pair.
  color,
  strokeWidth,
  currentStyle,
  onColorChange,
  onStrokeWidthChange,
  onStyleChange,
  // navbar status: live zoom level + rendered shape array (wired by the
  // Whiteboard shell; both optional so standalone use keeps working).
  zoom = 1,
  shapes = [],
  onZoomChange,
  // canvas history / actions (right section)
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onClear,
  // 3-dot customization-panel toggle (optional)
  showPropertiesToggle = false,
  isPropertiesOpen = false,
  onToggleProperties,
}) {
  void locked;
  void onLockedChange;
  void hasSelection;
  void onDelete;

  const activeStroke = currentStyle?.stroke ?? color;
  const activeWidth = currentStyle?.strokeWidth ?? strokeWidth;
  const emitStyle = (patch) => {
    if (onStyleChange) {
      onStyleChange(patch);
      return;
    }
    if (patch.stroke !== undefined) onColorChange?.(patch.stroke);
    if (patch.strokeWidth !== undefined) onStrokeWidthChange?.(patch.strokeWidth);
  };
  const showStyles = Boolean(onStyleChange || onColorChange || onStrokeWidthChange);
  const showUndo = Boolean(onUndo);
  const showRedo = Boolean(onRedo);
  const showClear = Boolean(onClear);
  // Navbar status widgets: shape-count badge always reflects the rendered
  // array; zoom steppers delegate clamping to the shell's onZoomChange
  // (the canvas hook owns the [MIN_ZOOM, MAX_ZOOM] range).
  const shapeCount = Array.isArray(shapes) ? shapes.length : 0;
  const zoomPct = Math.round((Number.isFinite(zoom) ? zoom : 1) * 100);

  return (
    <div
      role="toolbar"
      aria-label="Whiteboard tools"
      aria-orientation="horizontal"
      className="pointer-events-auto mb-2 flex w-full select-none items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-1.5 shadow-sm"
    >
      {/* SECTION 1: DRAWING TOOLS (LEFT) */}
      <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto">
      {TOOLS.map((option) => {
        const isActive = tool === option.value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            aria-label={`${option.label} (${option.shortcut})`}
            aria-pressed={isActive}
            onClick={() => onToolChange(option.value)}
            className={`${BTN_BASE} shrink-0 ${isActive ? BTN_ACTIVE : BTN_IDLE}`}
          >
            <ToolIcon>{option.icon}</ToolIcon>
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute bottom-0.5 right-1 text-[9px] font-semibold leading-none ${
                isActive ? 'text-violet-500' : 'text-gray-400'
              }`}
            >
              {option.shortcut}
            </span>
          </button>
        );
      })}

      <span className="mx-1 h-6 w-px shrink-0 bg-gray-200" aria-hidden="true" />

      <button
        type="button"
        title={PAN_TOOL.title}
        aria-label={`${PAN_TOOL.label} (${PAN_TOOL.shortcut})`}
        aria-pressed={tool === 'pan'}
        onClick={() => onToolChange('pan')}
        className={`${BTN_BASE} shrink-0 ${tool === 'pan' ? BTN_ACTIVE : BTN_IDLE}`}
      >
        <ToolIcon>{PAN_TOOL.icon}</ToolIcon>
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute bottom-0.5 right-1 text-[9px] font-semibold leading-none ${
            tool === 'pan' ? 'text-violet-500' : 'text-gray-400'
          }`}
        >
          {PAN_TOOL.shortcut}
        </span>
      </button>
      </div>

      {showStyles && (
        <>
          <div className="mx-2 h-5 w-px shrink-0 bg-gray-200" aria-hidden="true" />

          {/* SECTION 2: QUICK STYLE PICKERS (CENTER) */}
          <div className="hidden min-w-0 flex-shrink items-center gap-2 sm:flex">
            {/* 5 quick color dots for the active stroke color */}
            <div className="flex items-center gap-1" role="group" aria-label="Quick stroke color">
              {QUICK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => emitStyle({ stroke: c })}
                  className={`h-4 w-4 shrink-0 rounded-full border transition hover:scale-110 ${
                    activeStroke === c ? 'ring-2 ring-indigo-500 ring-offset-1' : 'border-gray-300'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                  aria-label={`Stroke color ${c}`}
                  aria-pressed={activeStroke === c}
                />
              ))}
            </div>

            <div className="mx-1 h-4 w-px shrink-0 bg-gray-200" aria-hidden="true" />

            {/* Quick stroke-width toggle (S/M/L) */}
            <div className="flex items-center rounded-lg bg-gray-100 p-0.5" role="group" aria-label="Quick stroke width">
              {QUICK_WIDTHS.map((w) => (
                <button
                  key={w.label}
                  type="button"
                  onClick={() => emitStyle({ strokeWidth: w.width })}
                  className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                    activeWidth === w.width ? 'bg-white text-indigo-600 shadow-xs' : 'text-gray-500 hover:text-gray-900'
                  }`}
                  title={`Stroke width ${w.label} (${w.width}px)`}
                  aria-label={`Stroke width ${w.label}`}
                  aria-pressed={activeWidth === w.width}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="mx-2 h-5 w-px shrink-0 bg-gray-200" aria-hidden="true" />

      {/* SECTION 3: STATUS + ACTIONS & MORE MENU (RIGHT) */}
      <div className="flex shrink-0 items-center gap-1.5">
        {/* Shape count badge */}
        <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full whitespace-nowrap">
          {shapeCount} {shapeCount === 1 ? 'shape' : 'shapes'}
        </span>
        {/* Zoom controls */}
        {onZoomChange && (
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg px-1.5 py-0.5 text-xs text-gray-700">
            <button
              type="button"
              onClick={() => onZoomChange && onZoomChange(zoom - 0.1)}
              className="px-1 text-gray-600 hover:text-black font-bold"
              title="Zoom out"
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="min-w-[40px] text-center font-semibold">
              {zoomPct}%
            </span>
            <button
              type="button"
              onClick={() => onZoomChange && onZoomChange(zoom + 0.1)}
              className="px-1 text-gray-600 hover:text-black font-bold"
              title="Zoom in"
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
        )}
        {showUndo && (
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className="rounded p-1 text-gray-600 transition hover:bg-gray-100 disabled:opacity-40"
            title="Undo (Cmd/Ctrl+Z)"
            aria-label="Undo"
          >
            <ActionIcon>{UNDO_ICON}</ActionIcon>
          </button>
        )}
        {showRedo && (
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            className="rounded p-1 text-gray-600 transition hover:bg-gray-100 disabled:opacity-40"
            title="Redo (Cmd/Ctrl+Y)"
            aria-label="Redo"
          >
            <ActionIcon>{REDO_ICON}</ActionIcon>
          </button>
        )}
        {showClear && (
          <button
            type="button"
            onClick={onClear}
            className="rounded p-1 text-gray-600 transition hover:bg-red-50 hover:text-red-600"
            title="Clear Canvas"
            aria-label="Clear canvas"
          >
            <ActionIcon>{TRASH_ICON}</ActionIcon>
          </button>
        )}

        {(showUndo || showRedo || showClear) && showPropertiesToggle && (
          <div className="mx-1 h-4 w-px bg-gray-200" aria-hidden="true" />
        )}

        {/* 3-dot more menu */}
        {showPropertiesToggle && (
          <div className="relative">
            <button
              type="button"
              onClick={onToggleProperties}
              className={`rounded-lg p-1.5 transition ${
                isPropertiesOpen ? 'bg-indigo-50 text-indigo-600' : 'text-gray-700 hover:bg-gray-100'
              }`}
              title="All Properties"
              aria-label="Customize — more options"
              aria-expanded={isPropertiesOpen}
              aria-pressed={isPropertiesOpen}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="12" cy="19" r="1.8" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
