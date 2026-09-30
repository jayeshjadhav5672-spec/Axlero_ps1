# SyncSpace Shared Project Architecture

Every code file in a room is shared. This document describes how the room-scoped
project tree, per-file contents, and client-local UI state fit together.

## Big picture

```
                        ┌─────────────────────────────┐
                        │  server/socket.cjs          │
                        │  AUTHORITY for shared state │
                        │                             │
                        │  roomId ─► {                │
                        │    nodes: Map<id, node>     │  tree (names, hierarchy)
                        │    files: Map<id, {text}>   │  contents (per-file LWW)
                        │  }                          │
                        └──────────────┬──────────────┘
                                       │ Socket.io
            ┌──────────────────────────┼──────────────────────────┐
            ▼                          ▼                          ▼
     Browser A                   Browser B                   Browser C
  ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
  │ useCollabor-    │      │ useCollabor-    │      │ useCollabor-    │
  │ ativeProject    │      │ ativeProject    │      │ ativeProject    │
  │  nodes[]        │      │  nodes[]        │      │  nodes[]        │
  │  fileTexts{}    │      │  fileTexts{}    │      │  fileTexts{}    │
  └────────┬────────┘      └────────┬────────┘      └────────┬────────┘
           ▼                        ▼                        ▼
  ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
  │ CodeEditorPanel │      │ CodeEditorPanel │      │ CodeEditorPanel │
  │ LOCAL ONLY:     │      │ LOCAL ONLY:     │      │ LOCAL ONLY:     │
  │ activeFileId,   │      │ activeFileId,   │      │ activeFileId,   │
  │ open tabs,      │      │ open tabs,      │      │ open tabs,      │
  │ selection,      │      │ selection,      │      │ selection,      │
  │ expansion,      │      │ expansion,      │      │ expansion,      │
  │ cursor/viewport │      │ cursor/viewport │      │ cursor/viewport │
  └────────┬────────┘      └────────┬────────┘      └────────┬────────┘
           ▼                        ▼                        ▼
       Monaco                    Monaco                    Monaco
```

**The golden rule:** the tree, names, folders, and file contents are SHARED
(server-authoritative, room-scoped). Everything about *how you look at them*
(active file, tabs, cursor) is LOCAL to each browser.

## File model

```js
// Tree node (shared, server-authoritative)
{ id, name, type: 'file' | 'folder', parentId: string | null, createdAt }

// File content (shared, per-file LWW)
files[fileId] = { text, rev }
```

- Identity is the stable unique `id` (client-minted UUID, server-deduplicated),
  never the filename — renames (future UI) cannot destroy a document.
- The default `Collaborative Code` document (`shared-collaborative-code`)
  always exists, so pre-project rooms migrate automatically.

## Socket.io responsibilities

| Direction | Event | Payload | Purpose |
|---|---|---|---|
| client → server | `project:create-node` | `{ roomId, data: { node: { id, name, type, parentId } } }` | request a file/folder |
| server → creator | `project:node-created` | `{ roomId, data: { node } }` | ack — creator opens it |
| server → peers | `project:node-created` | same | broadcast — peers' editors untouched |
| server → creator | `connection:error` (`event: 'project:create-node'`, `requestId`) | reason | rejection (dup name, bad parent, offline caps…) |
| client → server | `code:update` | `{ roomId, data: { fileId?, text, rev, actorId } }` | per-file content op |
| server → peers | `code:update` | relayed unless dropped | content fan-out (sender excluded); unknown fileIds dropped, stale revs relayed but never regress the snapshot |
| server → joiner | `project:state` | `{ roomId, data: { nodes[], files{} } }` | snapshot on join/rejoin |
| client → server | `project:state-request` | `{ roomId }` | on-demand snapshot (Explorer Refresh) |

Naming follows the existing `namespace:action` convention (`room:join`,
`canvas:update`, `shapes:commit`, …).

### Creation flow

```
New File → validate (client) → project:create-node ──► server validates
                                                              │
                                        ┌─────────────────────┴─────────────────────┐
                                        ▼                                           ▼
                              commit + ack to creator              reject → connection:error
                              + broadcast to peers                 (requestId → inline draft error)
                                        ▼
                              creator opens file, focuses Monaco.
                              Peers see the node; their active file is unchanged.
```

First commit wins on simultaneous same-name creates; the loser gets
"An item with this name already exists." — never a silent overwrite.

### Create-request timeout (fail loud, never silent)
Socket.io silently ignores events with no server listener — e.g. talking to
a stale realtime server that predates the project protocol looks exactly
like "nothing happens" (input stays open, no error). So every create request
arms an 8s ack-timeout (`CREATE_ACK_TIMEOUT_MS` in
`useCollaborativeProject.js`): if neither `project:node-created` nor a
`connection:error` arrives, the open draft shows "No response from the
server…", while the pending id is kept so a late ack still opens the file.
If you see that message: restart the realtime server with the latest code
(`npm run dev:server`) and retry — do NOT retype blindly.

### Content flow (per file)

```
typing in file F → rev[F]++ → code:update { fileId: F, text, rev }
  → server stores files[F] = { text, rev } unless the rev is strictly older
    than the stored rev (stale revs keep the newest snapshot but are still
    relayed; unknown fileIds are dropped outright — never stored, never
    relayed) → relay to peers
  → peers with F open adopt iff op.rev > local rev (applyCodeOp)
```

