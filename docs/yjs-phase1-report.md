# Yjs Phase 1 — Implementation Report

## 1. Objective

Phase 1 establishes the room-scoped Yjs collaboration document foundation for
SyncSpace. It delivers a transport-agnostic provider module that owns exactly
one `Y.Doc` per active room, with validated room IDs, strict room isolation,
pre-initialized shared structures (`canvas`, `code`, `metadata`), and a full
lifecycle (create / lookup / destroy / reset). No transport, awareness,
persistence, or UI work is part of this phase — it is the document layer that
Phase 2 (CRDT-safe whiteboard model) and future transport integration will
build on.

## 2. Repository Information

- Repository: `jayeshjadhav5672-spec/Axlero_ps1`
  (`https://github.com/jayeshjadhav5672-spec/Axlero_ps1.git`)
- Branch: `feature/shree-yjs`
- PR number: #9 (`feat(yjs): initialize collaboration document`)
- Base branch: `main`
- Previous PR head (before this review task):
  `5b7e03e2527f3bca32f18b0492bace5b275da024`
- Latest `origin/main` incorporated:
  `8cdc4891ebb82b6582be22d8e9eeefef7f5b28af`
  (`merge: integrate Avantee UI and dashboard`)
- Final HEAD at time of writing:
  `6c83ff18d0f1ab92f6c1509521b4b632994fc1a2`
  (`merge: sync feature/shree-yjs with latest main (Avantee UI/dashboard)`)

## 3. Phase 1 Architecture

```text
Room ID
   ↓
Y.Doc
   ├── canvas   → Y.Array
   ├── code     → Y.Text
   └── metadata → Y.Map
```

One `Y.Doc` instance exists per active room, held in an in-module `Map`
(`roomId → Y.Doc`). Room isolation comes from using separate `Y.Doc`
instances — never from shared substructures.

NOTE: `canvas → Y.Array` here is intentionally the *initial* document
structure, NOT the final collaborative whiteboard data model. The final model
(property-level shape CRDTs) is Phase 2 work and is not implemented here.

## 4. Y.Doc Lifecycle

Implemented in `src/lib/yjsProvider.js`:

- `getYDoc(roomId)` — validates `roomId` via `isValidRoomId()` from
  `src/lib/room.js` (pattern `/^[A-Za-z0-9_-]{1,64}$/`); throws
  `[yjsProvider] Invalid roomId ...` on rejection. Lazily creates a `Y.Doc`
  on first call per room, pre-initializes `canvas` / `code` / `metadata`,
  stores it in the registry, and returns it. Repeated calls with the same
  room return the exact same instance (no orphan documents).
- `destroyYDoc(roomId)` — destroys the live `Y.Doc` (if any) via
  `doc.destroy()` and removes it from the registry. Idempotent: calling for
  a room with no live doc is a safe no-op. Must be called when leaving a
  room so memory is reclaimed and re-joining starts from a clean slate.
- `hasYDoc(roomId)` — returns `true` iff a live `Y.Doc` is registered for
  the room. Suitable as a guard in hooks that must not run before the doc
  exists.
- `resetForTests()` — destroys every retained doc (best-effort, errors
  swallowed) and clears the registry. Test/dev escape hatch; the app itself
  never calls it. Prevents document leakage between tests.

Memory note: the registry holds strong references, so a `Y.Doc` stays alive
until `destroyYDoc()` / `resetForTests()` explicitly removes it. Callers own
the lifecycle — nothing is invented beyond this explicit destroy contract.

## 5. Room Isolation

Isolation mechanism: distinct `Y.Doc` instances per room ID. Verified by
tests mutating `room-a`'s `Y.Text` / `Y.Array` / `Y.Map` and asserting
`room-b`'s corresponding structures remain empty/untouched. Switching rooms
returns the other room's own document (or lazily creates it); destroying one
room's doc does not affect any other room's doc.

## 6. Shared Structures

Every `Y.Doc` is pre-initialized on creation so consumers never need
existence checks:

- `canvas` — `Y.Array` (via `doc.getArray('canvas')`). Holds whiteboard
  shape JSON, same objects as today's shapes. Empty on init.
- `code` — `Y.Text` (via `doc.getText('code')`). Collaborative code text;
  intended to replace the current LWW relay. Empty string on init.
- `metadata` — `Y.Map` (via `doc.getMap('metadata')`). Room-level key/value
  metadata (title, language, etc.). Empty on init.

## 7. Files Changed

Diff `origin/main...HEAD` (4 files, Phase 1 only):

