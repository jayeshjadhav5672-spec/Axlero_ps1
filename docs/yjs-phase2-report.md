# Yjs Phase 2 — Implementation Report

## 1. Objective

Replace the Phase 1 `canvas → Y.Array` placeholder with a CRDT-safe
collaborative whiteboard model: one `Y.Map` per shape (property-level merge)
plus a `Y.Array` of shape IDs for z-order. Concurrent edits to different
properties of the same shape must coexist; Yjs — not custom logic — resolves
same-property conflicts. The existing whiteboard API is preserved untouched.

## 2. Repository / Branch

- Repository: `jayeshjadhav5672-spec/Axlero_ps1`
- Branch: `feature/shree-yjs` (PR #9 line continues; no merge into `main`)
- Base: `main` (`origin/main@8cdc489`, already synced in Phase 1)
- HEAD before Phase 2 work: `363d8a5` (Shravan's PR #9 review docs)
- Note: `origin/feature/shree-yjs` had 2 new Shravan commits
  (`70d1bf0`, `363d8a5`, docs + one comment fix, no logic change) —
  incorporated via fast-forward merge before starting.
- No new dependencies. `yjs@13.6.32` from Phase 1.

## 3. Existing Whiteboard Architecture

Inspected before writing code (not assumed):

- Shape schema: `src/components/canvas/utils/shapes.js` — plain JSON
  shapes, `id: shape-<uuid>` (`createShapeId`), types in `SHAPE_TYPES`
  (freehand/rectangle/circle/diamond/line/arrow/text, plus legacy
  `line`/`pen` aliases). Validation `isValidShape`, JSON boundary
  `serializeShape(s)`, repair pass `normalizeShape`. Commit helpers
  (`bakeDragEnd`, `bakeTransform`) always commit whole-property values
  (e.g. full `points` arrays) — compatible with per-key CRDT granularity.
- Local store: `useWhiteboardState` (Sayon) supports controlled mode —
  parents own the array and apply `onShapeCreate/Update/Delete/Clear`
  payloads plus `onShapesReorder` (full-array undo/redo/z-order sync).
- Transport binding: `useCollaborativeWhiteboard` (Integration Engineer,
  `src/hooks/`) — socket-based, loop-free by construction (remote ops never
  re-emitted). Op validation/reducers in `src/lib/collabOps.js`
  (`create/update/delete/clear/reorder`, JSON-merge comment on `radius`
  noted). **None of these files were modified.**

## 4. Phase 2 Yjs Architecture

```text
Room Y.Doc (from Phase 1 getYDoc)
 ├── shapes  → Y.Map      shapeId → Y.Map(properties)
 ├── zOrder  → Y.Array    [shapeId, ...]  (ids only, never objects)
 ├── canvas  → Y.Array    (Phase 1 placeholder — untouched)
 ├── code    → Y.Text     (untouched)
 └── metadata→ Y.Map      (untouched)
```

New module: `src/lib/yjsWhiteboard.js` (framework-free, like
`collabOps.js` — importable from hooks AND `node --test`). Functions take a
`doc`, so they work on room docs (`getYDoc`) or standalone test docs.

## 5. Shape CRDT Model

- `getShapesMap(doc)` → `doc.getMap('shapes')` (lazy init; no provider change).
- `createShape(doc, shape)`: validates via `isValidShape`, JSON-clones,
  then in ONE transaction (`ORIGIN_LOCAL`) creates a `Y.Map`, sets each
  property as its own key, registers it, appends the id to `zOrder`.
  Duplicate create (same stable id re-delivered) → `{applied:false,
  duplicate:true}`; first writer wins, no duplication, no z-order double-add.
- `updateShape(doc, id, changes)`: per-key `shapeMap.set(k, v)` — never
  replaces the shape object. `id` key immutable (ignored). Unknown shape /
  empty / malformed changes → safe `{applied:false, reason}` no-op.
- `deleteShape(doc, id)`: removes from map AND z-order in one transaction;
  absent id → safe no-op.
- `clearCanvas(doc)`: clears both in one transaction (mirrors
  `onCanvasClear`).
- Verified empirically: nested `Y.Map` syncs across docs; plain `points`
  arrays store per-key (atomic per key — correct, since the whiteboard
  always commits `points` wholesale).

## 6. Z-Order Model

- `getZOrderArray(doc)` → `doc.getArray('zOrder')`, ids only.
- Creation order = z-order; `getSharedShapes` returns shapes in z-order.
- `setZOrder(doc, orderedIds)` (undo/redo + reorder path): keeps requested
  order for known ids, appends unmentioned known ids in current relative
  order so **no shape is ever lost**, drops unknown ids, dedupes; no-op when
  unchanged. Properties untouched.

## 7. Create / Update / Delete

Callback parity with the existing whiteboard (no API changes on their side):

| Whiteboard callback | Yjs equivalent |
|---|---|
| `onShapeCreate(shape)` | `createShape(doc, shape)` |
| `onShapeUpdate(id, changes)` | `updateShape(doc, id, changes)` |
| `onShapeDelete(id)` | `deleteShape(doc, id)` |
| `onCanvasClear()` | `clearCanvas(doc)` |
| `onShapesReorder(next)` order part | `setZOrder(doc, ids)` |

All return `{applied, ...}` (collabOps convention), never throw on bad input.

## 8. Collaborative Hook / Binding

**No new hook was created — deliberately.** `useCollaborativeWhiteboard.js`
already exists (socket transport, Integration Engineer owned). Introducing a
second hook would duplicate the API the task forbids duplicating. Instead
`yjsWhiteboard.js` IS the binding-ready layer: a future hook (or the
existing one, Shravan's call) wires
`onShapeCreate → createShape`, `onShapeUpdate → updateShape`,
`onShapeDelete → deleteShape`, and
`subscribeToShapeChanges(doc, setShapesFromSnapshot)` for remote state.
Wiring Yjs sync into the socket transport is Phase 3, not this task.

## 9. Observer Design

`subscribeToShapeChanges(doc, cb)` observes `shapes` (deep) + `zOrder`.
Callback receives `(serializableShapes, {local, origin})`:

- Local CRUD transacts with `ORIGIN_LOCAL`; remote-applied updates carry
  `null` origin (verified) → binding applies remote state, skips own echo.
- Repeat notifications within one transaction collapse (identical JSON not
  re-emitted).
- Subscriber is strictly read-only — loop-impossible by construction
  (proven by test: N remote updates → exactly 1 doc `update` event).
- `getSharedShapes` is orphan-tolerant (map entries missing from z-order
  appended) and tombstone-tolerant (z-order ids without entries skipped);
  invalid entries dropped; no Yjs internals leak (pure JSON).
- Returns unsubscribe; verified it stops notifications.

## 10. Concurrent Editing

- **Different properties** (A: `x=200`, B: `fill=#ff0000`, same shape):
  both survive on both replicas after state-vector sync — tested.
- **Same property** (A: `x=200`, B: `x=300`): replicas converge to one
  deterministic Yjs-resolved value — tested for convergence, with NO custom
  LWW/timestamp/server-wins code anywhere (documented in test).
- **Concurrent creation** (A creates `shape-A`, B creates `shape-B`): both
  exist on both replicas after sync — tested. Same-id re-create ignored.

## 11. Room Isolation

Shapes/zOrder live on the Phase 1 room doc via `getYDoc(roomId)`. Tested:
mutations in `room-A` invisible in `room-B` and vice versa. No global doc
introduced. Lifecycle unchanged (`destroyYDoc` on leave also drops Phase 2
state since it destroys the whole doc).

## 12. Testing

`test/yjs-whiteboard.test.mjs` — **28 tests, all pass**. Covers every
required item: map/array init, create, property-wise storage, retrieval
order, update, partial update, delete, z-insertion, post-delete consistency,
multi-shape, room isolation, different-prop concurrency, same-prop
convergence, concurrent creation, duplicate-create, observer-remote,
observer-local-flag, no-loop (update-event count), unsubscribe, malformed
input, unknown-shape update, invalid room id, Phase 1 code/metadata/canvas
preservation. Multi-doc sync uses `encodeStateAsUpdate`/`encodeStateVector`/
`applyUpdate` only.

Full suite: **74 tests (46 Phase 1 + 28 Phase 2), 74 pass, 0 fail.**

## 13. Build Validation

`npm run build` (vite): **succeeds** (`✓ built in ~3s`). Only diagnostic is
the pre-existing >500 kB Konva chunk-size warning, unrelated to this change.

## 14. Files Changed

`git diff origin/main...HEAD --stat` adds vs Phase 1:

- `src/lib/yjsWhiteboard.js` — new (~330 lines): model + CRUD + observers.
- `test/yjs-whiteboard.test.mjs` — new (~330 lines): 28 tests.
- `docs/yjs-phase2-report.md` — new (this file).
- `docs/yjs-phase2-handoff.md` — new.

No modifications to whiteboard, Konva, hooks, socket, server, Monaco,
auth, MongoDB, dashboard, UI, or Phase 1 files. No dependency changes.

## 15. Integration Notes

For the future binding (whoever Shravan assigns): room join →
`getYDoc(roomId)`; local whiteboard callbacks → `create/update/deleteShape`
+ `setZOrder`; remote → `subscribeToShapeChanges` → feed snapshot into the
controlled `shapes` prop; room leave → `destroyYDoc(roomId)`; skip
`meta.local === true` echoes. Transport sync of Yjs updates (Phase 3) needs
a `canvas:yjs-update` channel or similar — not designed here.

## 16. Known Issues / Limitations

1. `points` arrays are atomic per key (wholesale replace on each stroke
   commit) — matches how the whiteboard commits them; no partial
   point-level merge. Acceptable, documented.
2. Same-property conflicts resolve by Yjs internals (deterministic
   convergence, no data loss of the *document* but one value wins) — no
   UI-level conflict affordance; out of scope.
3. Doc-sync transport not implemented — two clients only converge in tests
   via explicit update exchange; production sync is Phase 3.
4. `setZOrder` drops ids unknown to the registry — a reorder arriving
   before its creates would lose ordering for those ids (they append on
   arrival). Transport ordering (Phase 3) should deliver creates first.

## 17. Architecture Decisions Required From Shravan

**Integration decision required from Shravan.**

Problem: Yjs model is ready but not yet wired to the live whiteboard or
transport; two possible homes for the binding.

Options:
A. Extend existing `useCollaborativeWhiteboard` with a Yjs replica alongside
   socket ops (single hook, dual channel).
B. New thin hook (e.g. `useYjsWhiteboardBinding`) owning Yjs state, composed
   with the existing hook at the panel level.

Recommendation: B — keeps the proven socket path untouched and isolates
Yjs sync bugs during rollout; merge into one hook later if desired.

Impact: whoever implements the binding touches `src/hooks/` +
`src/components/workspace/` wiring only; `yjsWhiteboard.js` needs no
changes. Transport event contract for Yjs updates (Phase 3) also needs
Shravan/Arun agreement — not proposed here.

## 18. Final Status

Implemented, tested (74/74), built, documented, scoped to Shree-owned
files. Awaiting commit + push + Shravan review.
