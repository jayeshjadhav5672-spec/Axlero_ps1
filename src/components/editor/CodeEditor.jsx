/**
 * CodeEditor — Monaco collaboration editor (Kishan, leader-integrated).
 *
 * Fills the documented integration seam (docs/INTEGRATION.md §5): the shell
 * only knows `{ value, onChange }`, so this drops in wherever the
 * `CollabTextEditor` fallback was used — no change to the sync hooks or
 * panels. `useCollaborativeCode` stays the LWW transport; Monaco is the
 * presentation layer only.
 *
 * Monaco is bundled locally (no CDN loader) and its language workers are
 * wired through Vite's `?worker` imports, so the editor works offline.
 *
 * Remote-echo guard: Monaco's `editor.setValue()` fires model-content
 * change events, so adopting a remote value would otherwise re-enter
 * `onChange` and echo back over `code:update`. Remote application runs
 * under `controlledEditorSync` suppression; user typing never does.
 *
 * IDE presentation: options are tuned to feel like VS Code (dark
 * `syncspace-dark` theme on a #1e1e1e background, bracket colorization,
 * indentation guides, folding, smooth scrolling, minimap that hides
 * itself on narrow panes). The surrounding IDE chrome (activity bar,
 * explorer, tabs, status bar) lives in `CodeEditorPanel` — this component
 * only owns the Monaco instance.
 */

import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import cssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import { createRemoteSync } from '../../lib/controlledEditorSync.js';

globalThis.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

// VS Code-inspired dark theme. Inherits the vs-dark token colors and only
// retunes the UI chrome: #1e1e1e editor background (never pure black),
// subtle gutter, visible current line, restrained selection color.
function ensureSyncspaceTheme() {
  try {
    monaco.editor.defineTheme('syncspace-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#d4d4d4',
        'editor.lineHighlightBackground': '#2a2d2e',
        'editorLineNumber.foreground': '#858585',
        'editorLineNumber.activeForeground': '#c6c6c6',
        'editorCursor.foreground': '#aeafad',
        'editor.selectionBackground': '#264f78',
        'editor.inactiveSelectionBackground': '#3a3d41',
        'editorIndentGuide.background1': '#404040',
        'editorIndentGuide.activeBackground1': '#707070',
        'editorWidget.background': '#252526',
        'editorWidget.border': '#454545',
        'minimap.background': '#1e1e1e',
        'editorGutter.background': '#1e1e1e',
        'scrollbarSlider.background': '#79797966',
        'scrollbarSlider.hoverBackground': '#646464b3',
        'scrollbarSlider.activeBackground': '#bfbfbf66',
      },
    });
  } catch {
    // defineTheme is idempotent; never break editor creation on theming.
  }
}

// Panes narrower than this hide the minimap so code keeps usable width.
const MINIMAP_MIN_WIDTH = 600;

