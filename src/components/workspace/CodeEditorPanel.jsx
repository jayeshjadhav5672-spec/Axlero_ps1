import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ensureSharedNode } from '../../lib/projectSync.js';
import {
  SHARED_FILE_ID,
  ancestorIds,
  childrenOf,
  colorForFileName,
  languageForFileName,
  makeNodeId,
  sharedFileNode,
  siblingNameTaken,
  validateItemName,
} from './fileTree.js';

/**
 * CodeEditorPanel — SyncSpace IDE shell around the Monaco editor.
 *
 * ARCHITECTURE: the Explorer tree is SHARED room state. The server
 * (server/socket.cjs) is the authority: creations are requested over
 * Socket.io, committed server-side, and fanned out to the room. Contents
 * converge per file with the same LWW rule as the legacy single document.
 * See docs/architecture.md. Local-only state (never broadcast): active
 * file, open tabs, selection, expansion, cursor, viewport, search.
 *
 * VS Code-inspired layout (activity bar + side panel + tabs + editor +
 * status bar):
 * - Explorer: New File / New Folder send create requests with an inline
 *   input (Enter sends, Esc cancels). The draft stays open until the server
 *   ack arrives (node opens) or rejects (reason shown inline, matched by
 *   request id). Names are validated client-side AND server-side;
 *   duplicates resolve first-commit-wins.
 * - Tabs represent opened files. Clicking switches the active file; each
 *   file keeps its own shared content while switching. Closing a tab never
 *   deletes anything.
 * - Monaco integration reuses the existing <CodeEditor /> through its
 *   `value` / `onChange` seam: the open file's shared text and change
 *   handler are injected on the SAME element type at the SAME position, so
 *   Monaco is never recreated when switching files.
 * - Search operates on the ACTUAL open document through the mounted Monaco
 *   instance (`getModel().findMatches()`); results navigate via
 *   `setPosition()` + `revealLineInCenter()`.
 * - The status bar shows only real state: the `connectionStatus` passed
 *   through Workspace, the live Monaco cursor, the active file's language,
 *   and "Spaces: 2" which matches Monaco's genuine tabSize.
 *
 * No Monaco / Yjs / Socket.io logic lives here — the editor arrives via
 * `children` (Kishan's <CodeEditor />) and is only injected with the
 * optional presentational callbacks `onCursorChange` / `onEditorMount`;
 * shared state arrives via the `project` prop (useCollaborativeProject).
 */

// Upper bound for displayed search matches (the count still reflects the
// full findMatches result length).
const MAX_SEARCH_RESULTS = 200;

const LANGUAGE_DISPLAY = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'LESS',
  python: 'Python',
  java: 'Java',
  csharp: 'C#',
  cpp: 'C++',
  c: 'C',
  go: 'Go',
  rust: 'Rust',
  ruby: 'Ruby',
  php: 'PHP',
  shell: 'Shell',
  yaml: 'YAML',
  xml: 'XML',
  markdown: 'Markdown',
  plaintext: 'Plain Text',
};

// Real connection states from useRoomConnection (via Workspace). Rendered
// for the dark status bar: white text + luminous dot.
const STATUS_META = {
  connected: { label: 'Connected', dot: 'bg-emerald-300' },
  connecting: { label: 'Connecting…', dot: 'bg-amber-300 animate-pulse' },
  reconnecting: { label: 'Reconnecting…', dot: 'bg-amber-300 animate-pulse' },
  disconnected: { label: 'Disconnected', dot: 'bg-rose-300' },
  error: { label: 'Connection error', dot: 'bg-rose-300' },
};

// Pane narrower than this collapses the side panel so Monaco keeps usable
// width in tight splits.
const NARROW_PANE_WIDTH = 520;

function languageDisplayName(language) {
  if (!language) return 'JavaScript';
  const key = String(language).toLowerCase();
  if (LANGUAGE_DISPLAY[key]) return LANGUAGE_DISPLAY[key];
  return String(language);
}

/**
 * Search the live Monaco model. Returns { total, matches } where matches
 * are capped for rendering. Never throws — search is presentational.
 */
function searchSharedDocument(editor, rawQuery) {
  const query = (rawQuery ?? '').trim();
  if (!query || !editor) return { total: 0, matches: [] };
  try {
    const model = editor.getModel?.();
    if (!model || typeof model.findMatches !== 'function') return { total: 0, matches: [] };
    const found = model.findMatches(query, false, false, false, null, false) ?? [];
    return {
      total: found.length,
      matches: found.slice(0, MAX_SEARCH_RESULTS).map((m, i) => {
        const lineNumber = m?.range?.startLineNumber ?? 1;
        const column = m?.range?.startColumn ?? 1;
        let preview = '';
        try {
          preview = (model.getLineContent(lineNumber) ?? '').trim();
        } catch {
          preview = '';
        }
        return { key: `${lineNumber}:${column}:${i}`, lineNumber, column, preview };
      }),
    };
  } catch {
    return { total: 0, matches: [] };
  }
}

