import React, { useState } from 'react';
import { ConnectionStatus } from '../connection';
import { PeoplePanel, PresenceList } from '../presence';
import { RoomInfo } from '../room';

/**
 * WorkspaceLayout — Day 1 floating workspace architecture
 * (FigJam / Excalidraw-grade glassmorphism).
 *
 * Replaces the rigid sidebar/split-bar shell with floating layers over a
 * full-screen canvas viewport:
 *
 * - Canvas viewport: absolute `inset: 0` — the Konva stage spans the whole
 *   window with no scrollbars (`workspace-canvas-viewport` token class).
 * - Top header capsule: floating pill with project title, room connection
 *   status, sync indicator, and presence avatars (`glass-dock`).
 * - Bottom toolbar dock: centered pill hovering over the canvas
 *   (`glass-dock`). Renders the `toolbarDock` slot when provided — the
 *   Whiteboard owns its own internal toolbar, so this is a reserved mount
 *   point, not a duplicate toolbar.
 * - Right inspector dock: collapsible glass drawer (`glass-card`) that
 *   slides in when a shape is selected (`workspace-inspector`).
 * - Optional `sidePanel` (e.g. code editor): collapsible floating card
 *   docked to the left so the canvas never reflows.
 *
 * All live data arrives via props — no Socket.io / Yjs / Konva logic here.
 */

function SyncIndicator({ connectionStatus, syncState }) {
  const syncing = syncState === 'saving' || connectionStatus === 'reconnecting' || connectionStatus === 'connecting';
  const live = connectionStatus === 'connected' && !syncing;
  const label = connectionStatus === 'connected' ? (syncState === 'saving' ? 'Syncing…' : 'Synced') : 'Offline';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-sunken)',
        color: 'var(--text-muted)',
      }}
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
  /** Canvas content (Konva <Whiteboard />). Fills the viewport inset:0. */
  whiteboard = null,
  /** Optional node mounted inside the floating bottom pill dock. */
  toolbarDock = null,
  /** Optional node mounted inside the right inspector drawer. */
  inspector = null,
  /** Selection-driven visibility for the inspector drawer. */
  hasSelection = false,
  inspectorOpen,
  onCloseInspector,
  /** Optional collapsible floating panel (e.g. code editor). */
  sidePanel = null,
  sidePanelTitle = 'Panel',
  sidePanelOpen: controlledSidePanelOpen,
  onToggleSidePanel,
  defaultSidePanelOpen = false,
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

  return (
    <div
      className={`relative h-dvh max-h-dvh w-screen select-none overflow-hidden ${className}`}
      style={{ background: 'var(--bg-canvas)', color: 'var(--text-main)' }}
      data-testid="workspace-layout"
    >
      {/* ---- Canvas viewport: full-screen absolute, no scrollbars ---- */}
      <div className="workspace-canvas-viewport" data-testid="workspace-canvas-viewport">
        {whiteboard}
      </div>

      {/* ---- Top floating header capsule ---- */}
      <header
        role="banner"
        className="glass-dock absolute left-1/2 top-4 z-20 flex w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-5"
        data-testid="workspace-header-capsule"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <svg
            className="h-5 w-5 shrink-0"
            style={{ color: 'var(--accent-primary)' }}
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
              className="flex items-center rounded-full p-0.5 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2"
              style={{ ['--tw-ring-color']: 'var(--accent-primary)' }}
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
              className="rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2"
              style={{
                background: sideOpen ? 'var(--accent-primary)' : 'var(--bg-sunken)',
                color: sideOpen ? 'var(--accent-on-accent)' : 'var(--text-muted)',
                border: '1px solid var(--border-subtle)',
                ['--tw-ring-color']: 'var(--accent-primary)',
              }}
            >
              {sidePanelTitle}
            </button>
          )}
        </span>
      </header>

      {/* ---- Optional floating side panel (code editor) ---- */}
      {sidePanel && (
        <aside
          aria-label={sidePanelTitle}
          data-open={sideOpen}
          className="workspace-inspector glass-card absolute bottom-24 left-4 top-24 z-10 flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden"
          style={{ borderRadius: 'var(--radius-panel)', transform: sideOpen ? undefined : 'translateX(calc(-100% - 24px))' }}
          data-testid="workspace-side-panel"
        >
          {sidePanel}
        </aside>
      )}

      {/* ---- Right contextual property inspector dock ---- */}
      <aside
        aria-label="Shape properties"
        data-open={drawerOpen}
        className="workspace-inspector glass-card absolute bottom-24 right-4 top-24 z-10 flex w-[var(--inspector-w)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden"
        style={{ borderRadius: 'var(--radius-panel)' }}
        data-testid="workspace-inspector"
        aria-hidden={!drawerOpen}
      >
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
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

      {/* ---- Floating bottom toolbar dock ---- */}
      {toolbarDock && (
        <div
          className="glass-dock absolute bottom-5 left-1/2 z-20 max-w-[calc(100vw-2rem)] -translate-x-1/2 px-3 py-2"
          role="toolbar"
          aria-label="Canvas tools"
          data-testid="workspace-toolbar-dock"
        >
          {toolbarDock}
        </div>
      )}
    </div>
  );
}
