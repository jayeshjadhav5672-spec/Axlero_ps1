import React, { useCallback, useMemo } from 'react';

/**
 * PropertyInspector — Day 2: Contextual Property Inspector Panel
 *
 * Right-side sliding drawer for the collaborative whiteboard workspace.
 * Clean white workspace background (#ffffff), subtle borders
 * (rgba(226, 232, 240, 0.8)) and soft drop shadows per the design tokens.
 * Slides in when a shape is selected, collapses when nothing is selected.
 *
 * Data flow (real-time):
 * - Reads selection from props (`shapes` + `selectedId` / `selectedIds`).
 *   The shell (App.jsx) owns the selection via <Whiteboard /> controlled
 *   `selectedShapeId` + `onSelectionChange`, so this panel never touches
 *   Konva / sockets directly.
 * - Every control calls `onShapeUpdate(id, changes)` (or
 *   `onShapesBatchUpdate` for multi-select) immediately. The shell's
 *   `useCollaborativeWhiteboard` applies the change locally AND broadcasts
 *   the mutation over the collaboration interface, so peers see it instantly.
 *
 * When mounted inside `WorkspaceLayout`'s `inspector` slot the outer
 * `<aside class="workspace-inspector">` already provides the slide
 * animation scoped to the canvas pane (never overlapping the top header
 * capsule or the code editor split pane). The inner card below supplies
 * the white-glassmorphism surface. When used standalone, the root div
 * also slides via `data-open` + inline transform so the spec's
 * "slide in smoothly / collapse when nothing selected" holds either way.
 */

export const FILL_SWATCHES = [
  { value: 'transparent', label: 'Transparent' },
  { value: '#ffffff', label: 'White' },
  { value: '#f8fafc', label: 'Slate 50' },
  { value: '#ffc9c9', label: 'Pastel red' },
  { value: '#b2f2bb', label: 'Pastel green' },
  { value: '#a5d8ff', label: 'Pastel blue' },
  { value: '#ffec99', label: 'Pastel yellow' },
  { value: '#e5dbff', label: 'Pastel purple' },
  { value: '#ffdfb5', label: 'Pastel orange' },
  { value: '#1e1e1e', label: 'Black' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#22c55e', label: 'Green' },
];

export const STROKE_SWATCHES = [
  { value: '#1e1e1e', label: 'Black' },
  { value: '#475569', label: 'Slate' },
  { value: '#e03131', label: 'Red' },
  { value: '#2f9e44', label: 'Green' },
  { value: '#1971c2', label: 'Blue' },
  { value: '#9c36b5', label: 'Purple' },
  { value: '#f08c00', label: 'Orange' },
  { value: '#ffffff', label: 'White' },
];

export const FONT_FAMILY_OPTIONS = [
  { value: 'hand', label: 'Hand-drawn', css: 'Virgil, cursive' },
  { value: 'normal', label: 'Normal', css: 'sans-serif' },
  { value: 'code', label: 'Code', css: 'monospace' },
  { value: 'serif', label: 'Serif', css: 'serif' },
];

const FONT_CSS_BY_KEY = Object.fromEntries(FONT_FAMILY_OPTIONS.map((f) => [f.value, f.css]));

function normalizeType(raw) {
  const t = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (t === 'rect') return 'rectangle';
  if (t === 'ellipse') return 'circle';
  if (t === 'pen' || t === 'draw' || t === 'freedraw') return 'freehand';
  if (t === 'rhombus') return 'diamond';
  return t;
}

function isHexColor(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

function SectionLabel({ children }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{children}</p>
  );
}

function Swatch({ colorValue, label, active, onPick }) {
  const isTransparent = colorValue === 'transparent';
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={() => onPick(colorValue)}
      className={`flex h-6 w-6 items-center justify-center rounded-md border transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
        active ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-300 hover:border-slate-400'
      } ${isTransparent ? 'bg-white' : ''}`}
      style={isTransparent ? undefined : { backgroundColor: colorValue }}
    >
      {isTransparent && (
        <span aria-hidden="true" className="block h-px w-5 rotate-45 bg-rose-400" />
      )}
    </button>
  );
}

