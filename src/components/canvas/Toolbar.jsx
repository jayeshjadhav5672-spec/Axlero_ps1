const TOOL_OPTIONS = [
  { value: 'pen', label: 'Pen' },
  { value: 'rectangle', label: 'Rectangle' },
];

export default function Toolbar({ tool, color, onToolChange, onColorChange, onClear }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-teal-100 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Drawing tool">
        {TOOL_OPTIONS.map((option) => {
          const isActive = tool === option.value;

          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onToolChange(option.value)}
              className={`min-h-11 cursor-pointer rounded-md px-4 py-2 text-sm font-semibold transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-2 ${
                isActive
                  ? 'bg-teal-700 text-white shadow-sm'
                  : 'text-slate-700 hover:bg-white hover:text-teal-800'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors duration-200 hover:border-teal-300 hover:text-teal-800 focus-within:ring-2 focus-within:ring-teal-600 focus-within:ring-offset-2">
        <span>Color</span>
        <input
          type="color"
          value={color}
          aria-label="Stroke color"
          onChange={(event) => onColorChange(event.target.value)}
          className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
        />
      </label>

      <button
        type="button"
        onClick={onClear}
        className="min-h-11 cursor-pointer rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition-colors duration-200 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
      >
        Clear
      </button>
    </div>
  );
}

