/**
 * controlledEditorSync.js — remote-sync guard for controlled code editors.
 *
 * Monaco's `editor.setValue()` fires model-content change events, so naively
 * adopting a remote value would re-enter the local `onChange` path and echo
 * the remote update back over the collaboration transport
 * (`code:update` → echo loop).
 *
 * This module centralizes the suppression flag so the component
 * (`src/components/editor/CodeEditor.jsx`) and the regression test
 * (`test/code-editor-sync.test.mjs`) exercise the exact same mechanism
 * instead of duplicating the guard logic.
 *
 * Contract:
 * - USER TYPES: model content changes while NOT suppressing → onChange(nextText).
 * - REMOTE UPDATE: `applyRemote` adopts a new value with suppression held
 *   across the synchronous `setValue`, so no onChange fires. Identical
 *   values are a no-op (no `setValue` call at all).
 */

export function createRemoteSync() {
  let suppressing = false;

  return {
    /** True while a remote value is being applied. */
    isSuppressing() {
      return suppressing;
    },

    /**
     * Model-content listener entry point. Returns true when the change was
     * a user edit (onChange invoked), false when it was a suppressed
     * remote application.
     */
    handleModelContent(getValue, onChange) {
      if (suppressing) return false;
      onChange?.(getValue());
      return true;
    },

    /**
     * Adopt a remote value. Returns true when `apply` ran, false when the
     * editor already held the value (no `setValue` call). `next` may be
     * nullish — it normalizes to '' so empty-string resets work.
     */
    applyRemote(getCurrent, apply, next) {
      const target = next ?? '';
      if (getCurrent() === target) return false;
      suppressing = true;
      try {
        apply(target);
      } finally {
        suppressing = false;
      }
      return true;
    },
  };
}
