function ToolIcon({ children }) {
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

// Drawing tools + selection. Select/move is the default canvas
// interaction; the board also returns to select mode after each
// committed shape, but an explicit Select button lets users cancel
// a drawing tool without having to complete a shape first.
const DRAW_TOOLS = [
  {
    value: 'select',
    label: 'Select',
    title: 'Select / move (default)',
    icon: <path d="M4 3l7 18 2.5-7.5L21 11 4 3z" />,
  },
  {
    value: 'freehand',
    label: 'Pen',
    title: 'Freehand pen',
    icon: <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />,
  },
  {
    value: 'rectangle',
    label: 'Rectangle',
    title: 'Rectangle (drag any direction)',
    icon: <rect x="3" y="3" width="18" height="18" rx="2" />,
  },
  {
    value: 'circle',
    label: 'Circle',
    title: 'Circle (center + radius)',
    icon: <circle cx="12" cy="12" r="10" />,
  },
  {
    value: 'line',
    label: 'Line',
    title: 'Two-point line',
    icon: <line x1="5" y1="19" x2="19" y2="5" />,
  },
  {
    value: 'arrow',
    label: 'Arrow',
    title: 'Arrow',
    icon: (
      <>
        <line x1="7" y1="17" x2="17" y2="7" />
        <polyline points="7 7 17 7 17 17" />
      </>
    ),
  },
  {
    value: 'text',
    label: 'Text',
    title: 'Text (click to place, Enter to commit)',
    icon: (
      <>
        <polyline points="4 7 4 4 20 4 20 7" />
        <line x1="9" y1="20" x2="15" y2="20" />
        <line x1="12" y1="4" x2="12" y2="20" />
      </>
    ),
  },
];

const WIDTH_OPTIONS = [2, 4, 8, 12];

const TOOL_BTN =
  'flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1';
const TOOL_ACTIVE = 'bg-teal-600 text-white shadow-sm font-medium';
const TOOL_IDLE = 'text-slate-600 hover:bg-slate-100 hover:text-slate-900';

export default function Toolbar({
  tool,
  color,
  strokeWidth,
  hasSelection,
  onToolChange,
  onColorChange,
  onStrokeWidthChange,
  onDelete,
  onClear,
}) {
  return (
    <div
      role="toolbar"
      aria-label="Whiteboard tools"
      className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-2xl border border-slate-200/80 bg-white/90 px-3 py-2 shadow-lg backdrop-blur-md"
    >
      {/* Drawing tools */}
      <div className="flex items-center gap-0.5" role="group" aria-label="Drawing tools">
        {DRAW_TOOLS.map((option) => {
          const isActive = tool === option.value;
          return (
            <button
              key={option.value}
              type="button"
              title={option.title}
              aria-label={option.label}
              aria-pressed={isActive}
              onClick={() => onToolChange(option.value)}
              className={`${TOOL_BTN} ${isActive ? TOOL_ACTIVE : TOOL_IDLE}`}
            >
              <ToolIcon>{option.icon}</ToolIcon>
              <span className="hidden sm:inline">{option.label}</span>
            </button>
          );
        })}
      </div>

      <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden="true" />

      {/* Navigation: pan toggle */}
      <button
        type="button"
        title="Pan (drag canvas, wheel to zoom)"
        aria-label="Pan"
        aria-pressed={tool === 'pan'}
        onClick={() => onToolChange('pan')}
        className={`${TOOL_BTN} ${tool === 'pan' ? TOOL_ACTIVE : TOOL_IDLE}`}
      >
        <ToolIcon>
          <polyline points="5 9 2 12 5 15" />
          <polyline points="9 5 12 2 15 5" />
          <polyline points="15 19 12 22 9 19" />
          <polyline points="19 9 22 12 19 15" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <line x1="12" y1="2" x2="12" y2="22" />
        </ToolIcon>
        <span className="hidden sm:inline">Pan</span>
      </button>

      <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden="true" />

      {/* Styling */}
      <label
        title="Stroke color"
        className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-600 transition-all hover:bg-slate-100 hover:text-slate-900"
      >
        <input
          type="color"
          value={color}
          aria-label="Stroke color"
          onChange={(event) => onColorChange(event.target.value)}
          className="h-6 w-6 cursor-pointer rounded-full border border-slate-300 bg-transparent p-0"
        />
        <span className="hidden md:inline">Color</span>
      </label>

      <label
        title="Stroke width"
        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-600 transition-all hover:bg-slate-100 hover:text-slate-900"
      >
        <span className="hidden md:inline">Width</span>
        <select
          value={strokeWidth}
          aria-label="Stroke width"
          onChange={(event) => onStrokeWidthChange(Number(event.target.value))}
          className="cursor-pointer rounded-md bg-transparent text-sm font-medium focus:outline-none"
        >
          {WIDTH_OPTIONS.map((w) => (
            <option key={w} value={w}>
              {w}px
            </option>
          ))}
        </select>
      </label>

      <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden="true" />

      {/* Actions */}
      <button
        type="button"
        onClick={onDelete}
        disabled={!hasSelection}
        title={hasSelection ? 'Delete selected shape (Backspace/Delete)' : 'Select a shape to delete'}
        className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-600 transition-all hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ToolIcon>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </ToolIcon>
        Delete
      </button>

      <button
        type="button"
        onClick={onClear}
        title="Clear canvas"
        className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-600 transition-all hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-1"
      >
        Clear
      </button>
    </div>
  );
}
