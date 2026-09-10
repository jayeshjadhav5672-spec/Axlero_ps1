import React from 'react';
import WorkspaceHeader from '../layout/WorkspaceHeader';
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
    <div className={`flex min-h-screen flex-col ${className}`}>
      <WorkspaceHeader
        roomId={roomId}
        roomName={roomName}
        connectionStatus={connectionStatus}
        users={users}
        onLeaveRoom={onLeaveRoom}
        onShareRoom={onShareRoom}
      />
      <div id="workspace-content" className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-3 sm:px-4 sm:py-4">
        <div className="grid min-h-[calc(100vh-120px)] grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
          <WhiteboardPanel
            title="Whiteboard"
            isLoading={isWhiteboardLoading}
            error={whiteboardError}
            onRetry={onRetryWhiteboard}
          >
            {whiteboard}
          </WhiteboardPanel>
          <CodeEditorPanel
            title="Code Editor"
            language={editorLanguage}
            isLoading={isEditorLoading}
            error={editorError}
            onRetry={onRetryEditor}
          >
            {editor}
          </CodeEditorPanel>
        </div>
      </div>
    </div>
  );
}
