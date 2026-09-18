# Yjs Phase 3 — Implementation Report (Awareness + Socket.io Integration)

## 1. Objective

Integrate the Phase 1/2 Yjs layer with the existing Socket.io room
transport and add Yjs Awareness (ephemeral user/presence/cursor/selection),
so same-room clients converge document state and see each other's presence
with room isolation, echo safety, and clean lifecycle — without redesigning
any teammate-owned system.

## 2. Repository / Branch

- Repository: `jayeshjadhav5672-spec/Axlero_ps1`
- Branch: `feature/shree-yjs`, base `main`
- HEAD before Phase 3: `3cf5ab7` (Phase 2 model, unmerged)
- Baseline before changes: `npm test` **74/74 pass**
- Notable: Shravan has since merged Phase 1 into main
  (`db0919e merge: integrate Shree Yjs Phase 1 provider`, in
  `origin/main@30d5ec4`). Main was NOT merged into this branch (per
  workflow rules — sync is Shravan's call).
- Dependency added: `y-protocols@1.0.7` (official Yjs companion; Awareness
  semantics live there, not in `yjs` itself). Nothing else added.

## 3. Existing Architecture Inspected (source of truth)

- **Server** (`server/socket.cjs`, Arun): generic room relay. `room:join` /
  `room:leave` with `ROOM_PATTERN` validation + `socket.data.roomId`
  membership; `room:joined` / `room:left` / `presence:update` (server-side
  presence, cleaned on leave/disconnect); collaboration allowlist
  `["canvas:update","code:update","cursor:update"]` relayed with
  room-membership enforcement + 256KB cap, malformed → `connection:error`,
  never broadcast, never crash. **No auth middleware** (`socket.user` always
  `{}`; identity = client-declared `userId`/`displayName`). Stateless w.r.t.
  documents (no doc store).
- **Client socket** (`src/lib/socket.js`): singleton, auto-reconnect on.
- **Room lifecycle** (`useRoomConnection.js`): owns join/re-join on every
  (re)connect, presence state, leave; listeners attached once with cleanup.
- **Identity**: `getOrCreateIdentity()` + `colorForId()` + `presenceToUsers()`
  (`src/lib/room.js`, consumed in `App.jsx`). Reused as-is.
- **Tests**: `test/socket.test.cjs` = real server + real clients harness.
  Reused as the pattern for Phase 3 wire tests.
- **No `cursor:update` producers** exist client-side; server presence is the
  authority for online-ness (it cleans on disconnect).

## 4. Yjs Transport (`src/lib/yjsSocketProvider.js`, new)

- Events `yjs:update` / `yjs:awareness`, envelope
  `{protocol:'syncspace-yjs-1', kind, update|stateVector (base64)}`;
  kinds: `update` (incremental), `sync-request` (join bootstrap with state
  vector), `sync-state` (diff reply), `awareness` (ephemeral only).
- Binary as base64 (portable encode/decode, no Buffer dependency) so the
  server's JSON size check + room routing work unchanged.
- `attachRoomSync({socket, roomId, identity})` — idempotent per room;
  uses Phase 1 `getYDoc` (no second registry); seeds awareness user;
  emits `sync-request` immediately and on every socket `connect`
  (reconnect path). `detachRoomSync(roomId)` — broadcasts awareness
  removal first, then removes doc/socket listeners, destroys Awareness;
  does NOT destroy the Y.Doc (Phase 1 owns it) nor touch socket room
  membership (existing `room:leave` flow owns it).
- Initial sync is peer-assisted (server is stateless): joiner requests,
  members reply with diffs vs the requester's vector; all applies are
  idempotent so broadcast replies are safe.
- Echo prevention: remote bytes applied with `ORIGIN_REMOTE='remote-socket'`;
  doc/awareness update handlers skip that origin → one local change = one
  emit; applies never rebroadcast. Verified by unit + wire tests.

## 5. Awareness (`src/lib/yjsAwareness.js`, new)

- Room-scoped `Awareness` bound to the room's Y.Doc (clientID = doc
  clientID → distinct per room). Never writes `shapes`/`zOrder`/`code`/
  `metadata` (tested: all stay empty).
- Local API: `setLocalUser` (defaults from `getOrCreateIdentity` +
  `colorForId` — no duplicate identity), `setLocalPresence`,
  `setLocalCursor` (null clears), `setLocalSelection` (null clears);
  malformed values ignored, never throw.
- UI API: `getConnectedUsers()` (presenceToUsers-shaped `{clientId, id,
  name, color, presence, self, isActive}`, self included like server
  presence), `getRemoteCursors()` (self excluded, entries need cursor or
  selection), `getAwarenessSnapshot()`, `subscribeToAwareness(cb)`
  (read-only, unsubscribe verified).
