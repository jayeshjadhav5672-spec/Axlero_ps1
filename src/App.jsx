import AppLayout from './components/layout/AppLayout';
import Workspace from './components/workspace/Workspace';
import { Whiteboard } from './components/canvas';

/* ------------------------------------------------------------------
 * Integration shell (Avantee, UI).
 * Static placeholder props stand in for real modules until they land:
 * - room: Vaishnavi (MongoDB / auth / session)
 * - users: Shree (Yjs awareness)
 * - connectionStatus: Arun (Socket.io). 'disconnected' is the honest
 *   default — no socket is wired yet, so the shell claims nothing live.
 * - editor child: Kishan (Monaco collaboration)
 * This file must stay free of Socket.io / Yjs / auth / sync logic.
 * ------------------------------------------------------------------ */
const PLACEHOLDER_ROOM_ID = 'architecture-01';
const PLACEHOLDER_ROOM_NAME = 'Architecture Review';
const PLACEHOLDER_USERS = [
  { id: 'placeholder-alex', name: 'Alex Rivera', colorClass: 'bg-teal-600', isActive: true },
  { id: 'placeholder-sam', name: 'Sam Chen', colorClass: 'bg-indigo-600', isActive: true },
  { id: 'placeholder-priya', name: 'Priya Nair', colorClass: 'bg-amber-600', isActive: false },
];
const PLACEHOLDER_CONNECTION_STATUS = 'disconnected';
const PLACEHOLDER_EDITOR_LANGUAGE = 'typescript';

export default function App() {
  const handleShareRoom = () => {
    // TODO(Vaishnavi): replace with real invite flow. Copies the URL only.
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(window.location.href).catch(() => {});
    }
  };

  const handleLeaveRoom = () => {
    // TODO(Vaishnavi): wire real session leave. Intentionally a no-op —
    // the shell must not fake connectivity or session changes.
  };

  return (
    <AppLayout>
      <Workspace
        roomId={PLACEHOLDER_ROOM_ID}
        roomName={PLACEHOLDER_ROOM_NAME}
        connectionStatus={PLACEHOLDER_CONNECTION_STATUS}
        users={PLACEHOLDER_USERS}
        whiteboard={<Whiteboard />}
        editorLanguage={PLACEHOLDER_EDITOR_LANGUAGE}
        onLeaveRoom={handleLeaveRoom}
        onShareRoom={handleShareRoom}
      />
    </AppLayout>
  );
}
