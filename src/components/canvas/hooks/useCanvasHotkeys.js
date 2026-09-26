import { useEffect } from 'react';

/**
 * useCanvasHotkeys — global keyboard hotkeys for the whiteboard.
 *
 * Tool switching is click-only: this hook binds NO tool-selection keys.
 * Typing `1`, `2`, `3`, `d`, `a`, `l`, `p`, `t`, `f`, `e`, `h` (or `v`,
 * `r`, `c`) must never change the active tool.
 *
 * Binds window key listeners, ignoring events when typing inside <input>,
 * <textarea>, <select>, or contentEditable elements (and while the text
 * overlay editor is open):
 * - Cmd/Ctrl+D: Duplicate selected shape(s), offset (+20px, +20px)
 * - Cmd/Ctrl+G: Group selected shapes into a composite group
 * - Cmd/Ctrl+Shift+G: Ungroup composite group
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
  // onToolChange is accepted for back-compat but never invoked: tool
  // switching happens only via direct toolbar clicks.
  void onToolChange;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      if (textEditor) return;
      if (isTypingTarget()) return;

      const mod = event.metaKey || event.ctrlKey;
      const k = (event.key ?? '').toLowerCase();

      // Operation hotkeys (mod-gated) only. Bare tool keys fall through
      // and must never switch tools.
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
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, onDuplicate, onGroup, onUngroup, textEditor]);
}
