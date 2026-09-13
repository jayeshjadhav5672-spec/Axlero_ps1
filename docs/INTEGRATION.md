# SyncSpace — Integration Guide (Integration Engineer)

Single source of truth for how the modules fit together. Read this before
touching cross-module code.

```
┌─────────────┐   controlled props / callbacks   ┌──────────────────┐
│   Avantee   │◄────────────────────────────────►│  Sayon canvas    │
│  UI shell   │   users, status, roomId,         │  <Whiteboard />  │
│  (present-  │   whiteboard/editor children     │  Konva, plain    │
│  ational)   │                                  │  JSON shapes     │
└──────┬──────┘                                  └────────┬─────────┘
       │ App.jsx composition                      shapes │ ops
       ▼                                                  ▼
┌──────────────────────────────────────────────────────────────┐
│              Integration layer (src/lib, src/hooks)          │
│  useRoomConnection · useCollaborativeWhiteboard ·            │
│  useCollaborativeCode · collabOps reducers · room helpers    │
└──────────────────────────────┬───────────────────────────────┘
                               │ socket.io events (single transport)
                               ▼
┌──────────────────────────────────────────────────────────────┐
│              Arun: server/socket.cjs (Express +               │
│              Socket.io, room-isolated relay + presence)       │
└──────────────────────────────┬───────────────────────────────┘
                               │ reserved hooks
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
     Vaishnavi: auth/    Shree: Yjs CRDT   Kishan: Monaco
     Mongo persist       (pending)         (landed)
```

## 1. Room lifecycle

1. `getRoomIdFromUrl()` reads `?room=` (validated against
   `^[A-Za-z0-9_-]{1,64}$`, same pattern as the server). Default: `lobby`.
2. `getOrCreateIdentity()` loads/creates `{ userId, displayName }` in
   `localStorage` (`syncspace:identity`). Vaishnavi's auth replaces this
   source; identity already flows as explicit props, so the swap is local.
3. `useRoomConnection` connects the singleton socket, emits `room:join`,
   tracks `room:joined` / `presence:update` / `room:left` /
   `connection:error`, and re-joins automatically on reconnect.
4. Unmount (or Leave) emits `room:leave`. Leaving shows an honest
   left-state with Rejoin — never a fake room.

## 2. Socket.io event contract (do not rename without updating both sides)

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `room:join` | client → server | `{ roomId, userId?, displayName? }` | validated; rejoin idempotent |
| `room:joined` | server → client | `{ roomId, presence[] }` | initial presence snapshot |
| `room:leave` | client → server | `{ roomId }` | must match joined room |
| `room:left` | server → client | `{ roomId }` | ack |
| `presence:update` | server → room | `{ roomId, users[] }` | `users: [{ socketId, userId, displayName, roomId }]` |
| `canvas:update` | both | `{ roomId, data: whiteboardOp }` | relayed to room, sender excluded |
| `code:update` | both | `{ roomId, data: codeOp }` | relayed to room, sender excluded |
| `cursor:update` | both | `{ roomId, data }` | reserved for cursors (Shree/Kishan) |
| `connection:error` | server → client | `{ event, code, message }` | shown in App banner, never silent |

`whiteboardOp = { op: 'create'|'update'|'delete'|'clear', shape?, shapeId?, changes?, actorId }`
`codeOp = { text, rev, actorId }`

## 3. Yjs document structure (reserved for Shree — no Yjs dep yet)

One `Y.Doc` per room, created once per room session (never per render):

- `doc.getArray('shapes')` — Sayon's shape JSON (same objects as today)
- `doc.getText('code')` — replaces the LWW `code:update` relay
- `awareness` — replaces socket presence as the presence source

Transport stays Socket.io: Shree's provider should reuse the singleton
from `src/lib/socket.js` (one connection per page). `cursor:update` is
already reserved for awareness/cursor broadcast. Do NOT create a second
socket connection or a second doc per room.

## 4. Whiteboard sync flow

Local draw → `onShapeCreate(shape)` → parent appends to `shapes` state +
emits `{ op:'create', shape, actorId }` → server relays to room →
remotes `applyWhiteboardOp` (validate → echo-check → dedupe) → `setShapes`.
Remote ops never re-emit → loops impossible. `Whiteboard` always runs
**controlled** (`shapes` prop set); uncontrolled mode remains for offline
use. Selection is local-only (not broadcast).

## 5. Code sync flow (current LWW → future Y.Text)

Local keystroke → `onLocalChange(text)` → rev++ → emit
`{ text, rev, actorId }` → remotes apply only if `rev` is strictly newer.
Concurrent same-rev edits: last arrival wins (documented limitation until
Y.Text lands). The editor is Monaco (`src/components/editor/CodeEditor.jsx`),
bundled locally with its language workers wired through Vite; it exposes the
minimal `{ value, onChange }` contract so the sync hooks stay editor-agnostic.

## 6. Persistence / replay (reserved for Vaishnavi)

No persistence yet. When it lands: server subscribes to the same room
events (or the Y.Doc update stream) and writes snapshots + op log to
MongoDB; on `room:join`, the server sends the snapshot before live ops.
`socket.user` is already read by `server/socket.cjs` — attach auth
middleware there to enforce authorized-room access.

## 7. Auth flow (reserved)

Currently open join (documented, not hidden). Unauthorized-room rejection
will arrive as `connection:error` and is already rendered by the App
banner with Retry.

## 8. Environment

See `.env.example`. Frontend: `VITE_SYNCSPACE_SERVER_URL`
(default `http://localhost:3000`). Server: `PORT` (default 3000).

## 9. How to run

```bash
npm install
npm run dev:server   # terminal 1 — realtime backend :3000
npm run dev          # terminal 2 — frontend :5173
```

Open `http://localhost:5173/?room=demo` in two tabs/windows (or two
devices on the same network, with `VITE_SYNCSPACE_SERVER_URL` pointing at
your LAN host). Draw in tab A → appears in tab B. Type in A → appears in B.
Change `?room=` → rooms are fully isolated (shapes, code, presence).

Production: `npm run build` → `dist/`; serve behind the same host as the
realtime server or set `VITE_SYNCSPACE_SERVER_URL` accordingly.

## 10. Testing

- `npm test` — Arun's socket tests (join/presence/isolation/transport,
  malformed payloads, leave/disconnect, idempotent rejoin) + integration
  contract tests (`test/collab-ops.test.mjs`: op validation, echo
  suppression, revision guards, presence mapping).
- `npm run build` — frontend production build.
- Manual matrix (§9 + room isolation + kill-server offline banner +
  refresh + rejoin) — see task TEST 1–12; TEST 11/12 (persistence/auth)
  are pending Vaishnavi's modules.
