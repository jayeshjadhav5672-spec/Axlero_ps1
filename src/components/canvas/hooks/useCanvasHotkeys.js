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
 * are also handled here for a single integration boundary.
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

      const toolMap = {
        v: 'select',
        p: 'freehand',
        r: 'rectangle',
        c: 'circle',
        t: 'text',
        f: 'frame',
        // Legacy aliases (kept alongside the letter bindings).
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
      const next = toolMap[k];
      if (next) {
        event.preventDefault();
        onToolChange?.(next);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, onDuplicate, onGroup, onToolChange, onUngroup, textEditor]);
}
