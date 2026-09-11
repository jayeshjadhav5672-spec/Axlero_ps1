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

const BTN_BASE =
  'relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border text-[15px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-1';
const BTN_ACTIVE = 'bg-violet-100 text-violet-700 border-violet-200 shadow-[inset_0_0_0_1px_rgba(109,88,246,0.15)]';
const BTN_IDLE = 'border-transparent text-gray-700 hover:bg-gray-100 hover:text-gray-900';

/**
 * Toolbar — Excalidraw-style floating island (top-center).
 * Tool buttons only (Selection, Rectangle, Diamond, Ellipse, Arrow, Line,
 * Pen, Text, Eraser, Pan). Back-compat: still accepts the legacy props
 * (locked, onLockedChange, color, strokeWidth, hasSelection, onColorChange,
 * onStrokeWidthChange, onDelete, onClear) and ignores them — styling moved
 * to the left property sidebar, actions to the sidebar + bottom bar.
 */
export default function Toolbar({
  tool,
  onToolChange,
  locked,
  onLockedChange,
  // legacy (ignored, kept for integration compat)
  color,
  strokeWidth,
  hasSelection,
  onColorChange,
  onStrokeWidthChange,
  onDelete,
  onClear,
}) {
  void locked;
  void onLockedChange;
  void color;
  void strokeWidth;
  void hasSelection;
  void onColorChange;
  void onStrokeWidthChange;
  void onDelete;
  void onClear;

  return (
    <div
      role="toolbar"
      aria-label="Whiteboard tools"
      className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
    >
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
            className={`${BTN_BASE} ${isActive ? BTN_ACTIVE : BTN_IDLE}`}
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

      <span className="mx-1 h-6 w-px bg-gray-200" aria-hidden="true" />

      <button
        type="button"
        title={PAN_TOOL.title}
        aria-label={`${PAN_TOOL.label} (${PAN_TOOL.shortcut})`}
        aria-pressed={tool === 'pan'}
        onClick={() => onToolChange('pan')}
        className={`${BTN_BASE} ${tool === 'pan' ? BTN_ACTIVE : BTN_IDLE}`}
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
  );
}
