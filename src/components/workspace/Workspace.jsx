import React from 'react';
import WorkspaceHeader from '../layout/WorkspaceHeader';
import WorkspaceSplitLayout from '../layout/WorkspaceSplitLayout';
import WhiteboardPanel from './WhiteboardPanel';
import CodeEditorPanel from './CodeEditorPanel';

/**
 * Workspace — Avantee (React UI / Frontend Engineer)
 *
 * Composes the collaborative workspace: header + whiteboard panel +
 * code editor panel. Pure UI composition — no Socket.io, Yjs, Konva
 * drawing, Monaco, or backend logic.
 *
 * Integration contract:
 * - Sayon: pass <Whiteboard /> as `whiteboard`
 * - Kishan: pass <CodeEditor /> as `editor`
 * - Shree: pass awareness users as `users`
 * - Arun: pass socket state as `connectionStatus`
 */
export default function Workspace({
  roomId,
  roomName,
  connectionStatus = 'disconnected',
  users = [],
  whiteboard,
  editor,
  editorLanguage,
  isWhiteboardLoading = false,
  isEditorLoading = false,
  whiteboardError = null,
  editorError = null,
  onRetryWhiteboard,
  onRetryEditor,
  onLeaveRoom,
  onShareRoom,
  className = '',
}) {
  return (
    <div className={`h-dvh max-h-dvh w-screen flex flex-col overflow-hidden bg-white select-none ${className}`}>
      {/* Top Navbar stays fixed at its natural height */}
      <header className="shrink-0 border-b border-slate-200 bg-white z-20">
        <WorkspaceHeader
          roomId={roomId}
          roomName={roomName}
          connectionStatus={connectionStatus}
          users={users}
          onLeaveRoom={onLeaveRoom}
          onShareRoom={onShareRoom}
        />
      </header>

      {/* Main split area occupies remaining vertical space with zero overflow.
      Scoped split-pane: toolbar lives inside the whiteboard column
      (Whiteboard owns its Toolbar), so it stretches/shrinks/follows its
      parent pane on resize or swap. Layout is strictly local — no socket
      emits, persisted per-browser via localStorage. */}
      <main id="workspace-content" className="flex-1 min-h-0 w-full overflow-hidden flex flex-col">
        <WorkspaceSplitLayout
          whiteboardComponent={
            <WhiteboardPanel
              title="Whiteboard"
              isLoading={isWhiteboardLoading}
              error={whiteboardError}
              onRetry={onRetryWhiteboard}
            >
              {whiteboard}
            </WhiteboardPanel>
          }
          codeEditorComponent={
            <CodeEditorPanel
              title="Code Editor"
              language={editorLanguage}
              isLoading={isEditorLoading}
              error={editorError}
              onRetry={onRetryEditor}
            >
              {editor}
            </CodeEditorPanel>
          }
        />
      </main>
    </div>
  );
}