Peers viewing another file are unaffected: their Monaco instance shows their
own active document, and the op only updates that file's stored text.
Switching files later loads each file's independent content.

## Yjs / CRDT responsibilities

None on the wire — deliberately. `src/lib/yjsProvider.js` is a local,
transport-agnostic `Y.Doc` registry (Phase 1); it was never connected to
sockets. Multi-file sharing generalizes the proven Socket.io LWW relay
per `fileId` instead of replacing the collaboration technology.

**Known limitation (not hidden):** simultaneous edits to the SAME file keep
last-writer-wins semantics - receivers converge on the last-arriving write,
with no character-level merge. Exception: concurrent writes carrying the
SAME rev are dropped on both sides (strictly-newer adoption has no
tie-break), so equal-rev collisions fork until a later write or snapshot
heals them. Revs are plain per-client counters, not a Lamport clock. A
future Yjs-per-file migration would change only the content channel; the
tree protocol, snapshots, and room scoping are already transport-shaped
for it (stable file ids map 1:1 to `Y.Text` docs).

## Room isolation

- Projects are keyed by `roomId` (`roomProjects` map), relayed with
  `socket.to(roomId)` (peers only), and snapshotted joiner-only.
- Every project handler re-checks `socket.data.roomId === payload.roomId`
  (spoofing → `connection:error`), same as the canvas/code channels.
- There is deliberately NO browser-wide tree anymore: localStorage
  persistence of the old frontend-only tree was removed because it violated
  room scoping.

## Late join & reconnect
- Join (including idempotent rejoin): `room:join` → `room:joined` +
  `canvas:sync-init` + **`project:state`** (joiner only, existing peers
  undisturbed).
- Snapshot merge is per-file LWW: entries with `rev` newer than local state
  are adopted; entries where local state is newer (edits made while
  disconnected) are **re-emitted** so a reconnect never resets the room.
- `useRoomConnection` re-emits `room:join` on every reconnect, so this path
  needs no special casing.

## Room-join gating ("socket does not belong to this room")

Transport-connected (`status === 'connected'`) does NOT mean joined: the
server runs `socket.join(roomId)` only inside the `room:join` handler, so any
project write sent earlier is correctly rejected. The client therefore gates
on the join ack, not the transport:

- `useRoomConnection` exposes `joinedRoom` (the `room:joined`-confirmed
  roomId, cleared on disconnect/leave/reconnect) alongside `status`.
- App passes `roomJoined = joinedRoom === roomId` to the panel, which
  disables New File/Folder until true ("joining room…"), and `joined` to the
  project hook: creates refuse loudly while unjoined, content edits stay
  local-only (no keystroke loss — they converge via the snapshot re-emit on
  join).
- Server-side the check was never removed; `project:create-node` additionally
  consults the adapter-level `socket.rooms` set as ground truth (same
  contract as the stroke/live-collab channels) and re-syncs the tracker on
  divergence. Sockets that never joined are still rejected.
- Diagnostics: `[room] join socket=… room=… tracked=… rooms=[…]` and
  `[project] create-node rejected (not a member) socket=… requested=…
  tracked=… rooms=[…]` — the `tracked`/`rooms` pair pinpoints the mismatch
  (`tracked=null`, rooms holding only the socket id = never joined).

## Persistence limitations

- **In-memory only.** `roomProjects` lives in the Node process; a server
  restart drops all projects (same as the canvas snapshots). No MongoDB was
  added — real-time shared state was the priority.
- **Bounded:** 200 nodes/room, 100 KB/file, 2 MB total project text, 200
  rooms (idle evicted first; live rooms always served). Over-cap writes are
  rejected with `connection:error`, never stored-or-relayed-halfway.
- **Rename and recursive delete are implemented** (server-validated,
  fanned out, UI via context menu/dialogs); move is not. Over-cap writes
  and creation past the live-room bound fail loudly with `connection:error`
  (including coded `ROOM_CAPACITY_EXHAUSTED`), never half-applied.

## Client map

| Piece | File | Owns |
|---|---|---|
| Shared state + socket I/O | `src/hooks/useCollaborativeProject.js` | nodes, fileTexts, revs, create requests/errors |
| Pure merge + op helpers | `src/lib/projectSync.js` | `mergeFileSnapshot`, `isValidFileCodeOp`, `fileIdOfCodeOp` |
| Tree validation, sorting, language/icon maps | `src/components/workspace/fileTree.js` | client-side UX validation (server re-validates) |
| Tree/tabs/selection UI (local) | `src/components/workspace/CodeEditorPanel.jsx` | active file, tabs, expansion, search |
| Wiring | `src/App.jsx`, `src/components/workspace/Workspace.jsx` | `project` prop threading |
| Untouched legacy | `src/hooks/useCollaborativeCode.js`, `src/lib/controlledEditorSync.js`, `src/lib/collabOps.js` | single-doc seam + echo guard + reducers (still tested) |

## Verification

- `test/project-collab.test.cjs` (live server): create fan-out, nested
  folders, late-join snapshot with contents, room isolation, legacy-op
  migration, duplicate rejection, simultaneous creates, reconnect restore,
  spoof/malformed rejection.
- `test/project-sync.test.mjs`: merge rules, op validation, snapshot
  re-emit (`ahead`) behavior.
- Manual two-window flow (two browsers, one room + a third in another
  room) should be walked before release.
