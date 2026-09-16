import React, { useCallback, useEffect, useRef, useState } from 'react';

function ToolIcon({ children }) {
  return (
    <svg
      width="22"
      height="22"
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
    value: 'frame',
    label: 'Frame',
    shortcut: 'F',
    title: 'Frame (F — drag to create a slide container; moving it carries children)',
    icon: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="2" strokeDasharray="4 3" />
        <line x1="3" y1="9" x2="21" y2="9" strokeDasharray="4 3" />
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

function ActionIcon({ children }) {
  return (
    <svg
      width="20"
      height="20"
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

// Week-2 productivity icons (same 24px stroke style as the tool island).
const IMAGE_ICON = (
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </>
);

const WAND_ICON = (
  <>
    <path d="M15 4V2m0 20v-2m5-13 1.5-1.5M9.5 9.5 8 8m11 11-1.5-1.5M4.5 19.5 6 18" />
    <path d="m14 6 2.5 2.5L8 17H5.5v-2.5L14 6z" />
  </>
);

const MERMAID_ICON = (
  <>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
    <path d="M10 6.5h4a2 2 0 0 1 2 2V14" />
    <polyline points="12.5 12 14.5 14 12.5 16" />
  </>
);

const DOWNLOAD_ICON = (
  <>
    <path d="M12 3v12" />
    <polyline points="7 10 12 15 17 10" />
    <path d="M4 21h16" />
  </>
);

const EXPORT_OPTIONS = [
  { value: 'json', label: 'JSON (.json)' },
  { value: 'png', label: 'PNG (.png)' },
  { value: 'jpeg', label: 'JPEG (.jpg)' },
  { value: 'avif', label: 'AVIF (.avif)' },
  { value: 'svg', label: 'SVG (.svg)' },
  { value: 'pdf', label: 'PDF (.pdf)' },
];
const BTN_BASE =
  'relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border text-[15px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-1';
const BTN_ACTIVE = 'bg-violet-100 text-violet-700 border-violet-200 shadow-[inset_0_0_0_1px_rgba(109,88,246,0.15)]';
const BTN_IDLE = 'border-transparent text-gray-700 hover:bg-gray-100 hover:text-gray-900';

/**
 * Toolbar — full-width 2-section header bar docked at the top of the
 * whiteboard: drawing tools (left), canvas status (shape count + zoom
 * steppers) with history/actions + 3-dot customization toggle (right).
 * Stroke/fill color controls live exclusively in the PropertySidebar
 * customization panel — this bar carries no color swatches by design.
 * Back-compat: still accepts the legacy props (locked, onLockedChange,
 * hasSelection, onDelete, color, strokeWidth, currentStyle, onColorChange,
 * onStrokeWidthChange, onStyleChange) and ignores them. Status/action
 * props are all optional — each section degrades gracefully when its
 * handlers are absent.
 */
export default function Toolbar({
  tool,
  onToolChange,
  locked,
  onLockedChange,
  // legacy (ignored, kept for integration compat — color controls live
  // exclusively in the PropertySidebar customization panel)
  hasSelection,
  onDelete,
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
  // Week-2 productivity toolset (all optional; sections hide when absent)
  onInsertImage,
  autoDetect = false,
  onToggleAutoDetect,
  onOpenMermaid,
  onExport,
}) {
  void locked;
  void onLockedChange;
  void hasSelection;
  void onDelete;
  void color;
  void strokeWidth;
  void currentStyle;
  void onColorChange;
  void onStrokeWidthChange;
  void onStyleChange;

  const showUndo = Boolean(onUndo);
  const showRedo = Boolean(onRedo);
  const showClear = Boolean(onClear);
  const showImage = Boolean(onInsertImage);
  const showDetect = Boolean(onToggleAutoDetect);
  const showMermaid = Boolean(onOpenMermaid);
  const showExport = Boolean(onExport);
  const showProductivity = showImage || showDetect || showMermaid || showExport;
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);
  const exportBtnRef = useRef(null);
  const exportMenuRef = useRef(null);
  // Fixed-position menu anchor (viewport coords measured from the toggle
  // button when the menu opens). The menu renders with `position: fixed`
  // so it escapes the tool strip's `overflow-x-auto` clipping — an
  // `absolute` child here would be cut off at the 52px bar (overflow-y
  // computes to auto) and its items would never receive clicks.
  const [exportMenuPos, setExportMenuPos] = useState({ top: 0, left: 0 });
  const openExportMenu = useCallback(() => {
    const rect = exportBtnRef.current?.getBoundingClientRect?.();
    if (rect) setExportMenuPos({ top: rect.bottom + 8, left: Math.max(8, rect.left) });
    setExportOpen(true);
  }, []);
  useEffect(() => {
    if (!exportOpen) return undefined;
    const onPointerDown = (e) => {
      const insideBtn = exportRef.current?.contains(e.target);
      const insideMenu = exportMenuRef.current?.contains(e.target);
      if (!insideBtn && !insideMenu) setExportOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setExportOpen(false);
    };
    // The menu is viewport-anchored (position: fixed): dismiss it on
    // scroll/resize so it never floats detached from its toggle button.
    const onViewportShift = () => setExportOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onViewportShift, true);
    window.addEventListener('resize', onViewportShift);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onViewportShift, true);
      window.removeEventListener('resize', onViewportShift);
    };
  }, [exportOpen]);
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
      className="pointer-events-auto mb-2 flex min-h-[52px] w-full select-none items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm"
    >
      {/* SECTION 1: DRAWING TOOLS (LEFT) */}
      <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto">
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
              className={`pointer-events-none absolute bottom-0.5 right-1 text-[11px] font-semibold leading-none ${
                isActive ? 'text-violet-500' : 'text-gray-400'
              }`}
            >
              {option.shortcut}
            </span>
          </button>
        );
      })}

      <span className="mx-1 h-7 w-px shrink-0 bg-gray-200" aria-hidden="true" />

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
          className={`pointer-events-none absolute bottom-0.5 right-1 text-[11px] font-semibold leading-none ${
            tool === 'pan' ? 'text-violet-500' : 'text-gray-400'
          }`}
        >
          {PAN_TOOL.shortcut}
        </span>
      </button>

      {showProductivity && (
        <>
          <span className="mx-1 h-7 w-px shrink-0 bg-gray-200" aria-hidden="true" />
          {showImage && (
            <button
              type="button"
              title="Insert image (file picker, drag & drop, or Ctrl/⌘+V paste)"
              aria-label="Insert image"
              onClick={onInsertImage}
              className={`${BTN_BASE} shrink-0 ${BTN_IDLE}`}
            >
              <ToolIcon>{IMAGE_ICON}</ToolIcon>
            </button>
          )}
          {showDetect && (
            <button
              type="button"
              title={
                tool === 'pen' || tool === 'freehand'
                  ? 'Auto-detect shapes: convert rough pen strokes to circles, rectangles, lines'
                  : 'Auto-detect shapes (pen only — clicking switches to the Pen tool)'
              }
              aria-label="Auto-detect shapes"
              aria-pressed={autoDetect}
              onClick={() => {
                // Auto-detect is locked to the Pen tool: engaging it from
                // any other tool first switches to Pen, so recognition
                // never runs under rectangle/select/etc.
                if (tool !== 'pen' && tool !== 'freehand') onToolChange?.('freehand');
                onToggleAutoDetect?.();
              }}
              className={`${BTN_BASE} shrink-0 ${autoDetect ? BTN_ACTIVE : BTN_IDLE}`}
            >
              <ToolIcon>{WAND_ICON}</ToolIcon>
            </button>
          )}
          {showMermaid && (
            <button
              type="button"
              title="Mermaid diagram: compile flowchart syntax to shapes"
              aria-label="Mermaid diagram"
              onClick={onOpenMermaid}
              className={`${BTN_BASE} shrink-0 ${BTN_IDLE}`}
            >
              <ToolIcon>{MERMAID_ICON}</ToolIcon>
            </button>
          )}
          {showExport && (
            <div className="relative shrink-0" ref={exportRef}>
              <button
                ref={exportBtnRef}
                type="button"
                data-testid="export-button"
                title="Export canvas (JSON, PNG, JPEG, AVIF, SVG, PDF)"
                aria-label="Export canvas"
                aria-expanded={exportOpen}
                aria-haspopup="menu"
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('[Export UI] Export toggle clicked, open:', !exportOpen);
                  if (exportOpen) setExportOpen(false);
                  else openExportMenu();
                }}
                className={`pointer-events-auto relative ${BTN_BASE} ${exportOpen ? BTN_ACTIVE : BTN_IDLE}`}
              >
                <ToolIcon>{DOWNLOAD_ICON}</ToolIcon>
              </button>
              {exportOpen && (
                <div
                  ref={exportMenuRef}
                  role="menu"
                  aria-label="Export formats"
                  data-testid="export-menu"
                  className="pointer-events-auto fixed z-[100] w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
                  style={{ top: exportMenuPos.top, left: exportMenuPos.left }}
                >
                  {EXPORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="menuitem"
                      data-testid={`export-format-${opt.value}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('[Export UI] Button clicked successfully:', opt.value);
                        setExportOpen(false);
                        onExport(opt.value);
                      }}
                      className="pointer-events-auto block w-full cursor-pointer px-4 py-2 text-left text-sm text-gray-700 hover:bg-violet-50 hover:text-violet-700"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
      </div>

      <div className="mx-2 h-7 w-px shrink-0 bg-gray-200" aria-hidden="true" />

      {/* SECTION 2: STATUS + ACTIONS & MORE MENU (RIGHT) */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Shape count badge */}
        <span className="text-sm font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full whitespace-nowrap">
          {shapeCount} {shapeCount === 1 ? 'shape' : 'shapes'}
        </span>
        {/* Zoom controls */}
        {onZoomChange && (
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg px-2 py-1 text-sm text-gray-700">
            <button
              type="button"
              onClick={() => onZoomChange && onZoomChange(zoom - 0.1)}
              className="px-2 py-0.5 text-gray-600 hover:text-black font-bold"
              title="Zoom out"
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="min-w-[48px] text-center font-semibold">
              {zoomPct}%
            </span>
            <button
              type="button"
              onClick={() => onZoomChange && onZoomChange(zoom + 0.1)}
              className="px-2 py-0.5 text-gray-600 hover:text-black font-bold"
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
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 transition hover:bg-gray-100 disabled:opacity-40"
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
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 transition hover:bg-gray-100 disabled:opacity-40"
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
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 transition hover:bg-red-50 hover:text-red-600"
            title="Clear Canvas"
            aria-label="Clear canvas"
          >
            <ActionIcon>{TRASH_ICON}</ActionIcon>
          </button>
        )}

        {(showUndo || showRedo || showClear) && showPropertiesToggle && (
          <div className="mx-1 h-6 w-px bg-gray-200" aria-hidden="true" />
        )}

        {/* 3-dot more menu */}
        {showPropertiesToggle && (
          <div className="relative">
            <button
              type="button"
              onClick={onToggleProperties}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
                isPropertiesOpen ? 'bg-indigo-50 text-indigo-600' : 'text-gray-700 hover:bg-gray-100'
              }`}
              title="All Properties"
              aria-label="Customize — more options"
              aria-expanded={isPropertiesOpen}
              aria-pressed={isPropertiesOpen}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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
