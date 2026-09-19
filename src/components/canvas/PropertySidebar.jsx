import React from 'react';
import {
  ARROWHEAD_CHOICES,
  ARROW_TYPE_CHOICES,
  FONT_FAMILY_CHOICES,
  FONT_SIZE_CHOICES,
  ROUGHNESS_CHOICES,
  ROUNDNESS_CHOICES,
  TEXT_ALIGN_CHOICES,
  getShapeBounds,
} from './utils/shapes.js';

export const STROKE_SWATCHES = [
  { value: '#1e1e1e', label: 'Black' },
  { value: '#e03131', label: 'Red' },
  { value: '#2f9e44', label: 'Green' },
  { value: '#1971c2', label: 'Blue' },
  { value: '#9c36b5', label: 'Purple' },
  { value: '#f08c00', label: 'Orange' },
];

/** Arrow inspector palette (reference design): 5 swatches + custom picker. */
export const ARROW_STROKE_SWATCHES = [
  { value: '#1e1e1e', label: 'Black' },
  { value: '#e03131', label: 'Red' },
  { value: '#2f9e44', label: 'Green' },
  { value: '#1971c2', label: 'Blue' },
  { value: '#f08c00', label: 'Orange' },
];

/** Text inspector palette: 5 swatches + dark gray + custom picker. */
export const TEXT_STROKE_SWATCHES = [
  { value: '#1e1e1e', label: 'Black' },
  { value: '#e03131', label: 'Red' },
  { value: '#2f9e44', label: 'Green' },
  { value: '#1971c2', label: 'Blue' },
  { value: '#f08c00', label: 'Orange' },
  { value: '#343a40', label: 'Dark gray' },
];

export const FILL_SWATCHES = [
  { value: 'transparent', label: 'Transparent' },
  { value: '#ffffff', label: 'White' },
  { value: '#ffc9c9', label: 'Pastel red' },
  { value: '#b2f2bb', label: 'Pastel green' },
  { value: '#a5d8ff', label: 'Pastel blue' },
  { value: '#ffec99', label: 'Pastel yellow' },
  { value: '#e5dbff', label: 'Pastel purple' },
  { value: '#ffdfb5', label: 'Pastel orange' },
];

const WIDTH_CHOICES = [
  { value: 1.5, label: 'Thin' },
  { value: 2.5, label: 'Medium' },
  { value: 4, label: 'Thick' },
];

/** Arrow stroke widths (reference design): Thin 1px, Medium 2px, Bold 4px. */
const ARROW_WIDTH_CHOICES = [
  { value: 1, label: 'Thin' },
  { value: 2, label: 'Medium' },
  { value: 4, label: 'Bold' },
];

const STYLE_CHOICES = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
];

function SectionLabel({ children }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{children}</p>
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
      className={`flex h-6 w-6 items-center justify-center rounded-md border transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
        active ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-300 hover:border-gray-400'
      } ${isTransparent ? 'bg-white' : ''}`}
      style={isTransparent ? undefined : { backgroundColor: colorValue }}
    >
      {isTransparent && (
        <span aria-hidden="true" className="block h-px w-5 rotate-45 bg-rose-400" />
      )}
    </button>
  );
}

function ChoiceRow({ ariaLabel, children }) {
  return (
    <div className="mt-1.5 flex items-center gap-1" role="group" aria-label={ariaLabel}>
      {children}
    </div>
  );
}

function choiceClass(active) {
  return `flex h-8 flex-1 items-center justify-center rounded-md border px-1 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
    active
      ? 'border-violet-200 bg-violet-100 text-violet-700'
      : 'border-gray-200 text-gray-600 hover:bg-gray-100'
  }`;
}

/** Compact Excalidraw-style square icon button (layers / sloppiness / edges). */
function IconBtn({ title, label, active, disabled, onClick, children, stretch }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`${stretch ? 'flex-1' : 'w-9'} flex h-9 items-center justify-center rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-violet-300 bg-violet-100 text-violet-700'
          : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
      }`}
    >
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
    </button>
  );
}