export default function CodeEditor({
  value = '',
  onChange,
  language = 'javascript',
  theme = 'syncspace-dark',
  ariaLabel = 'Shared code editor',
  // Accepted for contract compatibility with the textarea fallback, but
  // intentionally NOT passed to Monaco: the standalone editor has no
  // `placeholder` construction option, so claiming one would mislead.
  placeholder,
  disabled = false,
  className = '',
  // Optional IDE-shell integrations (both backward-compatible no-ops when
  // absent): the panel uses these for its live Ln/Col readout and to focus
  // the editor when the single shared document row is activated.
  onCursorChange,
  onEditorMount,
}) {
  void placeholder;
  const hostRef = useRef(null);
  const editorRef = useRef(null);
  const minimapEnabledRef = useRef(true);
  const syncRef = useRef(null);
  if (!syncRef.current) syncRef.current = createRemoteSync();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;
  const onEditorMountRef = useRef(onEditorMount);
  onEditorMountRef.current = onEditorMount;

  useEffect(() => {
    ensureSyncspaceTheme();
    const editor = monaco.editor.create(hostRef.current, {
      value,
      language,
      theme,
      ariaLabel,
      automaticLayout: true,
      readOnly: disabled,
      // Typography: VS Code-like mono stack at a comfortable density.
      fontSize: 14,
      lineHeight: 20,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
      fontLigatures: true,
      // Gutter + current line.
      lineNumbers: 'on',
      lineNumbersMinChars: 3,
      lineDecorationsWidth: 12,
      glyphMargin: false,
      renderLineHighlight: 'line',
      renderLineHighlightOnlyWhenFocus: false,
      // Brackets, guides, folding.
      matchBrackets: 'always',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      folding: true,
      foldingStrategy: 'auto',
      showFoldingControls: 'mouseover',
      autoClosingBrackets: 'always',
      autoClosingQuotes: 'always',
      autoSurround: 'languageDefined',
      // Indentation contract: the status bar shows "Spaces: 2" because the
      // editor genuinely inserts two spaces per tab.
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: false,
      // Scrolling + rulers.
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      cursorStyle: 'line',
      cursorBlinking: 'blink',
      roundedSelection: false,
      selectionHighlight: true,
      occurrencesHighlight: 'singleFile',
      scrollBeyondLastLine: false,
      scrollbar: {
        vertical: 'auto',
        horizontal: 'auto',
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
      },
      overviewRulerLanes: 2,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      // Minimap: subtle, no rendered characters; auto-hidden on narrow
      // panes by the ResizeObserver below.
      minimap: {
        enabled: true,
        scale: 1,
        renderCharacters: false,
        maxColumn: 120,
        showSlider: 'mouseover',
      },
      // Editing assistance already supported by the bundled workers.
      suggestOnTriggerCharacters: true,
      quickSuggestions: true,
      wordWrap: 'off',
      renderWhitespace: 'none',
      fixedOverflowWidgets: true,
      stickyScroll: { enabled: true },
      padding: { top: 12, bottom: 12 },
    });
    editorRef.current = editor;
    try {
      onEditorMountRef.current?.(editor);
    } catch {
      // host-provided callback — never break the editor
    }

    const contentSubscription = editor.onDidChangeModelContent(() => {
      syncRef.current.handleModelContent(() => editor.getValue(), onChangeRef.current);
    });
    const cursorSubscription = editor.onDidChangeCursorPosition((event) => {
      try {
        onCursorChangeRef.current?.({
          lineNumber: event?.position?.lineNumber ?? 1,
          column: event?.position?.column ?? 1,
        });
      } catch {
        // cursor readout is presentational — never throw into Monaco
      }
    });

    // Narrow split panes: hide the minimap so code keeps usable width.
    let widthObserver = null;
    try {
      if (typeof ResizeObserver !== 'undefined' && hostRef.current) {
        widthObserver = new ResizeObserver(() => {
          const width = hostRef.current?.clientWidth ?? 0;
          const shouldEnable = width >= MINIMAP_MIN_WIDTH;
          if (shouldEnable !== minimapEnabledRef.current) {
            minimapEnabledRef.current = shouldEnable;
            try {
              editor.updateOptions({ minimap: { enabled: shouldEnable } });
            } catch {
              // presentational toggle — never throw
            }
          }
        });
        widthObserver.observe(hostRef.current);
      }
    } catch {
      // ResizeObserver unavailable — minimap simply stays enabled
    }

    return () => {
      try {
        widthObserver?.disconnect();
      } catch {
        // ignore teardown failures
      }
      contentSubscription.dispose();
      cursorSubscription.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // Created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remote collaborators (or a reset) push a new value down: adopt it under
  // suppression so the model-content listener above does NOT re-enter
  // onChange (which would rebroadcast as a local edit → echo loop).
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    syncRef.current.applyRemote(
      () => editor.getValue(),
      (next) => editor.setValue(next),
      value,
    );
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
      className={`h-full min-h-0 w-full overflow-hidden bg-[#1e1e1e] ${className}`}
    />
  );
}
