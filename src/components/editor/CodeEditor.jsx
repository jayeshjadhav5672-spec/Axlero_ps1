/**
 * CodeEditor — Monaco collaboration editor.
 *
 * Fills the documented integration seam (docs/INTEGRATION.md §5): the shell
 * only knows `{ value, onChange }`, so this drops in wherever the temporary
 * textarea fallback was used — no change to the sync hooks or panels.
 *
 * Monaco is bundled locally (no CDN loader) and its language workers are
 * wired through Vite's `?worker` imports, so the editor works offline.
 */

import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import cssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

globalThis.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

export default function CodeEditor({
  value = '',
  onChange,
  language = 'javascript',
  theme = 'vs-dark',
  ariaLabel = 'Shared code editor',
  placeholder = '// Start typing — collaborators in this room see every keystroke…',
  disabled = false,
  className = '',
}) {
  const hostRef = useRef(null);
  const editorRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const editor = monaco.editor.create(hostRef.current, {
      value,
      language,
      theme,
      ariaLabel,
      placeholder,
      automaticLayout: true,
      readOnly: disabled,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 14,
      renderLineHighlight: 'none',
      padding: { top: 16, bottom: 16 },
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    });
    editorRef.current = editor;

    const subscription = editor.onDidChangeModelContent(() => {
      onChangeRef.current?.(editor.getValue());
    });

    return () => {
      subscription.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // Created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remote collaborators (or a reset) push a new value down: adopt it
  // without echoing back, which would otherwise loop through onChange.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.getValue() !== value) editor.setValue(value ?? '');
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: disabled });
  }, [disabled]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model) monaco.editor.setModelLanguage(model, language);
  }, [language]);

  return (
    <div
      ref={hostRef}
      className={`h-full min-h-[420px] w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-900 ${className}`}
    />
  );
}
