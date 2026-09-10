/**
 * CollabTextEditor — Integration Engineer (TEMPORARY fallback)
 *
 * Plain-textarea collaborative editor wired to useCollaborativeCode.
 * This exists only so code sync is usable/testable until Kishan's Monaco
 * <CodeEditor /> lands — it is intentionally NOT a Monaco implementation.
 *
 * Replacement contract: Kishan's component must accept
 *   { value, onChange(nextText), placeholder?, ariaLabel?, disabled? }
 * and Avantee's CodeEditorPanel renders whichever element is passed as
 * its `editor`/`children` prop. Swap this import in App.jsx, nothing else.
 */

import React from 'react';

export default function CollabTextEditor({
  value = '',
  onChange,
  placeholder = '// Start typing — collaborators in this room see every keystroke…',
  ariaLabel = 'Shared code editor',
  disabled = false,
  className = '',
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      wrap="off"
      className={`h-full min-h-[420px] w-full flex-1 resize-none rounded-xl border border-slate-700 bg-slate-900 p-4 font-mono text-sm leading-relaxed text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60 ${className}`}
    />
  );
}
