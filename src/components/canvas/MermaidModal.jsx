import React, { useEffect, useState } from 'react';
import { compileMermaidToShapes, MERMAID_PLACEHOLDER } from './utils/mermaid.js';

/**
 * MermaidModal — Sayon (Week 2: "Mermaid to Draw")
 * Textarea for flowchart syntax; compiles to native shapes and appends
 * them via onCompile(shapes). No Socket.io / Yjs deps.
 */
export default function MermaidModal({ open, onClose, onCompile, styleDefaults }) {
  const [source, setSource] = useState(MERMAID_PLACEHOLDER);
  const [error, setError] = useState('');

  // Escape closes the dialog (global canvas hotkeys ignore keystrokes
  // from TEXTAREA, so no conflict with canvas shortcuts).
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleCompile = () => {
    const result = compileMermaidToShapes(source, { x: 80, y: 80 }, styleDefaults ?? {});
    if (result.error) {
      setError(result.error);
      return;
    }
    setError('');
    onCompile?.(result.shapes);
    onClose?.();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mermaid to diagram"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">Mermaid to Diagram</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Mermaid dialog"
            className="rounded-md px-2 py-1 text-sm font-bold text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            ✕
          </button>
        </div>
        <p className="mb-2 text-xs text-slate-500">
          Paste Mermaid flowchart syntax — nodes compile to rectangles/circles with labels, links
          compile to arrows.
        </p>
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          rows={9}
          spellCheck={false}
          aria-label="Mermaid flowchart syntax"
          placeholder={MERMAID_PLACEHOLDER}
          className="w-full rounded-lg border border-gray-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 focus:border-violet-400 focus:outline-none"
        />
        {error && (
          <p role="alert" className="mt-2 text-xs font-medium text-rose-600">
            {error}
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCompile}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
          >
            Compile to shapes
          </button>
        </div>
      </div>
    </div>
  );
}