function FileIcon({ color = '#8db9e2' }) {
  return (
    <svg className="h-4 w-4 shrink-0" style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 4h5l4 4v12H8a2 2 0 01-2-2V6a2 2 0 012-2z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 4v4h4" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg className="h-4 w-4 shrink-0 text-[#c09553]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5z" />
    </svg>
  );
}

function ActivityIcon({ d }) {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={d} />
    </svg>
  );
}

function RowActionIcon({ label, title, onClick, disabled = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      aria-label={label}
      title={title}
      className={`flex h-6 w-6 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
        disabled ? 'cursor-default text-[#5a5a5a]' : 'text-[#858585] hover:bg-[#2a2d2e] hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

export default function CodeEditorPanel({
  children,
  title = 'Code Editor',
  language = 'javascript',
  connectionStatus = 'disconnected',
  // Server-confirmed room join (room:joined ack for this room). Creation is
  // disabled until true: the server only runs socket.join(roomId) inside
  // room:join, so earlier requests are correctly rejected with "socket does
  // not belong to this room". Defaults true to preserve behavior wherever
  // the provider omits it; App always passes the real value.
  roomJoined = true,
  // Shared room project from useCollaborativeProject: { nodes, fileTexts,
  // createError, createNode, onFileChange, requestSnapshot,
  // clearCreateError }. Null only when the provider is absent (defensive
  // fallback renders the shared doc shell with creation disabled).
  project = null,
  isLoading = false,
  error = null,
  onRetry,
  className = '',
}) {
  const sectionRef = useRef(null);
  const slotRef = useRef(null);
  const editorInstanceRef = useRef(null);
  const contentListenerRef = useRef(null);
  const searchInputRef = useRef(null);
  const createCommittedRef = useRef(false);
  // Side panel state: which VS Code-style view is open ('explorer' |
  // 'search'), or null when the panel is collapsed for full-width code.
  const [openPanel, setOpenPanel] = useState('explorer');
  const [narrow, setNarrow] = useState(false);
  const [cursor, setCursor] = useState({ lineNumber: 1, column: 1 });
  // Local-only UI state (never broadcast): open tabs, active file,
  // selection, expansion. The TREE itself is shared (project.nodes).
  const [openIds, setOpenIds] = useState([SHARED_FILE_ID]);
  const [activeId, setActiveId] = useState(SHARED_FILE_ID);
  const [selectedId, setSelectedId] = useState(SHARED_FILE_ID);
  const [expandedIds, setExpandedIds] = useState([]);
  const [syncspaceExpanded, setSyncspaceExpanded] = useState(true);
  // Inline creation: { type: 'file' | 'folder', parentId, id } or null.
  // The id is minted at draft open so the server ack/error (matched by
  // request id) can finalize this exact draft.
  const [creating, setCreating] = useState(null);
  const [pendingCreateId, setPendingCreateId] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [draftError, setDraftError] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState({ total: 0, matches: [] });
  // Bumped on every local/remote model change so open search results stay
  // in sync with the open document.
  const [docVersion, setDocVersion] = useState(0);

  const fallbackSharedNode = useMemo(() => sharedFileNode(), []);
  // Authoritative tree (server) with an offline-first shared-doc fallback.
  const nodes = useMemo(
    () => ensureSharedNode(project?.nodes, fallbackSharedNode),
    [project?.nodes, fallbackSharedNode],
  );
  const nodeById = useCallback((id) => nodes.find((n) => n && n.id === id) ?? null, [nodes]);
  const activeFile = activeId ? nodeById(activeId) : null;
  const openFiles = useMemo(
    () => openIds.map((id) => nodeById(id)).filter(Boolean),
    [openIds, nodeById],
  );

  // Keep local tab/selection state consistent when the authoritative tree
  // changes (late join, reconnect, peer creates). Valid ids are never
  // disturbed — only vanished ids fall back.
  useEffect(() => {
    const valid = new Set(nodes.map((n) => n.id));
    setOpenIds((ids) => (ids.every((id) => valid.has(id)) ? ids : ids.filter((id) => valid.has(id))));
    setActiveId((current) => {
      if (current && valid.has(current)) return current;
      if (valid.has(SHARED_FILE_ID)) return SHARED_FILE_ID;
      const first = nodes[0];
      return first ? first.id : null;
    });
    setSelectedId((current) => {
      if (current && valid.has(current)) return current;
      return null;
    });
  }, [nodes]);

  // Collapse the side panel automatically when the pane itself (not just
  // the viewport) gets too narrow — the editor lives in a resizable split.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => {
      try {
        setNarrow((el.clientWidth || 0) < NARROW_PANE_WIDTH);
      } catch {
        // measurement failure — keep the full layout
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleCursorChange = useCallback((position) => {
    setCursor({
      lineNumber: Number(position?.lineNumber) || 1,
      column: Number(position?.column) || 1,
    });
  }, []);

  const handleEditorMount = useCallback((editor) => {
    editorInstanceRef.current = editor ?? null;
    try {
      contentListenerRef.current?.dispose?.();
    } catch {
      // ignore stale-listener teardown failures
    }
    contentListenerRef.current = null;
    if (editor) {
      try {
        contentListenerRef.current = editor.onDidChangeModelContent(() => {
          setDocVersion((v) => v + 1);
        });
      } catch {
        // cursor/content readout is presentational — never throw into Monaco
      }
      setDocVersion((v) => v + 1);
    }
  }, []);

  useEffect(
    () => () => {
      try {
        contentListenerRef.current?.dispose?.();
      } catch {
        // ignore unmount teardown failures
      }
      contentListenerRef.current = null;
    },
    [],
  );

  // Ctrl/Cmd + Shift + F opens Search. Monaco's standalone build does not
  // bind this chord, so there is no workbench shortcut to conflict with.
  useEffect(() => {
    const onKeyDown = (event) => {
      try {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.shiftKey &&
          (event.key === 'f' || event.key === 'F')
        ) {
          event.preventDefault();
          setOpenPanel('search');
        }
      } catch {
        // shortcut hint — never throw
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Focus the search box whenever the Search view opens.
  useEffect(() => {
    if (openPanel === 'search' && !narrow) {
      try {
        searchInputRef.current?.focus?.();
      } catch {
        // focus hint — never throw
      }
    }
  }, [openPanel, narrow]);

  // Re-run the search when the query changes or the open document does.
  useEffect(() => {
    setSearchResult(searchSharedDocument(editorInstanceRef.current, query));
  }, [query, docVersion]);

  // The editor instance only exists while a file is open; clear the stale
  // ref when the last tab closes so search/navigate degrade honestly.
  useEffect(() => {
    if (!activeId) editorInstanceRef.current = null;
  }, [activeId]);

  const focusEditorSoon = useCallback(() => {
    setTimeout(() => {
      try {
        editorInstanceRef.current?.focus?.();
      } catch {
        // focus hint — never throw
      }
    }, 0);
  }, []);

  // Open (and activate) a file. Content comes from shared per-file state.
  const openFile = useCallback((id) => {
    setOpenIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setActiveId(id);
    setSelectedId(id);
  }, []);

  const activateFile = useCallback((id) => {
    setActiveId(id);
    setSelectedId(id);
    focusEditorSoon();
  }, [focusEditorSoon]);

  const closeTab = useCallback((id) => {
    const remaining = openIds.filter((openId) => openId !== id);
    setOpenIds(remaining);
    setActiveId((current) => (current === id ? (remaining[remaining.length - 1] ?? null) : current));
    setSelectedId((selected) => (selected === id ? null : selected));
  }, [openIds]);

  const toggleFolder = useCallback((id) => {
    setExpandedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }, []);

  const collapseAll = useCallback(() => {
    setSyncspaceExpanded(false);
    setExpandedIds([]);
  }, []);

  // Shared content edits (EVERY file, including the shared doc): local
  // Lamport-bump + broadcast via the project hook. Never touches tree.
  const handleFileChange = useCallback((fileId, next) => {
    try {
      project?.onFileChange?.(fileId, next);
    } catch {
      // emit path — never throw into Monaco
    }
  }, [project]);

  // Creation target: selected folder, a file's parent, or the root.
  const creationParentId = useCallback(() => {
    const selected = selectedId ? nodeById(selectedId) : null;
    if (!selected) return null;
    if (selected.type === 'folder') return selected.id;
    return selected.parentId ?? null;
  }, [selectedId, nodeById]);

  const startCreating = useCallback((type, parentOverride) => {
    const parentId = parentOverride === undefined ? creationParentId() : parentOverride;
    setExpandedIds((ids) => {
      const chain = [parentId, ...ancestorIds(nodes, parentId)].filter(Boolean);
      return [...new Set([...ids, ...chain])];
    });
    setSyncspaceExpanded(true);
    setOpenPanel('explorer');
    createCommittedRef.current = false;
    setDraftError('');
    setDraftName('');
    setPendingCreateId(null);
    try {
      project?.clearCreateError?.();
    } catch {
      // never throw on UI affordance
    }
    setCreating({ type, parentId, id: makeNodeId() });
  }, [creationParentId, nodes, project]);

  // Commit only SENDS the request — the draft closes when the server ack
  // arrives (node opens) or rejects (reason shown inline, same draft).
  const commitCreating = useCallback(() => {
    if (!creating) return;
    const validation = validateItemName(draftName);
    if (!validation.ok) {
      setDraftError(validation.error);
      return;
    }
    if (siblingNameTaken(nodes, creating.parentId, validation.name)) {
      setDraftError('An item with this name already exists.');
      return;
    }
    if (!project) {
      setDraftError('Collaboration is unavailable — reconnect to create shared files.');
      return;
    }
    if (!roomJoined) {
      setDraftError('Still joining the room — wait for the connection, then try again.');
      return;
    }
    createCommittedRef.current = true;
    setPendingCreateId(creating.id);
    setDraftError('');
    try {
      project.createNode({ id: creating.id, name: validation.name, type: creating.type, parentId: creating.parentId });
    } catch {
      createCommittedRef.current = false;
      setPendingCreateId(null);
      setDraftError('Could not send the create request.');
    }
  }, [creating, draftName, nodes, project, roomJoined]);

  const cancelCreating = useCallback(() => {
    setCreating(null);
    setPendingCreateId(null);
    setDraftName('');
    setDraftError('');
  }, []);

  // Server ack: the requested node exists — finalize this exact draft.
  useEffect(() => {
    if (!pendingCreateId) return;
    const node = nodeById(pendingCreateId);
    if (!node) return;
    setPendingCreateId(null);
    setCreating(null);
    setDraftName('');
    setDraftError('');
    if (node.type === 'folder') {
      setExpandedIds((ids) => (ids.includes(node.id) ? ids : [...ids, node.id]));
      setSelectedId(node.id);
    } else {
      openFile(node.id);
      focusEditorSoon();
    }
  }, [nodes, pendingCreateId, nodeById, openFile, focusEditorSoon]);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
        setRenaming(null);
        setDeleteTarget(null);
      }
    };
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // Server rejection: surface the reason in the still-open draft.
  const createError = project?.createError ?? null;
  const operationError = project?.operationError ?? null;
  useEffect(() => {
    if (!createError || createError.requestId !== pendingCreateId || !creating) return;
    createCommittedRef.current = false;
    setDraftError(createError.message || 'The shared file could not be created.');
  }, [createError, pendingCreateId, creating]);

  const startRename = useCallback((node) => {
    setContextMenu(null);
    setRenaming({ id: node.id, name: node.name });
  }, []);

  const commitRename = useCallback(() => {
    if (!renaming || !project) return;
    const validation = validateItemName(renaming.name);
    if (!validation.ok) {
      setDraftError(validation.error);
      return;
    }
    if (siblingNameTaken(nodes.filter((node) => node.id !== renaming.id), nodeById(renaming.id)?.parentId, validation.name)) {
      setDraftError('An item with this name already exists.');
      return;
    }
    setDraftError('');
    project.renameNode({ id: renaming.id, name: validation.name });
    setRenaming(null);
  }, [nodes, nodeById, project, renaming]);

  const confirmDelete = useCallback(() => {
    if (!deleteTarget || !project) return;
    project.deleteNode(deleteTarget.id);
    setDeleteTarget(null);
    setContextMenu(null);
  }, [deleteTarget, project]);

  // Focusing the open document — used by the Explorer's shared row.
  const handleDocumentActivate = useCallback(() => {
    try {
      const editor = editorInstanceRef.current;
      if (editor && typeof editor.focus === 'function') {
        editor.focus();
        return;
      }
      slotRef.current?.querySelector?.('textarea, [tabindex]')?.focus?.();
    } catch {
      // focus hint — never throw
    }
  }, []);

  // Jump Monaco to a search hit: cursor move only, no content change, so
  // collaboration state is untouched.
  const navigateToMatch = useCallback((match) => {
    try {
      const editor = editorInstanceRef.current;
      if (!editor || !match) return;
      editor.setPosition({ lineNumber: match.lineNumber, column: match.column });
      editor.revealLineInCenter(match.lineNumber);
      editor.focus();
    } catch {
      // navigation hint — never throw
    }
  }, []);

  // Refresh re-syncs the authoritative snapshot (re-expand the root and
  // recompute results). Tree data comes from the server, not the network
  // of peers — nothing to fetch from anywhere else.
  const handleRefreshExplorer = useCallback(() => {
    setSyncspaceExpanded(true);
    setDocVersion((v) => v + 1);
    try {
      project?.requestSnapshot?.();
    } catch {
      // refresh hint — never throw
    }
  }, [project]);

  // Render the editor through the existing { value, onChange } seam. The
  // open file's SHARED text and change handler are injected on the SAME
  // element type at the SAME position, so Monaco is never recreated when
  // switching files.
  let editorChild = null;
  if (activeFile) {
    const fileOverrides = {
      value: project?.fileTexts?.[activeFile.id] ?? '',
      onChange: (next) => handleFileChange(activeFile.id, next),
      language: activeFile.id === SHARED_FILE_ID ? language : languageForFileName(activeFile.name),
    };
    editorChild = React.isValidElement(children)
      ? React.cloneElement(children, {
          onCursorChange: handleCursorChange,
          onEditorMount: handleEditorMount,
          ...fileOverrides,
        })
      : children;
  }

  const status = STATUS_META[connectionStatus] ?? STATUS_META.disconnected;
  // Keep Explorer actions present while the room is connecting. Narrow panes
  // may reduce the editor width, but must not remove the shared tree controls.
  const showSidePanel = openPanel !== null;
  const trimmedQuery = query.trim();
  const editorReady = Boolean(activeFile) && (Boolean(editorInstanceRef.current) || docVersion > 0);
  const searchStatusText = !editorReady
    ? 'Editor is not ready.'
    : trimmedQuery === ''
      ? 'Enter a query to search the open document.'
      : searchResult.total === 0
        ? 'No results'
        : `${searchResult.total} result${searchResult.total === 1 ? '' : 's'}${
            searchResult.total > searchResult.matches.length
              ? ` (showing first ${searchResult.matches.length})`
              : ''
          }`;
  const activeLanguage = activeFile && activeFile.id !== SHARED_FILE_ID
    ? languageForFileName(activeFile.name)
    : language;

  const renderDraftInput = (depth) => (
    <div className="px-1 py-0.5" style={{ paddingLeft: 8 + depth * 12 }}>
      <input
        autoFocus
        type="text"
        value={draftName}
        onChange={(event) => {
          setDraftName(event.target.value);
          setDraftError('');
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitCreating();
          } else if (event.key === 'Escape') {
            event.stopPropagation();
            cancelCreating();
          }
        }}
        onBlur={() => {
          if (!createCommittedRef.current) cancelCreating();
        }}
        placeholder={creating?.type === 'folder' ? 'Folder name' : 'filename.js'}
        aria-label={creating?.type === 'folder' ? 'New folder name' : 'New file name'}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full rounded border border-teal-400 bg-[#3c3c3c] px-2 py-1 text-[12px] text-white placeholder:text-[#858585] focus:outline-none"
      />
      {draftError !== '' && (
        <p role="alert" className="px-1 pt-1 text-[11px] leading-snug text-rose-300">
          {draftError}
        </p>
      )}
      <p className="px-1 pt-0.5 text-[10px] text-[#6e6e6e]">Enter to create · Esc to cancel</p>
    </div>
  );

  const renderRenameInput = (node, depth) => (
    <div className="px-1 py-0.5" style={{ paddingLeft: 12 + depth * 12 }}>
      <input
        autoFocus
        value={renaming?.name ?? ''}
        onChange={(event) => {
          setRenaming((current) => (current ? { ...current, name: event.target.value } : current));
          setDraftError('');
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitRename();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setRenaming(null);
          }
        }}
        aria-label={`Rename ${node.name}`}
        className="w-full rounded border border-teal-400 bg-[#3c3c3c] px-2 py-1 text-[12px] text-white focus:outline-none"
      />
    </div>
  );

  const renderFileRow = (node, depth) => {
    const isActive = node.id === activeId;
    const isSelected = node.id === selectedId;
    const isShared = node.id === SHARED_FILE_ID;
    if (renaming?.id === node.id) return <React.Fragment key={node.id}>{renderRenameInput(node, depth)}</React.Fragment>;
    return (
      <button
        key={node.id}
        type="button"
        onClick={() => {
          openFile(node.id);
          if (isShared) handleDocumentActivate();
          else focusEditorSoon();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ node, x: event.clientX, y: event.clientY });
        }}
        aria-current={isActive || undefined}
        title={isShared ? 'Focus the shared document' : node.name}
        className={`mx-1 flex items-center gap-2 rounded py-1.5 pr-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-400 ${
          isActive ? 'bg-[#37373d] text-white' : isSelected ? 'bg-[#2a2d2e] text-white' : 'text-[#cccccc] hover:bg-[#2a2d2e]'
        }`}
        style={{ paddingLeft: 12 + depth * 12 }}
      >
        <FileIcon color={isShared ? '#8db9e2' : colorForFileName(node.name)} />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
    );
  };

  const renderFolderRow = (node, depth) => {
    const expanded = expandedIds.includes(node.id);
    const isSelected = node.id === selectedId;
    if (renaming?.id === node.id) return <React.Fragment key={node.id}>{renderRenameInput(node, depth)}</React.Fragment>;
    return (
      <div key={node.id}>
        <button
          type="button"
          onClick={() => {
            setSelectedId(node.id);
            toggleFolder(node.id);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu({ node, x: event.clientX, y: event.clientY });
          }}
          aria-expanded={expanded}
          title={node.name}
          className={`mx-1 flex items-center gap-1.5 rounded py-1.5 pr-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-400 ${
            isSelected ? 'bg-[#2a2d2e] text-white' : 'text-[#cccccc] hover:bg-[#2a2d2e]'
          }`}
          style={{ paddingLeft: 12 + depth * 12 }}
        >
          <svg
            className={`h-3.5 w-3.5 shrink-0 text-[#858585] transition-transform ${expanded ? '' : '-rotate-90'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9l6 6 6-6" />
          </svg>
          <FolderIcon />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        </button>
        {expanded && (
          <div>
            {creating && creating.parentId === node.id && renderDraftInput(depth + 1)}
            {childrenOf(nodes, node.id).map((child) =>
              child.type === 'folder' ? renderFolderRow(child, depth + 1) : renderFileRow(child, depth + 1),
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <section
      ref={sectionRef}
      aria-label={title}
      role="region"
      className={`syncspace-ide flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-[#1e1e1e] text-[#cccccc] ${className}`}
    >
      <div className="flex min-h-0 w-full flex-1 flex-row overflow-hidden">
        {/* Activity bar — Explorer and Search only. */}
        <nav
          aria-label="Activity bar"
          className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-[#2b2b2b] bg-[#333333] py-2"
        >
          <button
            type="button"
            onClick={() => setOpenPanel((panel) => (panel === 'explorer' ? null : 'explorer'))}
            aria-expanded={openPanel === 'explorer'}
            aria-label="Explorer"
            title="Explorer"
            className={`relative flex h-10 w-10 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
              openPanel === 'explorer' ? 'text-white' : 'text-[#858585] hover:text-white'
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-white transition-opacity ${
                openPanel === 'explorer' ? 'opacity-100' : 'opacity-0'
              }`}
            />
            <ActivityIcon d="M8 4h5l4 4v12H8a2 2 0 01-2-2V6a2 2 0 012-2zM13 4v4h4M9 13h6M9 17h6" />
          </button>
          <button
            type="button"
            onClick={() => setOpenPanel((panel) => (panel === 'search' ? null : 'search'))}
            aria-expanded={openPanel === 'search'}
            aria-label="Search"
            title="Search (Ctrl+Shift+F)"
            className={`relative flex h-10 w-10 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
              openPanel === 'search' ? 'text-white' : 'text-[#858585] hover:text-white'
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-white transition-opacity ${
                openPanel === 'search' ? 'opacity-100' : 'opacity-0'
              }`}
            />
            <ActivityIcon d="M11 5a6 6 0 104.2 10.3L21 21l-1.4 1.4-5.8-5.8A6 6 0 0011 5z" />
          </button>
        </nav>

        {/* Explorer — the shared room project. */}
        {showSidePanel && openPanel === 'explorer' && (
          <aside
            aria-label="Explorer"
            className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-[#2b2b2b] bg-[#252526]"
          >
            <div className="flex items-center justify-between pl-4 pr-2 pt-3">
              <p className="pb-1 text-[11px] font-normal uppercase tracking-wider text-[#bbbbbb]">
                Explorer
              </p>
              <RowActionIcon
                label="More actions (not available)"
                title="More actions — not available in SyncSpace"
                disabled
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.5" />
                  <circle cx="12" cy="12" r="1.5" />
                  <circle cx="19" cy="12" r="1.5" />
                </svg>
              </RowActionIcon>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
              <div className="flex items-center gap-0.5 pr-1">
                <button
                  type="button"
                  onClick={() => setSyncspaceExpanded((expanded) => !expanded)}
                  aria-expanded={syncspaceExpanded}
                  aria-label="SyncSpace section"
                  title="SyncSpace"
                  className="flex min-w-0 flex-1 items-center gap-1 rounded px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#bbbbbb] transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-400"
                >
                  <svg
                    className={`h-3.5 w-3.5 shrink-0 transition-transform ${syncspaceExpanded ? '' : '-rotate-90'}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9l6 6 6-6" />
                  </svg>
                  <span className="min-w-0 flex-1 truncate">SyncSpace</span>
                </button>
                <div role="group" aria-label="Explorer actions" className="flex shrink-0 items-center">
                  <RowActionIcon
                    label="New File"
                    title={roomJoined ? 'New File' : 'New File (joining room…)'}
                    onClick={() => startCreating('file')}
                    disabled={!roomJoined}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 3v5h5" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 12v6M9 15h6" />
                    </svg>
                  </RowActionIcon>
                  <RowActionIcon
                    label="New Folder"
                    title={roomJoined ? 'New Folder' : 'New Folder (joining room…)'}
                    onClick={() => startCreating('folder')}
                    disabled={!roomJoined}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 11v6M9 14h6" />
                    </svg>
                  </RowActionIcon>
                  <RowActionIcon
                    label="Refresh Explorer"
                    title="Refresh Explorer"
                    onClick={handleRefreshExplorer}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M1 4v6h6M23 20v-6h-6" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.5 9A9 9 0 005.6 5.6L1 10m22 4l-4.6 4.4A9 9 0 013.5 15" />
                    </svg>
                  </RowActionIcon>
                  <RowActionIcon
                    label="Collapse All"
                    title="Collapse All"
                    onClick={collapseAll}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5h10M11 12h10M11 19h10" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4L3 7l4 3M7 11l-4 3 4 3M7 18l-4 3 4 3" />
                    </svg>
                  </RowActionIcon>
                </div>
              </div>
              {syncspaceExpanded && (
                <div>
                  {creating && creating.parentId === null && renderDraftInput(0)}
                  {childrenOf(nodes, null).map((node) =>
                    node.type === 'folder' ? renderFolderRow(node, 0) : renderFileRow(node, 0),
                  )}
                  <p className="px-4 pt-3 text-[11px] leading-relaxed text-[#858585]">
                    Shared workspace — visible to everyone in this room.
                  </p>
                  {operationError && (
                    <p role="alert" className="px-4 pt-2 text-[11px] leading-snug text-rose-300">
                      {operationError.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}

        {/* Search — queries the open document via Monaco's findMatches; a
            hit moves the real editor cursor + viewport. */}
        {showSidePanel && openPanel === 'search' && (
          <aside
            aria-label="Search"
            className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-[#2b2b2b] bg-[#252526]"
          >
            <p className="px-4 pb-1 pt-3 text-[11px] font-normal uppercase tracking-wider text-[#bbbbbb]">
              Search
            </p>
            <div className="px-3 pb-2">
              <div className="relative">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      setOpenPanel('explorer');
                    }
                  }}
                  placeholder="Search"
                  aria-label="Search the open document"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full rounded border border-[#3c3c3c] bg-[#3c3c3c] py-1 pl-2 pr-7 text-[12px] text-white placeholder:text-[#858585] focus:border-teal-400 focus:outline-none"
                />
                {query !== '' && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    title="Clear search"
                    className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-[#858585] transition-colors hover:bg-[#2a2d2e] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                )}
              </div>
              <p role="status" aria-live="polite" className="px-1 pt-1.5 text-[11px] text-[#858585]">
                {searchStatusText}
              </p>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
              {searchResult.matches.length > 0 && (
                <ul className="flex flex-col">
                  {searchResult.matches.map((match) => (
                    <li key={match.key}>
                      <button
                        type="button"
                        onClick={() => navigateToMatch(match)}
                        aria-label={`Go to line ${match.lineNumber} in ${activeFile?.name ?? 'the open document'}`}
                        title={`Line ${match.lineNumber}`}
                        className="flex w-full flex-col gap-0.5 rounded px-4 py-1.5 text-left transition-colors hover:bg-[#2a2d2e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-400"
                      >
                        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-white">
                          <FileIcon color={activeFile && activeFile.id !== SHARED_FILE_ID ? colorForFileName(activeFile.name) : '#8db9e2'} />
                          <span className="min-w-0 flex-1 truncate">{activeFile?.name ?? 'Open document'}</span>
                        </span>
                        <span className="min-w-0 truncate pl-6 font-mono text-[11px] text-[#858585]">
                          Line {match.lineNumber}: {match.preview !== '' ? match.preview : '(empty line)'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        )}

        {contextMenu && (
          <div
            role="menu"
            aria-label={`${contextMenu.node.name} actions`}
            onClick={(event) => event.stopPropagation()}
            className="fixed z-50 min-w-36 rounded border border-[#454545] bg-[#252526] py-1 shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.node.type === 'folder' && (
              <>
                <button type="button" role="menuitem" onClick={() => { setSelectedId(contextMenu.node.id); startCreating('file', contextMenu.node.id); setContextMenu(null); }} className="block w-full px-3 py-1.5 text-left text-[12px] text-[#cccccc] hover:bg-[#094771]">New File</button>
                <button type="button" role="menuitem" onClick={() => { setSelectedId(contextMenu.node.id); startCreating('folder', contextMenu.node.id); setContextMenu(null); }} className="block w-full px-3 py-1.5 text-left text-[12px] text-[#cccccc] hover:bg-[#094771]">New Folder</button>
              </>
            )}
            {contextMenu.node.id !== SHARED_FILE_ID && (
              <>
                <button type="button" role="menuitem" onClick={() => startRename(contextMenu.node)} className="block w-full px-3 py-1.5 text-left text-[12px] text-[#cccccc] hover:bg-[#094771]">Rename</button>
                <button type="button" role="menuitem" onClick={() => { setDeleteTarget(contextMenu.node); setContextMenu(null); }} className="block w-full px-3 py-1.5 text-left text-[12px] text-[#fca5a5] hover:bg-[#094771]">Delete</button>
              </>
            )}
          </div>
        )}

        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
            <div role="dialog" aria-modal="true" aria-labelledby="delete-project-item-title" className="w-full max-w-sm rounded border border-[#454545] bg-[#252526] p-4 shadow-2xl">
              <h2 id="delete-project-item-title" className="text-sm font-semibold text-white">Delete {deleteTarget.type === 'folder' ? 'folder' : 'file'}?</h2>
              <p className="mt-2 text-xs leading-relaxed text-[#cccccc]">
                {deleteTarget.type === 'folder' ? `Delete “${deleteTarget.name}” and all its contents?` : `Delete “${deleteTarget.name}”?`}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setDeleteTarget(null)} className="rounded px-3 py-1.5 text-xs text-[#cccccc] hover:bg-[#3c3c3c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400">Cancel</button>
                <button type="button" onClick={confirmDelete} className="rounded bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400">Delete</button>
              </div>
            </div>
          </div>
        )}

        {/* Editor column: tabs + editor. No breadcrumbs — no hierarchy. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#1e1e1e]">
          <div role="tablist" aria-label="Open documents" className="flex h-9 shrink-0 items-stretch overflow-x-auto bg-[#252526]">
            {openFiles.map((file) => {
              const isActive = file.id === activeId;
              const isShared = file.id === SHARED_FILE_ID;
              return (
                <div
                  key={file.id}
                  role="tab"
                  aria-selected={isActive}
                  title={file.name}
                  className={`relative flex min-w-0 max-w-52 shrink-0 items-center gap-2 px-3 text-[12px] ${
                    isActive ? 'bg-[#1e1e1e] text-white' : 'text-[#858585] hover:text-white'
                  }`}
                >
                  {isActive && (
                    <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-teal-400" />
                  )}
                  <button
                    type="button"
                    onClick={() => activateFile(file.id)}
                    aria-label={`Open ${file.name}`}
                    title={file.name}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                  >
                    <FileIcon color={isShared ? '#8db9e2' : colorForFileName(file.name)} />
                    <span className="min-w-0 flex-1 truncate text-left">{file.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(file.id);
                    }}
                    aria-label={`Close ${file.name}`}
                    title={`Close ${file.name}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#858585] transition-colors hover:bg-[#2a2d2e] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>

          <div ref={slotRef} className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
            {isLoading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#1e1e1e]/90">
                <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-teal-500 border-t-transparent" aria-hidden="true" />
                <span className="text-sm text-[#858585]">Loading editor…</span>
              </div>
            )}
            {error && !isLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#1e1e1e]/95 p-4">
                <div className="max-w-sm text-center">
                  <p className="font-medium text-rose-300">Editor failed to load</p>
                  <p className="mb-4 mt-1 text-sm text-[#858585]">{error}</p>
                  {onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e1e1e]"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            )}
            {!isLoading && !error && !activeFile && (
              <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <svg className="h-10 w-10 text-[#5a5a5a]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                <p className="font-mono text-sm text-[#858585]">No file open</p>
                <p className="max-w-xs text-xs leading-relaxed text-[#5a5a5a]">
                  Pick a file in the Explorer to start editing. Closing a tab never deletes its content.
                </p>
              </div>
            )}
            {!isLoading && !error && activeFile && !children && (
              <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <svg className="h-10 w-10 text-[#5a5a5a]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                <p className="font-mono text-sm text-[#858585]">Editor integration point</p>
                <p className="max-w-xs text-xs leading-relaxed text-[#5a5a5a]">
                  The Monaco collaboration editor mounts here. No editor logic is bundled with the workspace shell.
                </p>
              </div>
            )}
            {editorChild}
          </div>
        </div>
      </div>

      {/* Status bar — only real state. Connection comes from Workspace;
          cursor is the live Monaco position; "Spaces: 2" matches the
          editor's genuine tabSize; UTF-8 is Monaco's encoding. */}
      <footer className="flex h-6 shrink-0 items-center gap-3 bg-[#0f766e] px-3 text-[11px] text-white">
        <span role="status" className="inline-flex min-w-0 items-center gap-1.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} aria-hidden="true" />
          <span className="truncate">{status.label}</span>
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-3">
          <span aria-label={`Line ${cursor.lineNumber}, column ${cursor.column}`}>
            Ln {cursor.lineNumber}, Col {cursor.column}
          </span>
          {!narrow && <span>Spaces: 2</span>}
          {!narrow && <span>UTF-8</span>}
          <span>{languageDisplayName(activeLanguage)}</span>
        </span>
      </footer>
    </section>
  );
}
