import { useEffect } from 'react';

/**
 * useCanvasHotkeys — global keyboard hotkeys for the whiteboard.
 *
 * Binds window key listeners, ignoring events whose target is an editable
 * surface — <input>, <textarea>, <select>, contentEditable elements, or
 * anything inside a Monaco editor container — and while the text overlay
 * editor is open. The guard inspects the event target/path (not just
 * document.activeElement) so Monaco keystrokes never switch tools:
 * - V: Select / Move tool
 * - P: Pen / Freehand tool
 * - R: Rectangle tool
 * - C: Circle tool
 * - T: Text tool
 * - F: Frame tool
 * - Cmd/Ctrl+D: Duplicate selected shape(s), offset (+20px, +20px)
 * - Cmd/Ctrl+G: Group selected shapes into a composite group
 * - Cmd/Ctrl+Shift+G: Ungroup composite group
 *
 * Tool shortcuts coexist with the legacy number-row aliases (1/2/3) which
 * are also handled here for a single integration boundary. Visible
 * shortcut badges were removed from the toolbar for a cleaner responsive
 * layout — the key bindings themselves are unchanged.
 *
 * Standard canvas shortcuts (undo/redo via Cmd/Ctrl+Z, delete via
 * Backspace/Delete, pan via Space) live in `useCanvasDrawing.js` and are
 * intentionally untouched here.
 */
/**
 * True when a keydown event originates from an editable surface or the
 * Monaco editor and must never trigger whiteboard shortcuts.
 *
 * Why event-based instead of `document.activeElement`: Monaco routes keys
 * through its `textarea.inputarea` inside a `.monaco-editor` container, but
 * focus can legitimately sit on non-textarea nodes in that container
 * (scrollbars, minimap, suggest/hover widgets, the editor container div
 * itself during focus transitions) while keystrokes still belong to the
 * editor. `document.activeElement` also lags across portals and focus
 * transitions. The event's own target/path is the ground truth for where
 * the keystroke is going, so inspect it first and fall back to the
 * focused element only when the event carries no usable target.
 *
 * Pure and DOM-defensive (never throws): safe to call from any key
 * handler and trivially unit-testable with fake event objects.
 */
export function isEditableTarget(event) {
  if (!event || typeof event !== 'object') return false;
  const candidates = [];
  if (event.target !== undefined && event.target !== null) candidates.push(event.target);
  try {
    if (typeof event.composedPath === 'function') {
      const path = event.composedPath();
      if (Array.isArray(path)) {
        for (const node of path) candidates.push(node);
      }
    }
  } catch {
    // Shadow-DOM path unavailable — target + activeElement still apply.
  }
  try {
    if (typeof document !== 'undefined' && document.activeElement) {
      candidates.push(document.activeElement);
    }
  } catch {
    // Non-DOM environment (unit tests) — skip the fallback.
  }
  for (const node of candidates) {
    if (!node || typeof node !== 'object') continue;
    const tag = typeof node.tagName === 'string' ? node.tagName.toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    try {
      if (node.isContentEditable) return true;
    } catch {
      // Ignore exotic host objects.
    }
    // Monaco editor: any element inside a `.monaco-editor` container
    // (inputarea textarea, widgets, container div itself). Class-based so
    // it survives Monaco internal DOM reshuffles; `closest` short-circuits
    // real DOM nodes without walking the whole ancestor chain by hand.
    try {
      if (typeof node.closest === 'function' && node.closest('.monaco-editor')) return true;
    } catch {
      // Non-Element nodes (document/window in composedPath) — fall through.
    }
    const className =
      typeof node.className === 'string'
        ? node.className
        : node.className && typeof node.className.baseVal === 'string'
          ? node.className.baseVal
          : '';
    if (/(^|\s)monaco-editor(\s|$)/.test(className)) return true;
  }
  return false;
}

/**
 * Pure key-decision for the whiteboard hotkeys. Returns a small action
 * descriptor (`{ type: 'tool', tool }`, `{ type: 'duplicate' }`,
 * `{ type: 'group' }`, `{ type: 'ungroup' }`) or null when the event must
 * be ignored (text editor overlay open, editable/Monaco target, or no
 * binding). The hook calls `preventDefault()` only for non-null actions,
 * so editable keystrokes are never interfered with.
 */
export function resolveCanvasHotkey(event, { textEditor = null } = {}) {
  if (textEditor) return null;
  if (isEditableTarget(event)) return null;
  const mod = Boolean(event.metaKey || event.ctrlKey);
  const k = String(event.key ?? '').toLowerCase();

  // Operation hotkeys (mod-gated) take precedence over tool keys.
  if (mod && !event.altKey) {
    if (k === 'd') return { type: 'duplicate' };
    if (k === 'g') return { type: 'group', ungroup: Boolean(event.shiftKey) };
    return null;
  }
  if (mod || event.altKey) return null;

  const tool = TOOL_SHORTCUTS[k];
  if (tool) return { type: 'tool', tool };
  return null;
}

export default function useCanvasHotkeys({
  onToolChange,
  onDuplicate,
  onGroup,
  onUngroup,
  textEditor = null,
  enabled = true,
} = {}) {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      const action = resolveCanvasHotkey(event, { textEditor });
      if (!action) return;
      event.preventDefault();
      if (action.type === 'tool') onToolChange?.(action.tool);
      else if (action.type === 'duplicate') onDuplicate?.();
      else if (action.type === 'group') {
        if (action.ungroup) onUngroup?.();
        else onGroup?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, onDuplicate, onGroup, onToolChange, onUngroup, textEditor]);
}

/**
 * Bare-key → tool mapping, exported for unit tests (the hook itself needs
 * a DOM + window listener, so the pure mapping is verified directly).
 * Legacy number-row aliases ride alongside the letter bindings.
 */
export const TOOL_SHORTCUTS = {
  v: 'select',
  p: 'freehand',
  r: 'rectangle',
  c: 'circle',
  t: 'text',
  f: 'frame',
  1: 'select',
  2: 'rectangle',
  3: 'circle',
  4: 'diamond',
  a: 'arrow',
  l: 'line',
  e: 'eraser',
  h: 'pan',
  d: 'diamond',
};
