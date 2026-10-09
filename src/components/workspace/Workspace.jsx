import React from 'react';
import WorkspaceLayout from './WorkspaceLayout';
import WhiteboardPanel from './WhiteboardPanel';
import CodeEditorPanel from './CodeEditorPanel';

/**
 * Workspace — Avantee (React UI / Frontend Engineer)
 *
 * Day 1: recomposed onto the floating WorkspaceLayout architecture. The
 * Konva canvas fills a full-screen viewport (`inset: 0`); the header is a
 * floating glass capsule; the code editor docks as a collapsible floating
 * panel; the right inspector drawer is reserved for shape selection.
 *
 * Integration contract (unchanged):
 * - Sayon: pass <Whiteboard /> as `whiteboard` (owns its Toolbar +
 *   PropertySidebar internally; layout docks stay reserved, not duplicated)
 * - Kishan: pass <CodeEditor /> as `editor` (panel injects value/onChange)
 * - Shree: pass awareness users as `users`
 * - Arun: pass socket state as `connectionStatus`
 * - Project: pass useCollaborativeProject state as `project` (shared tree
 *   + per-file contents; active file / tabs stay panel-local)
 */
export default function Workspace({
  roomId,
  roomName,
  connectionStatus = 'disconnected',
  // Server-confirmed room join (room:joined ack). Shared-project writes are
  // only servable once this is true — see useRoomConnection + panel gating.
  roomJoined = true,
  users = [],
  // Local identity's user id for the header people panel ("You" row).
  currentUserId = null,
  whiteboard,
  editor,
  project = null,
  editorLanguage,
  isWhiteboardLoading = false,
  isEditorLoading = false,
  whiteboardError = null,
  editorError = null,
  onRetryWhiteboard,
  onRetryEditor,
  onLeaveRoom,
  onShareRoom,
  onRunCode = null,
  isExecuting = false,
  // Reserved floating-dock slots. The Whiteboard renders its own toolbar +
  // property sidebar, so these default to null (docks stay hidden) — pass
  // explicit nodes to mount external chrome in the floating shells.
  toolbarDock = null,
  inspector = null,
  hasSelection = false,
  inspectorOpen,
  onCloseInspector,
  syncState,
  sidePanelOpen,
  onToggleSidePanel,
  defaultSidePanelOpen = false,
  className = '',
}) {
  return (
    <WorkspaceLayout
      roomId={roomId}
      roomName={roomName}
      connectionStatus={connectionStatus}
      syncState={syncState}
      users={users}
      currentUserId={currentUserId}
      onLeaveRoom={onLeaveRoom}
      onShareRoom={onShareRoom}
      toolbarDock={toolbarDock}
      inspector={inspector}
      hasSelection={hasSelection}
      inspectorOpen={inspectorOpen}
      onCloseInspector={onCloseInspector}
      sidePanelTitle="Code Editor"
      sidePanelOpen={sidePanelOpen}
      onToggleSidePanel={onToggleSidePanel}
      defaultSidePanelOpen={defaultSidePanelOpen}
      className={className}
      whiteboard={
        <WhiteboardPanel
          title="Whiteboard"
          isLoading={isWhiteboardLoading}
          error={whiteboardError}
          onRetry={onRetryWhiteboard}
          className="bg-transparent p-0 pl-0"
        >
          {whiteboard}
        </WhiteboardPanel>
      }
      sidePanel={
        <CodeEditorPanel
          title="Code Editor"
          language={editorLanguage}
          connectionStatus={connectionStatus}
          roomJoined={roomJoined}
          project={project}
          isLoading={isEditorLoading}
          error={editorError}
          onRetry={onRetryEditor}
          onRunCode={onRunCode}
          isExecuting={isExecuting}
        >
          {editor}
        </CodeEditorPanel>
      }
    />
  );
}
