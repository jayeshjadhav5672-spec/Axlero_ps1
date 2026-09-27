import { useEffect } from 'react';

/**
 * useCanvasHotkeys — global keyboard hotkeys for the whiteboard.
 *
 * Binds window key listeners, ignoring events when typing inside <input>,
 * <textarea>, <select>, or contentEditable elements (and while the text
 * overlay editor is open):
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
function isTypingTarget() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
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
      if (textEditor) return;
      if (isTypingTarget()) return;

      const mod = event.metaKey || event.ctrlKey;
      const k = (event.key ?? '').toLowerCase();

      // Operation hotkeys (mod-gated) take precedence over tool keys.
      if (mod && !event.altKey) {
        if (k === 'd') {
          event.preventDefault();
          onDuplicate?.();
          return;
        }
        if (k === 'g') {
          event.preventDefault();
          if (event.shiftKey) onUngroup?.();
          else onGroup?.();
          return;
        }
        return;
      }
      if (mod || event.altKey) return;

      const next = TOOL_SHORTCUTS[k];
      if (next) {
        event.preventDefault();
        onToolChange?.(next);
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