- `package.json` — added `yjs: ^13.6.32` dependency.
- `package-lock.json` — lockfile entries for `yjs@13.6.32`,
  `lib0@0.2.117`, `isomorphic.js@0.2.5` (plus npm-regenerated `"peer"`
  flag churn on unrelated entries — cosmetic, from npm's own
  serialization; no unrelated dependency upgrades).
- `src/lib/yjsProvider.js` — new (88 lines): provider implementation.
- `test/yjs-provider.test.mjs` — new (203 lines): 23 provider tests.

Plus the doc-sync merge commit bringing `feature/shree-yjs` up to
`origin/main@8cdc489` (Avantee UI/dashboard work preserved, untouched by
this PR's own diff).

No changes to whiteboard, Konva, UI, dashboard, Socket.io, server, Monaco,
editor, auth, MongoDB, or replay code.

## 8. Dependencies

- `yjs@13.6.32` (declared `^13.6.32` in `package.json`, installed exactly
  `13.6.32` — verified from `node_modules/yjs/package.json`).
- Transitive: `lib0@0.2.117`, `isomorphic.js@0.2.5` (both required by Yjs).
- No other new dependencies. No unrelated version upgrades. The
  `package-lock.json` `"peer": true` flag churn on pre-existing entries is
  npm client serialization noise, not a dependency change.

## 9. Testing

Actual runs on this branch (post-merge with latest main):

- `npm test` (`node --test test/*.test.cjs test/*.test.mjs`):
  **46 tests, 46 pass, 0 fail** — 23 Yjs provider tests plus all pre-existing
  suites (whiteboard ops, code ops, room helpers, socket transport, leave
  flow, dashboard rooms, entry state).
- Provider coverage verified: doc creation, same-room identity, cross-room
  distinctness, `canvas`/`code`/`metadata` types + empty init, 7 invalid-ID
  rejections (empty, spaces, special chars, >64 chars, number, undefined,
  null), `hasYDoc` lifecycle, `destroyYDoc` removal + idempotency + no-op,
  destroy-then-recreate freshness, 64-char boundary acceptance, and 3
  cross-room isolation mutation tests.
- `npm run build` (`vite build`): **succeeds** (`✓ built in ~7s`). Only
  diagnostic is the pre-existing >500 kB chunk-size warning (Konva bundle),
  unrelated to this PR.

## 10. Scope Boundary

This PR does NOT implement:

- Phase 2 whiteboard CRDT model (shape-level `Y.Map`, z-order `Y.Array`)
- `useCollaborativeWhiteboard.js`
- Socket.io transport / provider wiring
- Awareness
- Monaco collaboration
- MongoDB persistence
- Authentication / JWT
- Replay
- UI redesign

The provider is transport-agnostic: it does not import or touch `socket.js`,
socket events, or awareness.

## 11. Phase 2 Planned Architecture

FUTURE work — documented here for handoff, NOT implemented in PR #9:

```text
Y.Map
  shapeId → Y.Map(properties)

+

Y.Array
  [shapeId1, shapeId2, ...]
```

Intent: property-level CRDT updates (concurrent edits to different
properties of the same shape merge instead of duplicating the shape), stable
shape identity via `shapeId`, and z-order managed independently as an array
of IDs. Phase 2 will update `yjsProvider.js` as required and add
`useCollaborativeWhiteboard.js`, while preserving the existing Whiteboard
callback/API.

## 12. Review Notes

Findings from reviewing the actual implementation (not assumptions):

1. Implementation matches the approved Phase 1 architecture exactly —
   no Phase 2 code present, no scope creep in the diff.
2. Validation reuses the repository's canonical room rule
   (`isValidRoomId` / `ROOM_PATTERN` in `src/lib/room.js`, which mirrors the
   backend `server/socket.cjs` rule) — consistent by construction, not a
   parallel regex.
3. `resetForTests()` destroys docs before clearing (not just dropping
   references), so no cross-test leakage; its comment accurately describes
   it as a test/dev escape hatch.
4. Lifecycle contract is caller-owned: forgetting `destroyYDoc()` on room
   leave retains the doc. This is documented in-code and is the known,
   accepted Phase 1 tradeoff (no background GC invented).
5. `package-lock.json` peer-flag churn is cosmetic npm noise; verified no
   unrelated upgrades.
6. Branch was 4 commits behind main (Avantee UI/dashboard merge `8cdc489`);
   merged cleanly with zero conflicts. Post-merge diff vs `origin/main`
   remains exactly the 4 Phase 1 files.