function StrokeSection({ color, onColorChange, swatches = STROKE_SWATCHES, label = 'Stroke' }) {
  return (
    <div>
      <SectionLabel>{label === 'Stroke color' ? 'Stroke Color' : label}</SectionLabel>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Stroke color">
        {swatches.map((s) => (
          <Swatch
            key={s.value}
            colorValue={s.value}
            label={s.label}
            active={color === s.value}
            onPick={onColorChange}
          />
        ))}
        <label
          title="Custom stroke color"
          className="relative flex h-6 w-6 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed border-gray-300 text-gray-500 hover:border-gray-400"
        >
          <span aria-hidden="true" className="text-sm font-bold leading-none">+</span>
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#1e1e1e'}
            aria-label="Custom stroke color"
            onChange={(e) => onColorChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  );
}

function BackgroundSection({ fill, onFillChange }) {
  return (
    <div>
      <SectionLabel>Background</SectionLabel>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Fill color">
        {FILL_SWATCHES.map((s) => (
          <Swatch
            key={s.value}
            colorValue={s.value}
            label={s.label}
            active={fill === s.value}
            onPick={onFillChange}
          />
        ))}
        <label
          title="Custom background color"
          className="relative flex h-6 w-6 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-gray-300 hover:border-gray-400"
        >
          <span aria-hidden="true" className="text-xs font-bold text-gray-500">+</span>
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(fill ?? '') ? fill : '#ffffff'}
            aria-label="Custom background color"
            onChange={(e) => onFillChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  );
}

function StrokeWidthSection({ strokeWidth, onStrokeWidthChange, choices = WIDTH_CHOICES }) {
  return (
    <div>
      <SectionLabel>Stroke width</SectionLabel>
      <ChoiceRow ariaLabel="Stroke width">
        {choices.map((w) => {
          const active = strokeWidth === w.value;
          return (
            <button
              key={w.value}
              type="button"
              title={`${w.label} (${w.value}px)`}
              aria-label={`${w.label} stroke width`}
              aria-pressed={active}
              onClick={() => onStrokeWidthChange(w.value)}
              className={`flex h-8 flex-1 flex-col items-center justify-center gap-1 rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                active
                  ? 'border-violet-200 bg-violet-100 text-violet-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span
                aria-hidden="true"
                className="block w-8 rounded-full bg-current"
                style={{ height: w.value <= 1 ? 1.5 : w.value <= 2 ? 2.5 : w.value <= 4 ? 4 : 6 }}
              />
              <span className="text-[10px] leading-none">{w.label}</span>
            </button>
          );
        })}
      </ChoiceRow>
    </div>
  );
}

function StrokeStyleSection({ strokeStyle, onStrokeStyleChange }) {
  return (
    <div>
      <SectionLabel>Stroke style</SectionLabel>
      <ChoiceRow ariaLabel="Stroke style">
        {STYLE_CHOICES.map((s) => {
          const active = strokeStyle === s.value;
          return (
            <button
              key={s.value}
              type="button"
              title={s.label}
              aria-label={`${s.label} stroke style`}
              aria-pressed={active}
              onClick={() => onStrokeStyleChange(s.value)}
              className={choiceClass(active)}
            >
              {s.value === 'solid' && (
                <span aria-hidden="true" className="block h-0 w-8 border-t-2 border-current" />
              )}
              {s.value === 'dashed' && (
                <span aria-hidden="true" className="block h-0 w-8 border-t-2 border-dashed border-current" />
              )}
              {s.value === 'dotted' && (
                <span aria-hidden="true" className="block h-0 w-8 border-t-2 border-dotted border-current" />
              )}
            </button>
          );
        })}
      </ChoiceRow>
    </div>
  );
}

function SloppinessSection({ roughness, onRoughnessChange }) {
  const icons = {
    0: <path key="a" d="M2.5 12 Q 7.5 10.5, 12 12 T 21.5 12" />,
    1: <path key="b" d="M2.5 12 Q 5 8.5, 7.5 12 T 12.5 12 T 17.5 12 T 21.5 12" />,
    2: (
      <>
        <path key="c1" d="M2.5 9.5 Q 5 6, 7.5 9.5 T 12.5 9.5 T 17.5 9.5 T 21.5 9.5" />
        <path key="c2" d="M2.5 14.5 Q 5 18, 7.5 14.5 T 12.5 14.5 T 17.5 14.5 T 21.5 14.5" />
      </>
    ),
  };
  return (
    <div>
      <SectionLabel>Sloppiness</SectionLabel>
      <ChoiceRow ariaLabel="Sloppiness">
        {ROUGHNESS_CHOICES.map((r) => (
          <IconBtn
            key={r.value}
            title={r.label}
            label={`${r.label} sloppiness`}
            active={roughness === r.value}
            onClick={() => onRoughnessChange(r.value)}
            stretch
          >
            {icons[r.value]}
          </IconBtn>
        ))}
      </ChoiceRow>
    </div>
  );
}

function EdgesSection({ roundness, onRoundnessChange }) {
  const icons = {
    sharp: <rect key="s" x="6" y="6" width="12" height="12" rx="0.5" />,
    round: <rect key="r" x="6" y="6" width="12" height="12" rx="4.5" />,
  };
  return (
    <div>
      <SectionLabel>Edges</SectionLabel>
      <ChoiceRow ariaLabel="Edge roundness">
        {ROUNDNESS_CHOICES.map((r) => (
          <IconBtn
            key={r.value}
            title={r.label}
            label={`${r.label} edges`}
            active={roundness === r.value}
            onClick={() => onRoundnessChange(r.value)}
            stretch
          >
            {icons[r.value]}
          </IconBtn>
        ))}
      </ChoiceRow>
    </div>
  );
}

/**
 * ArrowTypeSection — path shape picker (reference design §5).
 * Straight (↗ vector), Curved (⤳ smooth Bezier), Elbow (⤴ orthogonal).
 * Writes `shape.arrowType` ('straight' | 'curved' | 'elbow').
 */
function ArrowTypeSection({ arrowType = 'straight', onArrowTypeChange }) {
  const icons = {
    straight: (
      <>
        <line key="l" x1="5" y1="19" x2="19" y2="5" />
        <polyline key="h" points="9 5 19 5 19 15" />
      </>
    ),
    curved: (
      <>
        <path key="c" d="M5 19 Q 12 12, 19 5" />
        <polyline key="h" points="12.5 5 19 5 19 11.5" />
      </>
    ),
    elbow: (
      <>
        <path key="e" d="M5 19 H 14 V 5" />
        <polyline key="h" points="9.5 9.5 14 5 18.5 9.5" />
      </>
    ),
  };
  const list = ARROW_TYPE_CHOICES ?? [
    { value: 'straight', label: 'Straight' },
    { value: 'curved', label: 'Curved' },
    { value: 'elbow', label: 'Elbow' },
  ];
  return (
    <div>
      <SectionLabel>Arrow type</SectionLabel>
      <ChoiceRow ariaLabel="Arrow type">
        {list.map((a) => (
          <IconBtn
            key={a.value}
            title={a.label}
            label={`${a.label} arrow`}
            active={(arrowType ?? 'straight') === a.value}
            onClick={() => onArrowTypeChange(a.value)}
            stretch
          >
            {icons[a.value]}
          </IconBtn>
        ))}
      </ChoiceRow>
    </div>
  );
}

/**
 * ArrowheadsSection — 2 toggle buttons (reference design §6).
 * Start (←) toggles the start pointer, End (→) toggles the end pointer.
 * Back-compat: values are the canonical 'none' | 'arrow' | 'dot' strings;
 * toggling maps active (<> 'none') <-> 'none'/'arrow' via onStart/EndChange.
 */
function ArrowheadsSection({ startArrowhead = 'none', endArrowhead = 'arrow', onStartChange, onEndChange }) {
  const startActive = startArrowhead !== 'none';
  const endActive = endArrowhead !== 'none';
  const base = (active) =>
    `flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
      active
        ? 'border-violet-300 bg-violet-100 text-violet-700'
        : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100'
    }`;
  return (
    <div>
      <SectionLabel>Arrowheads</SectionLabel>
      <div className="mt-1.5 flex items-center gap-1" role="group" aria-label="Arrowheads">
        <button
          type="button"
          title={startActive ? 'Remove start arrowhead' : 'Add start arrowhead'}
          aria-label="Toggle start arrowhead"
          aria-pressed={startActive}
          onClick={() => onStartChange(startActive ? 'none' : 'arrow')}
          className={base(startActive)}
        >
          <span aria-hidden="true">←</span>
          <span className="text-[11px] font-medium">Start</span>
        </button>
        <button
          type="button"
          title={endActive ? 'Remove end arrowhead' : 'Add end arrowhead'}
          aria-label="Toggle end arrowhead"
          aria-pressed={endActive}
          onClick={() => onEndChange(endActive ? 'none' : 'arrow')}
          className={base(endActive)}
        >
          <span aria-hidden="true">→</span>
          <span className="text-[11px] font-medium">End</span>
        </button>
      </div>
    </div>
  );
}

/** Legacy 3-choice arrowhead picker (kept for `line` shapes). */
export function LineArrowheadsSection({ startArrowhead, endArrowhead, onStartChange, onEndChange }) {
  return (
    <div>
      <SectionLabel>Arrowheads</SectionLabel>
      <p className="mt-1 text-[11px] text-gray-500">Start</p>
      <ChoiceRow ariaLabel="Start arrowhead">
        {ARROWHEAD_CHOICES.map((a) => (
          <button
            key={a.value}
            type="button"
            title={`Start: ${a.label}`}
            aria-label={`Start arrowhead ${a.label}`}
            aria-pressed={startArrowhead === a.value}
            onClick={() => onStartChange(a.value)}
            className={choiceClass(startArrowhead === a.value)}
          >
            {a.label}
          </button>
        ))}
      </ChoiceRow>
      <p className="mt-1.5 text-[11px] text-gray-500">End</p>
      <ChoiceRow ariaLabel="End arrowhead">
        {ARROWHEAD_CHOICES.map((a) => (
          <button
            key={a.value}
            type="button"
            title={`End: ${a.label}`}
            aria-label={`End arrowhead ${a.label}`}
            aria-pressed={endArrowhead === a.value}
            onClick={() => onEndChange(a.value)}
            className={choiceClass(endArrowhead === a.value)}
          >
            {a.label}
          </button>
        ))}
      </ChoiceRow>
    </div>
  );
}

function FontFamilySection({ fontFamilyKey, onFontFamilyChange }) {
  // NOTE: rendered as plain buttons (NOT IconBtn) — IconBtn wraps children
  // in an <svg>, where HTML <span> glyphs never paint (blank buttons).
  const options = [
    {
      key: 'hand',
      label: 'Hand-drawn',
      content: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
      ),
    },
    {
      key: 'normal',
      label: 'Normal',
      content: <span aria-hidden="true" className="font-sans text-sm font-semibold leading-none">A</span>,
    },
    {
      key: 'code',
      label: 'Code',
      content: <span aria-hidden="true" className="font-mono text-sm font-semibold leading-none">{'</>'}</span>,
    },
    {
      key: 'serif',
      label: 'Serif',
      content: <span aria-hidden="true" className="font-serif text-sm font-semibold leading-none">A</span>,
    },
  ];
  return (
    <div>
      <SectionLabel>Font family</SectionLabel>
      <ChoiceRow ariaLabel="Font family">
        {options.map((f) => {
          const active = fontFamilyKey === f.key;
          return (
            <button
              key={f.key}
              type="button"
              title={f.label}
              aria-label={`${f.label} font`}
              aria-pressed={active}
              onClick={() => onFontFamilyChange(f.key)}
              className={`flex h-9 flex-1 items-center justify-center rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                active
                  ? 'border-violet-200 bg-violet-100 text-violet-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {f.content}
            </button>
          );
        })}
      </ChoiceRow>
    </div>
  );
}

function FontSizeSection({ fontSize, onFontSizeChange }) {
  return (
    <div>
      <SectionLabel>Font size</SectionLabel>
      <ChoiceRow ariaLabel="Font size">
        {FONT_SIZE_CHOICES.map((f) => (
          <button
            key={f.value}
            type="button"
            title={`${f.label} (${f.value}px)`}
            aria-label={`${f.label} font size`}
            aria-pressed={fontSize === f.value}
            onClick={() => onFontSizeChange(f.value)}
            className={choiceClass(fontSize === f.value)}
          >
            {f.label}
          </button>
        ))}
      </ChoiceRow>
    </div>
  );
}

function TextAlignSection({ textAlign, onTextAlignChange }) {
  const icons = {
    left: (
      <>
        <line key="l1" x1="4" y1="6" x2="20" y2="6" />
        <line key="l2" x1="4" y1="12" x2="14" y2="12" />
        <line key="l3" x1="4" y1="18" x2="17" y2="18" />
      </>
    ),
    center: (
      <>
        <line key="l1" x1="4" y1="6" x2="20" y2="6" />
        <line key="l2" x1="7" y1="12" x2="17" y2="12" />
        <line key="l3" x1="5.5" y1="18" x2="18.5" y2="18" />
      </>
    ),
    right: (
      <>
        <line key="l1" x1="4" y1="6" x2="20" y2="6" />
        <line key="l2" x1="10" y1="12" x2="20" y2="12" />
        <line key="l3" x1="7" y1="18" x2="20" y2="18" />
      </>
    ),
  };
  const list = TEXT_ALIGN_CHOICES ?? [
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Center' },
    { value: 'right', label: 'Right' },
  ];
  return (
    <div>
      <SectionLabel>Text align</SectionLabel>
      <ChoiceRow ariaLabel="Text alignment">
        {list.map((a) => (
          <IconBtn
            key={a.value}
            title={a.label}
            label={`Align ${a.label}`}
            active={textAlign === a.value}
            onClick={() => onTextAlignChange(a.value)}
            stretch
          >
            {icons[a.value]}
          </IconBtn>
        ))}
      </ChoiceRow>
    </div>
  );
}

function OpacitySection({ opacity, onOpacityChange }) {
  const pct = Math.round(((opacity ?? 1) > 1 ? (opacity ?? 100) / 100 : (opacity ?? 1)) * 100);
  return (
    <div>
      <div className="flex items-center justify-between">
        <SectionLabel>Opacity</SectionLabel>
        <span className="text-[11px] tabular-nums text-gray-500">{pct}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        aria-label="Opacity"
        onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
        className="mt-1.5 w-full accent-violet-600"
      />
    </div>
  );
}

function LayerSection({ hasSelection, onBringToFront = () => {}, onSendToBack = () => {}, onBringForward = () => {}, onSendBackward = () => {} }) {
  const actions = [
    {
      key: 'back',
      label: 'Send to back',
      title: hasSelection ? 'Send to back (Shift+[)' : 'Select a shape to reorder',
      onClick: onSendToBack,
      icon: (
        <>
          <path d="M12 4v9" />
          <polyline points="7 9.5 12 14 17 9.5" />
          <line x1="4" y1="19.5" x2="20" y2="19.5" />
        </>
      ),
    },
    {
      key: 'backward',
      label: 'Send backward',
      title: hasSelection ? 'Send backward ([)' : 'Select a shape to reorder',
      onClick: onSendBackward,
      icon: (
        <>
          <path d="M12 5v14" />
          <polyline points="6 12.5 12 18.5 18 12.5" />
        </>
      ),
    },
    {
      key: 'forward',
      label: 'Bring forward',
      title: hasSelection ? 'Bring forward (])' : 'Select a shape to reorder',
      onClick: onBringForward,
      icon: (
        <>
          <path d="M12 19V5" />
          <polyline points="6 11.5 12 5.5 18 11.5" />
        </>
      ),
    },
    {
      key: 'front',
      label: 'Bring to front',
      title: hasSelection ? 'Bring to front (Shift+])' : 'Select a shape to reorder',
      onClick: onBringToFront,
      icon: (
        <>
          <line x1="4" y1="4.5" x2="20" y2="4.5" />
          <path d="M12 20v-9" />
          <polyline points="7 14.5 12 10 17 14.5" />
        </>
      ),
    },
  ];
  return (
    <div>
      <SectionLabel>Layers</SectionLabel>
      <div className="mt-1.5 flex items-center gap-1.5" role="group" aria-label="Layer ordering">
        {actions.map((a) => (
          <IconBtn
            key={a.key}
            title={a.title}
            label={a.label}
            disabled={!hasSelection}
            onClick={a.onClick}
          >
            {a.icon}
          </IconBtn>
        ))}
      </div>
    </div>
  );
}

/**
 * SelectionActionsSection — compact object actions for Selection mode.
 * No styling controls (swatches, edges, fonts, arrowheads stay hidden);
 * just Duplicate, Delete, and live width/height size badges for the
 * selected shape. Clear Canvas lives in the top navbar.
 */
const SELECTION_TYPE_LABELS = {
  rectangle: 'Rectangle',
  circle: 'Ellipse',
  diamond: 'Diamond',
  arrow: 'Arrow',
  line: 'Line',
  freehand: 'Pen',
  pen: 'Pen',
  text: 'Text',
  image: 'Image',
  frame: 'Frame',
};

/**
 * ConvertShapeSection — in-place morph toggle between Rectangle,
 * Circle/Ellipse, and Diamond. Renders only for those types; commits flow
 * through the single `onConvertShape(targetType)` boundary (shell rewrites
 * geometry via `morphShape` + `onShapeUpdate`, preserving the visual
 * bounding box across Konva's differing origin models).
 */
function ConvertShapeSection({ shapeType, onConvert = () => {} }) {
  const norm = shapeType === 'rect' ? 'rectangle' : shapeType === 'ellipse' ? 'circle' : shapeType;
  if (norm !== 'rectangle' && norm !== 'circle' && norm !== 'diamond') return null;
  const options = [
    { value: 'rectangle', label: 'Rectangle' },
    { value: 'circle', label: 'Circle' },
    { value: 'diamond', label: 'Diamond' },
  ];
  return (
    <div>
      <SectionLabel>Convert shape</SectionLabel>
      <ChoiceRow ariaLabel="Convert shape">
        {options.map((o) => {
          const active = norm === o.value;
          return (
            <button
              key={o.value}
              type="button"
              title={active ? `${o.label} (current)` : `Convert to ${o.label}`}
              aria-label={`Convert to ${o.label}`}
              aria-pressed={active}
              disabled={active}
              onClick={() => onConvert(o.value)}
              className={`${choiceClass(active)} disabled:cursor-default disabled:opacity-70`}
            >
              {o.label}
            </button>
          );
        })}
      </ChoiceRow>
    </div>
  );
}

function SelectionActionsSection({ selectedShape, onDuplicate = () => {}, onDelete = () => {}, onConvertShape = () => {} }) {
  const bounds = selectedShape ? getShapeBounds(selectedShape) : null;
  const label = SELECTION_TYPE_LABELS[selectedShape?.type] ?? 'Shape';
  const convertible =
    selectedShape?.type === 'rectangle' ||
    selectedShape?.type === 'circle' ||
    selectedShape?.type === 'diamond';
  return (
    <div>
      <div className="flex items-center justify-between">
        <SectionLabel>Actions</SectionLabel>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
          {label}
        </span>
      </div>
      {bounds && (
        <div
          className="mt-1.5 flex items-center gap-1.5 text-[11px] tabular-nums text-gray-600"
          aria-live="polite"
          aria-label="Selected shape size"
        >
          <span className="flex-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-center">
            W {Math.round(bounds.width)}
          </span>
          <span aria-hidden="true" className="text-gray-400">×</span>
          <span className="flex-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-center">
            H {Math.round(bounds.height)}
          </span>
        </div>
      )}
      {convertible && (
        <ConvertShapeSection shapeType={selectedShape.type} onConvert={onConvertShape} />
      )}
      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onDuplicate}
          title="Duplicate selected shape"
          aria-label="Duplicate selected shape"
          className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-gray-200 text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Duplicate
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Delete selected shape (Del)"
          aria-label="Delete selected shape"
          className="flex h-8 w-9 items-center justify-center rounded-md border border-rose-200 text-rose-600 transition-colors hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Shared visibility gate for the customization panel (used by the sidebar
 * itself and by the shell to drive the 3-dot popover toggle).
 * Returns true when the panel has content: a creative drawing tool is
 * active, or the Selection tool has a shape selected. Hand/pan and eraser
 * never show it.
 */
export function shouldShowPropertiesPanel({ activeTool, selectedShape, hasSelection } = {}) {
  const toolKey = typeof activeTool === 'string' ? activeTool.toLowerCase() : '';
  const isSelectTool = toolKey === 'select' || toolKey === 'selection';
  const isCreatableTool = [
    'rectangle', 'rect',
    'circle', 'ellipse',
    'diamond', 'rhombus',
    'arrow',
    'line',
    'pen', 'freehand', 'draw', 'freedraw',
    'text',
  ].includes(toolKey);
  const showSelectionActions =
    isSelectTool && (Boolean(selectedShape) || Boolean(hasSelection));
  return isCreatableTool || showSelectionActions;
}

/**
 * PropertySidebar — Excalidraw-style contextual property panel.
 * Context is driven by BOTH the selection and the active tool:
 * - Arrow tool active OR arrow selected: stroke color, stroke width
 *   (1/2/4), stroke style, sloppiness, arrow type, arrowheads
 *   (start/end toggles), opacity, layers.
 * - Text tool active OR text selected: stroke (text color), font family
 *   (4), font size (S/M/L/XL), text align, opacity, layers.
 * - rectangle / circle / diamond (+ freehand): stroke, background,
 *   width, style, sloppiness, edges, opacity, layers.
 * - line (Excalidraw parity): stroke, background, width, style,
 *   sloppiness, opacity, layers — NO arrowheads, NO arrow type, NO edges.
 *   Arrow controls render ONLY for arrows (see `isArrow` below).
 * Visibility: the sidebar renders ONLY for creative drawing tools
 * (rectangle, circle/ellipse, diamond, arrow, line, pen/freehand, text)
 * — plus a compact Actions card (Duplicate, Delete, size) when the
 * Selection tool has a shape selected. Hand/pan and eraser NEVER show
 * it, so the panel never blocks canvas gestures.
 * With no selection, shows the canvas defaults for the next shape.
 * Container: bg-white shadow border rounded-lg p-3 w-56 flex flex-col gap-3 text-xs
 */
export default function PropertySidebar({
  color,
  fill,
  strokeWidth,
  strokeStyle,
  opacity,
  roughness = 0,
  roundness = 'sharp',
  startArrowhead = 'none',
  endArrowhead = 'arrow',
  arrowType = 'straight',
  fontFamilyKey = 'hand',
  fontSize = 20,
  textAlign = 'left',
  align,
  // Crash-safety fallbacks: the popover must never throw on undefined
  // props (an uncaught render error would whiteout the whole viewport
  // since there is no root error boundary). Defaults resolve to the
  // neutral select-tool state, which simply renders nothing.
  activeTool = 'select',
  tool: toolAlias,
  hasSelection = false,
  selectedShape = null,
  onColorChange = () => {},
  onFillChange = () => {},
  onStrokeWidthChange = () => {},
  onStrokeStyleChange = () => {},
  onOpacityChange = () => {},
  onRoughnessChange = () => {},
  onRoundnessChange = () => {},
  onStartArrowheadChange = () => {},
  onEndArrowheadChange = () => {},
  onArrowTypeChange = () => {},
  onFontFamilyChange = () => {},
  onFontSizeChange = () => {},
  onTextAlignChange = () => {},
  onAlignChange = () => {},
  onDuplicate = () => {},
  onDelete = () => {},
  onClear = () => {},
  onConvertShape = () => {},
  onStraighten = () => {},
  onBringToFront = () => {},
  onSendToBack = () => {},
  onBringForward = () => {},
  onSendBackward = () => {},
}) {
  const activeToolName = activeTool ?? toolAlias ?? null;
  const type = selectedShape?.type ?? null;
  // Contextual target: selection wins when present, otherwise the active
  // tool drives the inspector so picking L/A/T/P previews its controls
  // with the live defaults (Excalidraw parity). Aliases normalized:
  // rect->rectangle, rhombus->diamond, ellipse->circle, pen/draw/freedraw->freehand.
  const targetType = selectedShape?.type || activeToolName;
  const _raw = typeof targetType === 'string' ? targetType.toLowerCase() : '';
  const _alias =
    _raw === 'rect' ? 'rectangle'
    : _raw === 'rhombus' ? 'diamond'
    : _raw === 'ellipse' ? 'circle'
    : _raw === 'pen' || _raw === 'draw' || _raw === 'freedraw' ? 'freehand'
    : _raw;
  // Selection wins when present; otherwise the active tool drives context
  // so picking the Arrow/Text tool previews its inspector with defaults.
  const contextType = type ?? activeToolName ?? null;
  const _ctx = typeof contextType === 'string' ? contextType.toLowerCase() : null;
  const _ctxNorm =
    _ctx === 'rect' ? 'rectangle'
    : _ctx === 'rhombus' ? 'diamond'
    : _ctx === 'ellipse' ? 'circle'
    : _ctx === 'pen' || _ctx === 'draw' || _ctx === 'freedraw' ? 'freehand'
    : _ctx;
  const isText = _ctxNorm === 'text';
  // Arrow controls render ONLY for arrows: the active Arrow tool with no
  // selection, or a selected arrow shape. Equivalent to
  // `activeTool === 'arrow' || selectedShape?.type === 'arrow'` when no
  // foreign shape is selected (selection always wins for context).
  const isArrow = _ctxNorm === 'arrow';
  const isLine = _alias === 'line';
  const isArrowLine = isArrow || isLine;
  const isClosed =
    _alias === 'rectangle' || _alias === 'circle' || _alias === 'diamond';
  const isFreehand = _alias === 'freehand';
  const isPen = isFreehand;
  const showDefaults = !hasSelection && !type && _alias !== 'arrow' && _alias !== 'text' && !isLine && !isPen && !isClosed;

  // Edges (Sharp/Round corner rounding) applies ONLY to angular 2D
  // polygons — rectangles and diamonds. Freehand pen paths have no
  // corners/vertex bevels, and circles, lines, arrows, and text have no
  // angular corners either, so the control stays hidden for all of them.
  // Allowed shapes/tools for the "Edges" corner-rounding control:
  const ANGULAR_SHAPES = ['rectangle', 'rect', 'diamond', 'rhombus'];

  // Determine the current target type:
  const currentType = selectedShape?.type || activeToolName;

  // Show Edges ONLY if the shape/tool is an angular polygon:
  const showEdges = ANGULAR_SHAPES.includes(currentType);

  // Background (fill) applies only to closed 2D shapes. Open paths
  // (pen/freehand) carry no fill, so the Pen defaults omit it.
  const showBackground = ['rectangle', 'rect', 'circle', 'ellipse', 'diamond', 'rhombus'].includes(
    currentType,
  );

  // Sidebar visibility: driven by the ACTIVE TOOL only — never by
  // selection alone. Creative drawing tools show full styling panels;
  // the Selection tool shows a compact Actions card (Duplicate, Delete,
  // size) ONLY when a shape is selected. Inactive tools ('pan'/'hand',
  // 'eraser') render nothing, even with a selection, so the panel never
  // blocks canvas gestures. Hand/Eraser keep only the top navbar.
  // (Gate shared with the shell's 3-dot popover via
  // shouldShowPropertiesPanel.)
  const toolKey = typeof activeToolName === 'string' ? activeToolName.toLowerCase() : '';
  const isSelectTool = toolKey === 'select' || toolKey === 'selection';
  const showSelectionActions =
    isSelectTool && (Boolean(selectedShape) || Boolean(hasSelection));
  const shouldShowSidebar = shouldShowPropertiesPanel({
    activeTool: activeToolName,
    selectedShape,
    hasSelection,
  });

  if (!shouldShowSidebar) {
    return null;
  }

  const noop = () => {};
  const safeColor = onColorChange ?? noop;
  const safeFill = onFillChange ?? noop;
  const safeWidth = onStrokeWidthChange ?? noop;
  const safeStyle = onStrokeStyleChange ?? noop;
  const safeOpacity = onOpacityChange ?? noop;
  const safeRough = onRoughnessChange ?? noop;
  const safeRound = onRoundnessChange ?? noop;
  const safeStart = onStartArrowheadChange ?? noop;
  const safeEnd = onEndArrowheadChange ?? noop;
  const safeArrowType = onArrowTypeChange ?? noop;
  const safeFont = onFontFamilyChange ?? noop;
  const safeSize = onFontSizeChange ?? noop;
  const safeAlign = (...args) => {
    (onTextAlignChange ?? noop)(...args);
    (onAlignChange ?? noop)(...args);
  };

  const bendCount =
    selectedShape?.type === 'arrow' && Array.isArray(selectedShape.points)
      ? Math.max(0, selectedShape.points.length / 2 - 2)
      : 0;

  const effectiveAlign = align ?? textAlign;
  const effectiveArrowType = selectedShape?.arrowType ?? arrowType ?? 'straight';

  return (
    <aside
      aria-label="Shape properties"
      className="pointer-events-auto flex w-56 flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
    >
      {showSelectionActions ? (
        // Selection mode with a selection: object actions only (Duplicate,
        // Delete, live size badges). All styling sections stay hidden;
        // the generic footer is skipped here since these buttons cover it
        // and Clear Canvas lives in the top navbar.
        <SelectionActionsSection
          selectedShape={selectedShape}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onConvertShape={onConvertShape}
        />
      ) : (
      <>
      {isText ? (
        <>
          <StrokeSection color={color} onColorChange={safeColor} swatches={TEXT_STROKE_SWATCHES} label="Stroke" />
          <FontFamilySection fontFamilyKey={fontFamilyKey} onFontFamilyChange={safeFont} />
          <FontSizeSection fontSize={fontSize} onFontSizeChange={safeSize} />
          <TextAlignSection textAlign={effectiveAlign} onTextAlignChange={safeAlign} />
          <OpacitySection opacity={opacity} onOpacityChange={safeOpacity} />
          <LayerSection
            hasSelection={hasSelection}
            onBringToFront={onBringToFront}
            onSendToBack={onSendToBack}
            onBringForward={onBringForward}
            onSendBackward={onSendBackward}
          />
        </>
      ) : isArrow ? (
        <>
          <StrokeSection color={color} onColorChange={safeColor} swatches={ARROW_STROKE_SWATCHES} label="Stroke Color" />
          <StrokeWidthSection strokeWidth={strokeWidth} onStrokeWidthChange={safeWidth} choices={ARROW_WIDTH_CHOICES} />
          <StrokeStyleSection strokeStyle={strokeStyle} onStrokeStyleChange={safeStyle} />
          <SloppinessSection roughness={roughness} onRoughnessChange={safeRough} />
          <ArrowTypeSection arrowType={effectiveArrowType} onArrowTypeChange={safeArrowType} />
          <ArrowheadsSection
            startArrowhead={startArrowhead}
            endArrowhead={endArrowhead}
            onStartChange={safeStart}
            onEndChange={safeEnd}
          />
          <OpacitySection opacity={opacity} onOpacityChange={safeOpacity} />
          <LayerSection
            hasSelection={hasSelection}
            onBringToFront={onBringToFront}
            onSendToBack={onSendToBack}
            onBringForward={onBringForward}
            onSendBackward={onSendBackward}
          />
          {selectedShape?.type === 'arrow' && (
            <div>
              <div className="flex items-center justify-between">
                <SectionLabel>Bends</SectionLabel>
                <span className="text-[11px] tabular-nums text-gray-500">
                  {bendCount === 0 ? 'straight' : `${bendCount} bend${bendCount === 1 ? '' : 's'}`}
                </span>
              </div>
              <p className="mt-1 leading-relaxed text-gray-500">
                Drag the violet midpoint handle on the canvas to bend this arrow.
              </p>
              <button
                type="button"
                onClick={onStraighten}
                disabled={bendCount === 0}
                title={bendCount === 0 ? 'Arrow is already straight' : 'Remove all bends'}
                className="mt-1.5 flex h-8 w-full items-center justify-center rounded-md border border-gray-200 text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Straighten
              </button>
            </div>
          )}
        </>
      ) : isArrowLine ? (
        <>
          {/* Line parity: Stroke, Stroke width, Stroke style, Sloppiness,
          Opacity, Layers. NO Background, NO Edges, NO arrow type,
          NO arrowheads (arrow-only controls). */}
          <StrokeSection color={color} onColorChange={safeColor} />
          <StrokeWidthSection strokeWidth={strokeWidth} onStrokeWidthChange={safeWidth} />
          <StrokeStyleSection strokeStyle={strokeStyle} onStrokeStyleChange={safeStyle} />
          <SloppinessSection roughness={roughness} onRoughnessChange={safeRough} />
          <OpacitySection opacity={opacity} onOpacityChange={safeOpacity} />
          <LayerSection
            hasSelection={hasSelection}
            onBringToFront={onBringToFront}
            onSendToBack={onSendToBack}
            onBringForward={onBringForward}
            onSendBackward={onSendBackward}
          />
        </>
      ) : isPen ? (
        <>
          {/* Pen / freehand parity: Stroke, Stroke width (thin/medium/bold),
          Opacity, Layers. NO Background, NO Edges, NO Sloppiness,
          NO stroke style, NO arrowheads. */}
          <StrokeSection color={color} onColorChange={safeColor} />
          <StrokeWidthSection strokeWidth={strokeWidth} onStrokeWidthChange={safeWidth} />
          <OpacitySection opacity={opacity} onOpacityChange={safeOpacity} />
          <LayerSection
            hasSelection={hasSelection}
            onBringToFront={onBringToFront}
            onSendToBack={onSendToBack}
            onBringForward={onBringForward}
            onSendBackward={onSendBackward}
          />
        </>
      ) : isClosed ? (
        <>
          {(selectedShape?.type === 'rectangle' ||
            selectedShape?.type === 'circle' ||
            selectedShape?.type === 'diamond') && (
            <ConvertShapeSection shapeType={selectedShape.type} onConvert={onConvertShape} />
          )}
          <StrokeSection color={color} onColorChange={safeColor} />
          {isClosed && <BackgroundSection fill={fill} onFillChange={safeFill} />}
          <StrokeWidthSection strokeWidth={strokeWidth} onStrokeWidthChange={safeWidth} />
          <StrokeStyleSection strokeStyle={strokeStyle} onStrokeStyleChange={safeStyle} />
          <SloppinessSection roughness={roughness} onRoughnessChange={safeRough} />
          {showEdges && <EdgesSection roundness={roundness} onRoundnessChange={safeRound} />}
          <OpacitySection opacity={opacity} onOpacityChange={safeOpacity} />
          <LayerSection
            hasSelection={hasSelection}
            onBringToFront={onBringToFront}
            onSendToBack={onSendToBack}
            onBringForward={onBringForward}
            onSendBackward={onSendBackward}
          />
        </>
      ) : showDefaults ? (
        <>
          <StrokeSection color={color} onColorChange={safeColor} />
          {showBackground && <BackgroundSection fill={fill} onFillChange={safeFill} />}
          <StrokeWidthSection strokeWidth={strokeWidth} onStrokeWidthChange={safeWidth} />
          <StrokeStyleSection strokeStyle={strokeStyle} onStrokeStyleChange={safeStyle} />
          <SloppinessSection roughness={roughness} onRoughnessChange={safeRough} />
          {showEdges && <EdgesSection roundness={roundness} onRoundnessChange={safeRound} />}
          <OpacitySection opacity={opacity} onOpacityChange={safeOpacity} />
          <LayerSection
            hasSelection={hasSelection}
            onBringToFront={onBringToFront}
            onSendToBack={onSendToBack}
            onBringForward={onBringForward}
            onSendBackward={onSendBackward}
          />
        </>
      ) : null}
      </>
      )}

      {!showSelectionActions && (
      <div className="flex items-center gap-1.5 border-t border-gray-100 pt-2.5">
        <button
          type="button"
          onClick={onDuplicate}
          disabled={!hasSelection}
          title={hasSelection ? 'Duplicate selected shape' : 'Select a shape to duplicate'}
          className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-gray-200 text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Duplicate
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={!hasSelection}
          title={hasSelection ? 'Delete selected shape (Del)' : 'Select a shape to delete'}
          aria-label="Delete selected shape"
          className="flex h-8 w-9 items-center justify-center rounded-md border border-rose-200 text-rose-600 transition-colors hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onClear}
          title="Clear canvas"
          aria-label="Clear canvas"
          className="flex h-8 items-center justify-center rounded-md px-2 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          Clear
        </button>
      </div>
      )}
    </aside>
  );
}
