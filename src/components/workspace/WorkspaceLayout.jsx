import React, { useState } from 'react';
import { ConnectionStatus } from '../connection';
import { PeoplePanel, PresenceList } from '../presence';
import { RoomInfo } from '../room';
import WorkspaceSplitLayout from '../layout/WorkspaceSplitLayout';

/**
 * WorkspaceLayout — Day 1 floating workspace architecture
 * (FigJam / Excalidraw-grade glassmorphism, scoped).
 *
 * Structure is a plain in-flow flex column — NEVER an absolute full-screen
 * `inset: 0` root — so panels sit side-by-side instead of stacking:
 *
 *   header capsule (in flow)
 *   main split row: [ canvas pane (left/center, flex-1) | code pane (right) ]
 *
 * Glassmorphism tokens are scoped ONLY to floating chrome:
 * - Top header capsule (`glass-dock` pill, in normal flow, centered).
 * - Bottom toolbar dock (`glass-dock` pill, absolute *inside the canvas
 *   pane only* — it can never cover the code editor panel).
 * - Right inspector drawer (`glass-card`, absolute *inside the canvas
 *   pane only*, slides in on selection and overlays just canvas pixels).
 *
 * The Whiteboard owns its internal Toolbar + PropertySidebar; the dock /
 * inspector slots are reserved mount points, not duplicate chrome.
 *
 * All live data arrives via props — no Socket.io / Yjs / Konva logic here.
 */

function SyncIndicator({ connectionStatus, syncState }) {
  const syncing = syncState === 'saving' || connectionStatus === 'reconnecting' || connectionStatus === 'connecting';
  const live = connectionStatus === 'connected' && !syncing;
  const label = connectionStatus === 'connected' ? (syncState === 'saving' ? 'Syncing…' : 'Synced') : 'Offline';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-[#0f172a]"
      role="status"
      aria-live="polite"
      title={label}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background: live ? 'var(--status-live)' : syncing ? 'var(--status-reconnecting)' : 'var(--status-offline)',
          boxShadow: live ? '0 0 6px var(--status-live)' : undefined,
        }}
      />
      {label}
    </span>
  );
}