- Encode/apply wrappers with validation; removal broadcast encodes the
  removed clientID explicitly (y-protocols drops it from local states —
  verified empirically).

## 6. Room Isolation

Doc + awareness both keyed per room; socket handlers drop
`payload.roomId !== roomId`; server enforces membership independently.
Wire-tested: room-b receives nothing from room-a doc or awareness traffic.

## 7. Reconnect / Disconnect

- Reconnect: same socket object keeps listeners (attach idempotent, no
  duplicates — tested); `connect` handler re-broadcasts local awareness +
  re-emits `sync-request`. Socket-level rejoin stays with
  `useRoomConnection`.
- Leave: `detachRoomSync` → peers drop leaver via removal update
  (wire-tested end to end).
- Abrupt disconnect: client cannot broadcast removal (transport gone).
  Peers' awareness goes stale — documented limitation; mitigation: server
  `presence:update` (which DOES clean on disconnect) remains the authority
  for online-ness, awareness for cursor detail. No server redesign
  undertaken for this.

## 8. Validation / Authorization

- Client: envelope (protocol/kind/base64/size ≤256KB), awareness bytes,
  room match — all fail-closed, never throw, never rebroadcast.
- Server (existing): room membership check prevents arbitrary-room
  targeting (wire-tested: spoof → `connection:error`, zero broadcast).
- Honest boundary: no token auth exists repo-wide (`socket.user` unset);
  room targeting is prevented by server-side membership enforcement, not
  by auth. No new auth invented.

## 9. Tests

- `test/yjs-awareness.test.mjs`: **13/13 pass** (init/validation, user,
  identity fallback, presence, cursor, selection, users shape, encode/apply
  share, no-doc-pollution, subscribe/unsubscribe, removal, malformed,
  destroy/isolation).
- `test/yjs-sync.test.cjs`: **17/17 pass** — 11 fake-socket units (attach,
  idempotency, incremental emit, echo prevention, wired two-client
  convergence, duplicates, malformed, oversize skip, envelope validator,
  detach cleanup, reconnect) + 6 real-socket integration (wire sync +
  isolation, wire echo, bootstrap sync-request, unauthorized room, garbage
  traffic, detach removal over wire).
- Full suite: **104/104 (74 baseline + 30 new), 0 fail** — actually run.
- Two test bugs found and fixed during development (both documented in
  code comments): CJS `require('yjs')` loads a second Yjs copy breaking
  `instanceof`/integration → tests use dynamic ESM `import()`; bootstrap
  `sync-request` races echo-snoop listener → echo test filters it.

## 10. Build

`npm run build`: **succeeds** (`✓ built in ~3s`); only the pre-existing
Konva chunk-size warning. No lint/typecheck scripts in repo.

## 11. Git Diff (uncommitted at time of writing)

- Modified: `package.json` (+1 dep), `package-lock.json`,
  `server/socket.cjs` (1 line: 2 event names appended to allowlist).
- New: `src/lib/yjsSocketProvider.js`, `src/lib/yjsAwareness.js`,
  `test/yjs-awareness.test.mjs`, `test/yjs-sync.test.cjs`,
  `docs/yjs-phase3-report.md`, `docs/yjs-phase3-handoff.md`.
- Untouched: whiteboard, Konva, hooks, `yjsProvider.js`,
  `yjsWhiteboard.js`, Monaco, auth, MongoDB, dashboard, UI. No debug code,
  secrets, or temp files.

## 12. Integration Decisions Required

**Decision 1 — server allowlist change (needs Arun/Shravan sign-off).**
Problem: `yjs:update`/`yjs:awareness` need relaying; only Arun's allowlist
grants it. Change made: 1 line appending both names (same validation,
membership, size cap, routing as existing events). Option A: keep (recommended
— zero new logic, covered by existing tests + 6 new wire tests). Option B:
revert + multiplex Yjs inside `canvas:update` data (works with zero server
change but pollutes the op channel — not recommended). Impact: server file
only; no room/auth redesign.

**Decision 2 — whiteboard/transport binding (needs Shravan).**
Problem: provider exposes attach/detach, but nothing calls it from the app
yet (carried over from Phase 2 decision). Recommended: new thin hook
composing `attachRoomSync` + Phase 2 CRUD + controlled `shapes`, wired next
to (not inside) `useCollaborativeWhiteboard`. Impact: `src/hooks/` +
workspace wiring only.

## 13. Final Status

Implemented, tested (104/104), built, scoped. Awaiting commit + push +
Shravan review. Do NOT merge.
