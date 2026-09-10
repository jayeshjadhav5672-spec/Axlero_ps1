import { useState } from 'react';
import AppLayout from './components/layout/AppLayout';
import Workspace from './components/workspace/Workspace';
import { Whiteboard } from './components/canvas';

/* ------------------------------------------------------------------
 * DEMO-ONLY shell state (Avantee, UI development).
 * Isolated here in App.jsx — NOT production behavior. Real modules
 * replace these props: Arun (connectionStatus), Shree (users),
 * Vaishnavi (roomId/roomName), Kishan (editor child).
 * No Socket.io / Yjs / auth / sync logic is faked beyond static values.
 * ------------------------------------------------------------------ */
const DEMO_ROOM_ID = 'architecture-01';
const DEMO_ROOM_NAME = 'Architecture Review';
const DEMO_USERS = [
  { id: 'u-avantee', name: 'Avantee Sarve', colorClass: 'bg-teal-600', isActive: true },
  { id: 'u-sayon', name: 'Sayon', colorClass: 'bg-indigo-600', isActive: true },
  { id: 'u-kishan', name: 'Kishan', colorClass: 'bg-amber-600', isActive: false },
];

const CONNECTION_OPTIONS = ['connected', 'connecting', 'reconnecting', 'disconnected', 'error'];

export default function App() {
  const [connectionStatus, setConnectionStatus] = useState('connected');

  const handleShareRoom = () => {
    const url = window.location.href;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
  };

  const handleLeaveRoom = () => {
    // eslint-disable-next-line no-alert
    if (window.confirm('Leave this room? (demo shell — no session is active)')) {
      setConnectionStatus('disconnected');
    }
  };

  return (
    <AppLayout>
      <Workspace
        roomId={DEMO_ROOM_ID}
        roomName={DEMO_ROOM_NAME}
        connectionStatus={connectionStatus}
        users={DEMO_USERS}
        whiteboard={<Whiteboard />}
        editorLanguage="typescript"
        onLeaveRoom={handleLeaveRoom}
        onShareRoom={handleShareRoom}
      />
      {/* Demo-only status switcher for UI verification. Remove when Arun wires real socket state. */}
      <div className="fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-lg backdrop-blur">
        <label htmlFor="demo-connection" className="text-xs font-medium text-slate-500">
          Demo status
        </label>
        <select
          id="demo-connection"
          value={connectionStatus}
          onChange={(e) => setConnectionStatus(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        >
          {CONNECTION_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    </AppLayout>
  );
}