function ColorField({ label, value, swatches, onChange }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
        {swatches.map((s) => (
          <Swatch
            key={`${label}-${s.value}`}
            colorValue={s.value}
            label={s.label}
            active={value === s.value}
            onPick={onChange}
          />
        ))}
        <label
          title={`Custom ${label.toLowerCase()}`}
          className="relative flex h-6 w-6 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed border-slate-300 text-slate-500 hover:border-slate-400"
        >
          <span aria-hidden="true" className="text-sm font-bold leading-none">+</span>
          <input
            type="color"
            value={isHexColor(value) ? value : '#1e1e1e'}
            aria-label={`Custom ${label.toLowerCase()}`}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-5 w-5 shrink-0 rounded border border-slate-300"
          style={{ backgroundColor: value === 'transparent' ? '#ffffff' : (value ?? '#ffffff') }}
        />
        <code className="truncate font-mono text-[11px] text-slate-500">
          {String(value ?? '—')}
        </code>
      </div>
    </div>
  );
}

function NumberField({ label, value, onCommit, min, max, step = 1, suffix = '' }) {
  const display = Number.isFinite(Number(value)) ? Number(value) : 0;
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-500">
        {label}{suffix ? ` (${suffix})` : ''}
      </span>
      <input
        type="number"
        value={Number.isFinite(display) ? Math.round(display * 100) / 100 : 0}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onCommit(n);
        }}
        className="h-8 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-xs tabular-nums text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}

function deriveDimensions(shape) {
  if (!shape) return { width: 0, height: 0 };
  const t = normalizeType(shape.type);
  if (t === 'rectangle' || t === 'diamond' || t === 'image' || t === 'frame') {
    return {
      width: Number(shape.width) || 0,
      height: Number(shape.height) || 0,
    };
  }
  if (t === 'circle') {
    const rx = Number(shape.radiusX ?? shape.radius) || 0;
    const ry = Number(shape.radiusY ?? shape.radius) || 0;
    return { width: rx * 2, height: ry * 2 };
  }
  if (t === 'text') {
    const w = Number(shape.width) || 0;
    const fs = Number(shape.fontSize) || 20;
    const lines = String(shape.text ?? '').split('\n').length || 1;
    return { width: w, height: Math.max(fs, lines * fs * 1.2) };
  }
  return { width: 0, height: 0 };
}

/**
 * Commit width/height edits back into per-type geometry:
 * - rectangle/diamond/image/frame: direct width/height
 * - circle: width/height -> radiusX/radiusY (+ legacy radius mean)
 * - text: width is the alignment-box width (height is derived, read-only)
 * - line/arrow/freehand: no box geometry — caller hides these fields
 */
function dimensionChangesFor(shape, next) {
  const t = normalizeType(shape?.type);
  const out = {};
  const w = next.width !== undefined ? Math.max(1, Number(next.width) || 1) : undefined;
  const h = next.height !== undefined ? Math.max(1, Number(next.height) || 1) : undefined;
  if (t === 'rectangle' || t === 'diamond' || t === 'image' || t === 'frame') {
    if (w !== undefined) out.width = w;
    if (h !== undefined) out.height = h;
    return out;
  }
  if (t === 'circle') {
    if (w !== undefined) {
      const rx = Math.max(1, w / 2);
      out.radiusX = rx;
      out.radius = rx;
    }
    if (h !== undefined) {
      const ry = Math.max(1, h / 2);
      out.radiusY = ry;
      if (w === undefined) out.radius = ry;
    }
    if (w !== undefined && h !== undefined) out.radius = Math.max(1, (w + h) / 4);
    return out;
  }
  if (t === 'text') {
    if (w !== undefined) out.width = Math.max(8, w);
    return out;
  }
  return out;
}

const TYPE_LABELS = {
  rectangle: 'Rectangle',
  rect: 'Rectangle',
  circle: 'Ellipse',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  text: 'Text',
  line: 'Line',
  arrow: 'Arrow',
  freehand: 'Pen',
  pen: 'Pen',
  image: 'Image',
  frame: 'Frame',
  group: 'Group',
};