export default function WorkspaceLayout({
  roomId,
  roomName,
  projectTitle,
  connectionStatus = 'disconnected',
  /** 'live' | 'saving' | 'offline' — overrides the derived sync label. */
  syncState,
  users = [],
  currentUserId = null,
  onLeaveRoom,
  onShareRoom,
  /** Canvas content (Konva <Whiteboard />). Fills the canvas pane. */
  whiteboard = null,
  /** Optional node mounted in the floating bottom pill dock (canvas pane). */
  toolbarDock = null,
  /** Optional node mounted in the canvas-pane inspector drawer. */
  inspector = null,
  /** Selection-driven visibility for the inspector drawer. */
  hasSelection = false,
  inspectorOpen,
  onCloseInspector,
  /** Code editor panel node (e.g. <CodeEditorPanel />). Right split pane. */
  sidePanel = null,
  sidePanelTitle = 'Code Editor',
  sidePanelOpen: controlledSidePanelOpen,
  onToggleSidePanel,
  defaultSidePanelOpen = true,
  className = '',
}) {
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [internalSideOpen, setInternalSideOpen] = useState(defaultSidePanelOpen);

  const sideOpen = controlledSidePanelOpen ?? internalSideOpen;
  const handleToggleSide = onToggleSidePanel ?? (() => setInternalSideOpen((v) => !v));

  // Uncontrolled by default: drawer follows selection unless the parent
  // takes control via `inspectorOpen`.
  const drawerOpen = inspectorOpen ?? hasSelection;

  const title = projectTitle ?? roomName ?? (roomId ? `Room ${roomId}` : 'Untitled board');
  const showCodePane = Boolean(sidePanel) && sideOpen;

  // Canvas pane: in-flow flex child. The toolbar dock + inspector are
  // absolutely positioned *within this pane*, so they overlay only canvas
  // pixels and can never hide the code editor or header.
  const canvasPane = (
    <div className="workspace-canvas-viewport" data-testid="workspace-canvas-viewport">
      {whiteboard}

      {toolbarDock && (
        <div
          className="glass-dock absolute bottom-4 left-1/2 z-20 max-w-[calc(100%-2rem)] -translate-x-1/2 px-3 py-2"
          role="toolbar"
          aria-label="Canvas tools"
          data-testid="workspace-toolbar-dock"
        >
          {toolbarDock}
        </div>
      )}

      <aside
        aria-label="Shape properties"
        data-open={drawerOpen}
        className="workspace-inspector glass-card absolute bottom-4 right-3 top-3 z-10 flex w-[var(--inspector-w)] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden"
        style={{ borderRadius: 'var(--radius-panel)' }}
        data-testid="workspace-inspector"
        aria-hidden={!drawerOpen}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-2.5"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Properties
          </span>
          {onCloseInspector && (
            <button
              type="button"
              onClick={onCloseInspector}
              aria-label="Close properties panel"
              className="rounded-full px-2 py-1 text-xs transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2"
              style={{ color: 'var(--text-muted)', ['--tw-ring-color']: 'var(--accent-primary)' }}
            >
              ✕
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {inspector ?? (
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Select a shape on the canvas to edit its properties.
            </p>
          )}
        </div>
      </aside>
    </div>
  );

  return (
    <div
      className={`flex h-dvh max-h-dvh w-screen select-none flex-col overflow-hidden ${className}`}
      style={{ background: 'var(--bg-canvas)', color: 'var(--text-main)' }}
      data-testid="workspace-layout"
    >
      {/* ---- Top floating header capsule (in flow — reserves its own row) ---- */}
      <header
        role="banner"
        className="workspace-header-capsule mx-auto mt-3 flex w-[calc(100%-2rem)] max-w-3xl shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-5"
        data-testid="workspace-header-capsule"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <svg
            className="h-5 w-5 shrink-0 text-[#0f172a]"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span className="truncate text-sm font-bold tracking-tight" style={{ color: 'var(--text-main)' }}>
            {title}
          </span>
          <span className="hidden shrink-0 sm:inline">
            <RoomInfo roomId={roomId} roomName={roomName} onLeave={onLeaveRoom} onShare={onShareRoom} />
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2 sm:gap-3">
          <ConnectionStatus status={connectionStatus} showLabel={false} />
          <SyncIndicator connectionStatus={connectionStatus} syncState={syncState} />
          <span className="relative">
            <button
              type="button"
              onClick={() => setPeopleOpen((open) => !open)}
              aria-haspopup="dialog"
              aria-expanded={peopleOpen}
              aria-label={`People in this room, ${users.length} participant${users.length === 1 ? '' : 's'}`}
              className="flex items-center rounded-full p-0.5 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111827]"
            >
              <PresenceList users={users} maxVisible={4} />
            </button>
            {peopleOpen && (
              <PeoplePanel
                users={users}
                currentUserId={currentUserId}
                onClose={() => setPeopleOpen(false)}
                className="absolute right-0 top-[calc(100%+8px)] z-30"
              />
            )}
          </span>
          {sidePanel && (
            <button
              type="button"
              onClick={handleToggleSide}
              aria-expanded={sideOpen}
              aria-label={sideOpen ? `Hide ${sidePanelTitle}` : `Show ${sidePanelTitle}`}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111827] ${
                sideOpen
                  ? 'border-transparent bg-[#111827] text-white hover:bg-[#374151]'
                  : 'border-slate-200 bg-slate-100/80 text-[#0f172a] hover:bg-slate-200'
              }`}
            >
              {sidePanelTitle}
            </button>
          )}
        </span>
      </header>

      {/* ---- Main split: canvas (left/center) + code editor (right) ---- */}
      <main id="workspace-content" className="flex min-h-0 w-full flex-1 flex-col overflow-hidden p-3">
        {showCodePane ? (
          <WorkspaceSplitLayout whiteboardComponent={canvasPane} codeEditorComponent={sidePanel} />
        ) : (
          <div className="flex min-h-0 w-full flex-1 flex-row overflow-hidden">{canvasPane}</div>
        )}
      </main>
    </div>
  );
}