export default function PropertyInspector({
  shapes = [],
  selectedId = null,
  selectedShapeId = null,
  selectedIds = null,
  onShapeUpdate = () => {},
  onShapesBatchUpdate = null,
  onShapeDelete = null,
  onClose = null,
  onDeselect = null,
  /** Bare mode: render controls only (no card/header/slide) for embedding
   * inside WorkspaceLayout's inspector drawer, which already provides the
   * sliding glass chrome + "Properties" header scoped to the canvas pane. */
  bare = false,
  'data-testid': testId = 'property-inspector',
} = {}) {
  const primaryId = selectedId ?? selectedShapeId ?? null;
  const idList = useMemo(() => {
    if (Array.isArray(selectedIds) && selectedIds.length > 0) {
      return [...new Set(selectedIds.filter(Boolean))];
    }
    return primaryId ? [primaryId] : [];
  }, [selectedIds, primaryId]);

  const selectedShapes = useMemo(() => {
    const byId = new Map((shapes ?? []).map((s) => [s?.id, s]));
    return idList.map((id) => byId.get(id)).filter(Boolean);
  }, [shapes, idList]);

  const open = selectedShapes.length > 0;
  const multi = selectedShapes.length > 1;
  const shape = multi ? null : (selectedShapes[0] ?? null);
  const shapeType = shape ? normalizeType(shape.type) : null;

  const handleClose = useCallback(() => {
    if (typeof onClose === 'function') onClose();
    else if (typeof onDeselect === 'function') onDeselect();
    else if (typeof onShapeUpdate === 'function') {
      // No-op fallback: parent owns deselection; nothing to commit.
    }
  }, [onClose, onDeselect, onShapeUpdate]);

  const updateOne = useCallback(
    (id, changes) => {
      if (!id || !changes || Object.keys(changes).length === 0) return;
      onShapeUpdate(id, changes);
    },
    [onShapeUpdate],
  );

  const updateAll = useCallback(
    (changes) => {
      if (!changes || Object.keys(changes).length === 0) return;
      if (typeof onShapesBatchUpdate === 'function' && selectedShapes.length > 1) {
        onShapesBatchUpdate(selectedShapes.map((s) => ({ id: s.id, changes: { ...changes } })));
      } else {
        for (const s of selectedShapes) onShapeUpdate(s.id, { ...changes });
      }
    },
    [onShapesBatchUpdate, onShapeUpdate, selectedShapes],
  );

  const dims = useMemo(() => (shape ? deriveDimensions(shape) : { width: 0, height: 0 }), [shape]);
  const showFill = shape ? ['rectangle', 'circle', 'diamond', 'text'].includes(shapeType) : false;
  // Lines carry no fill box; arrows use stroke-driven fill — keep the panel
  // focused on stroke for open paths.
  const showDimensions = shape
    ? ['rectangle', 'circle', 'diamond', 'text', 'image', 'frame'].includes(shapeType)
    : false;
  const isText = shapeType === 'text';

  const body = (
    <>
        {selectedShapes.length === 0 ? (
          <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 text-center">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="text-slate-300"
            >
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M3 9h18" />
              <circle cx="6.5" cy="6" r="0.6" fill="currentColor" />
            </svg>
            <p className="text-xs text-slate-400">Select an element to edit properties</p>
            <p className="max-w-[220px] text-[11px] leading-relaxed text-slate-400">
              Click a rectangle, ellipse, line, or text block on the canvas to inspect it here.
            </p>
          </div>
        ) : multi ? (
          <div className="flex flex-col gap-4 text-xs" aria-live="polite">
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 leading-relaxed text-slate-600">
              {selectedShapes.length} elements selected. Shared style edits apply to every
              selected shape at once.
            </p>
            <ColorField
              label="Fill"
              value={selectedShapes[0]?.fill ?? 'transparent'}
              swatches={FILL_SWATCHES}
              onChange={(v) => updateAll({ fill: v })}
            />
            <ColorField
              label="Stroke"
              value={selectedShapes[0]?.stroke ?? '#1e1e1e'}
              swatches={STROKE_SWATCHES}
              onChange={(v) => updateAll({ stroke: v })}
            />
            <div>
              <div className="flex items-center justify-between">
                <SectionLabel>Stroke width</SectionLabel>
                <span className="text-[11px] tabular-nums text-slate-500">
                  {selectedShapes[0]?.strokeWidth ?? 4}px
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={20}
                step={1}
                value={Math.min(20, Math.max(1, Number(selectedShapes[0]?.strokeWidth) || 4))}
                aria-label="Stroke width"
                onChange={(e) => updateAll({ strokeWidth: Number(e.target.value) })}
                className="mt-1.5 w-full accent-blue-600"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <SectionLabel>Opacity</SectionLabel>
                <span className="text-[11px] tabular-nums text-slate-500">
                  {Math.round((Number(selectedShapes[0]?.opacity ?? 1)) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round((Number(selectedShapes[0]?.opacity ?? 1)) * 100)}
                aria-label="Opacity"
                onChange={(e) => updateAll({ opacity: Number(e.target.value) / 100 })}
                className="mt-1.5 w-full accent-blue-600"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 text-xs">
            {/* ---- Fill ---- */}
            {showFill && (
              <ColorField
                label={isText ? 'Text color' : 'Fill'}
                value={shape.fill ?? (isText ? '#1e1e1e' : 'transparent')}
                swatches={FILL_SWATCHES}
                onChange={(v) => {
                  if (isText) updateOne(shape.id, { fill: v });
                  else updateOne(shape.id, { fill: v });
                }}
              />
            )}

            {/* ---- Stroke ---- */}
            {!isText && (
              <ColorField
                label="Stroke"
                value={shape.stroke ?? '#1e1e1e'}
                swatches={STROKE_SWATCHES}
                onChange={(v) => {
                  const changes = { stroke: v };
                  if (shapeType === 'arrow') changes.fill = v;
                  updateOne(shape.id, changes);
                }}
              />
            )}

            {/* ---- Stroke width: 1px–20px range slider ---- */}
            {shapeType !== 'text' && shapeType !== 'image' && (
              <div>
                <div className="flex items-center justify-between">
                  <SectionLabel>Stroke width</SectionLabel>
                  <span className="text-[11px] tabular-nums text-slate-500">
                    {shape.strokeWidth ?? 4}px
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={Math.min(20, Math.max(1, Number(shape.strokeWidth) || 4))}
                  aria-label="Stroke width"
                  onChange={(e) => updateOne(shape.id, { strokeWidth: Number(e.target.value) })}
                  className="mt-1.5 w-full accent-blue-600"
                />
                <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-400">
                  <span>1px</span>
                  <span>20px</span>
                </div>
              </div>
            )}

            {/* ---- Typography (text only) ---- */}
            {isText && (
              <>
                <div>
                  <SectionLabel>Font family</SectionLabel>
                  <select
                    value={shape.fontFamilyKey ?? 'hand'}
                    aria-label="Font family"
                    onChange={(e) => {
                      const key = e.target.value;
                      updateOne(shape.id, {
                        fontFamilyKey: key,
                        fontFamily: FONT_CSS_BY_KEY[key] ?? FONT_CSS_BY_KEY.hand,
                      });
                    }}
                    className="mt-1.5 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    {FONT_FAMILY_OPTIONS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <SectionLabel>Font size</SectionLabel>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      type="number"
                      min={8}
                      max={200}
                      step={1}
                      value={Number(shape.fontSize) || 20}
                      aria-label="Font size"
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n)) {
                          updateOne(shape.id, { fontSize: Math.min(200, Math.max(8, n)) });
                        }
                      }}
                      className="h-8 w-20 rounded-md border border-slate-200 bg-white px-2 text-xs tabular-nums text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                    <span className="text-[11px] text-slate-400">px</span>
                    <input
                      type="range"
                      min={8}
                      max={96}
                      step={1}
                      value={Math.min(96, Math.max(8, Number(shape.fontSize) || 20))}
                      aria-label="Font size slider"
                      onChange={(e) => updateOne(shape.id, { fontSize: Number(e.target.value) })}
                      className="min-w-0 flex-1 accent-blue-600"
                    />
                  </div>
                </div>
                <div>
                  <SectionLabel>Text align</SectionLabel>
                  <div className="mt-1.5 flex items-center gap-1" role="group" aria-label="Text alignment">
                    {[
                      { value: 'left', label: 'Align left' },
                      { value: 'center', label: 'Align center' },
                      { value: 'right', label: 'Align right' },
                    ].map((a) => {
                      const active = (shape.textAlign ?? shape.align ?? 'left') === a.value;
                      return (
                        <button
                          key={a.value}
                          type="button"
                          title={a.label}
                          aria-label={a.label}
                          aria-pressed={active}
                          onClick={() => updateOne(shape.id, { textAlign: a.value, align: a.value })}
                          className={`flex h-8 flex-1 items-center justify-center rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                            active
                              ? 'border-blue-200 bg-blue-100 text-blue-700'
                              : 'border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            aria-hidden="true"
                          >
                            {a.value === 'left' && (
                              <>
                                <line x1="4" y1="6" x2="20" y2="6" />
                                <line x1="4" y1="12" x2="14" y2="12" />
                                <line x1="4" y1="18" x2="17" y2="18" />
                              </>
                            )}
                            {a.value === 'center' && (
                              <>
                                <line x1="4" y1="6" x2="20" y2="6" />
                                <line x1="7" y1="12" x2="17" y2="12" />
                                <line x1="5.5" y1="18" x2="18.5" y2="18" />
                              </>
                            )}
                            {a.value === 'right' && (
                              <>
                                <line x1="4" y1="6" x2="20" y2="6" />
                                <line x1="10" y1="12" x2="20" y2="12" />
                                <line x1="7" y1="18" x2="20" y2="18" />
                              </>
                            )}
                          </svg>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* ---- Transform / dimensions ---- */}
            <div>
              <SectionLabel>Position</SectionLabel>
              <div className="mt-1.5 flex gap-2">
                <NumberField
                  label="X"
                  value={shape.x ?? 0}
                  onCommit={(n) => updateOne(shape.id, { x: n })}
                />
                <NumberField
                  label="Y"
                  value={shape.y ?? 0}
                  onCommit={(n) => updateOne(shape.id, { y: n })}
                />
              </div>
            </div>

            {showDimensions && (
              <div>
                <SectionLabel>Size</SectionLabel>
                <div className="mt-1.5 flex gap-2">
                  <NumberField
                    label="W"
                    value={dims.width}
                    onCommit={(n) =>
                      updateOne(shape.id, dimensionChangesFor(shape, { width: n }))
                    }
                    min={1}
                  />
                  <NumberField
                    label="H"
                    value={isText ? dims.height : dims.height}
                    onCommit={(n) => {
                      if (isText) return;
                      updateOne(shape.id, dimensionChangesFor(shape, { height: n }));
                    }}
                    min={1}
                  />
                </div>
                {isText && (
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    Height follows font size × lines.
                  </p>
                )}
              </div>
            )}

            <div>
              <SectionLabel>Rotation</SectionLabel>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={Number(shape.rotation) || 0}
                  aria-label="Rotation"
                  onChange={(e) => updateOne(shape.id, { rotation: Number(e.target.value) })}
                  className="min-w-0 flex-1 accent-blue-600"
                />
                <input
                  type="number"
                  min={-180}
                  max={180}
                  step={1}
                  value={Math.round((Number(shape.rotation) || 0) * 100) / 100}
                  aria-label="Rotation angle"
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) updateOne(shape.id, { rotation: n });
                  }}
                  className="h-8 w-16 shrink-0 rounded-md border border-slate-200 bg-white px-2 text-xs tabular-nums text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                <span className="text-[11px] text-slate-400">°</span>
              </div>
            </div>

            {/* ---- Opacity ---- */}
            <div>
              <div className="flex items-center justify-between">
                <SectionLabel>Opacity</SectionLabel>
                <span className="text-[11px] tabular-nums text-slate-500">
                  {Math.round((Number(shape.opacity ?? 1)) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round((Number(shape.opacity ?? 1)) * 100)}
                aria-label="Opacity"
                onChange={(e) => updateOne(shape.id, { opacity: Number(e.target.value) / 100 })}
                className="mt-1.5 w-full accent-blue-600"
              />
            </div>

            {typeof onShapeDelete === 'function' && (
              <button
                type="button"
                onClick={() => onShapeDelete(shape.id)}
                className="mt-1 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-rose-200 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
              >
                Delete shape
              </button>
            )}
          </div>
        )}
    </>
  );

  if (bare) {
    return (
      <div data-testid={testId} data-open={open} role="complementary" aria-label="Property inspector">
        {shape && !multi && (
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
              {TYPE_LABELS[shape.type] ?? TYPE_LABELS[shapeType] ?? 'Shape'}
            </span>
          </div>
        )}
        {body}
      </div>
    );
  }

  return (
    <div
      data-testid={testId}
      data-open={open}
      role="complementary"
      aria-label="Property inspector"
      aria-hidden={!open}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden"
      style={{
        background: '#ffffff',
        border: '1px solid rgba(226, 232, 240, 0.8)',
        borderRadius: 16,
        boxShadow:
          '0 10px 25px -5px rgba(0, 0, 0, 0.10), 0 8px 10px -6px rgba(0, 0, 0, 0.08), 0 4px 6px -1px rgba(0, 0, 0, 0.05)',
        transform: open ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
        opacity: open ? 1 : 0,
        pointerEvents: open ? 'auto' : 'none',
        transition:
          'transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 280ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div
        className="flex shrink-0 items-center justify-between border-b px-4 py-2.5"
        style={{ borderColor: 'rgba(226, 232, 240, 0.8)' }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Properties
          </span>
          {shape && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
              {TYPE_LABELS[shape.type] ?? TYPE_LABELS[shapeType] ?? 'Shape'}
            </span>
          )}
          {multi && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
              {selectedShapes.length} selected
            </span>
          )}
        </span>
        {(onClose || onDeselect) && (
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close properties panel"
            className="rounded-full px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            ✕
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {body}
      </div>
    </div>
  );
}

export { normalizeType };
