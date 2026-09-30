# Axlero SyncSpace (`Axlero_ps1`)

> High-performance real-time collaborative workspace featuring a shared infinite whiteboard (Konva.js), a synced code editor, and presence awareness — powered by Node.js, Socket.IO, and MongoDB/Firebase authentication.

![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?logo=socket.io&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?logo=mongodb&logoColor=white)
![CI](https://img.shields.io/badge/CI-passing-brightgreen)

---

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Core Features \& Modules](#core-features--modules)
- [Tech Stack](#tech-stack)
- [Local Setup \& Development](#local-setup--development)
- [Testing \& Verification](#testing--verification)
- [Project Structure](#project-structure)
- [Team Contributions \& Module Ownership](#team-contributions--module-ownership)

---

## Overview

Axlero SyncSpace is a multi-user room-based workspace. Each room pairs:

- an **infinite whiteboard** — rectangles, diamonds, ellipses, arrows (with bend handles), lines, freehand pen, text, images, and slide-container **frames**, rendered on a Konva.js stage;
- a **code editor pane** — a controlled editor surface synchronized across clients with revision reconciliation and room isolation;
- **presence awareness** — live cursors, peer selection highlights, and a people panel, all transport-isolated per room.

Synchronization runs over **two Socket.IO pipelines**: an *ephemeral* stream (cursor moves, in-progress stroke/drag previews, viewport mirrors — never persisted, never in history) and a *committed* mutation channel (creates, updates, deletes, multi-shape batch commits, clears, history syncs — applied to the in-memory room snapshot and recorded in local undo/redo).

---

## System Architecture

```mermaid
flowchart TD
    subgraph Client["Client Layer — React + Vite"]
        UI["Workspace UI\n(split layout, panels,\ntoolbar, sidebars)"]
        KONVA["Konva.js Stage\n(shapes, frames,\nfreehand strokes, bend handles,\nTransformer, marquee selection)"]
        EDITOR["Code Editor Pane\n(controlled sync,\nrevision reconciliation)"]
        PRES["Presence\n(live cursors,\npeer selections)"]
        HIST["Local History Stack\n(50-state ring buffer)"]
    end

    subgraph Transport["Transport Layer — Socket.IO (room-scoped)"]
        EPH["Ephemeral live-sync\n(never persisted)\nshape:preview-progress/cancel\ndraw:stroke-progress/complete/cancel\ncursor:move • eraser:trail\ncanvas:viewport-sync\ncollab:selection • collab:tool-sync"]
        COM["Committed mutations\n(applied to in-memory snapshot)\nshapes:commit • shapes:delete\nshapes:update-batch\ncanvas:clear\ncanvas:history-sync\ncanvas:update (legacy ops:\ncreate/update/delete/\nclear/reorder)"]
    end

    subgraph Server["Server & Backend Services — Node.js + Express"]
        RT["Socket.IO Room Manager\n(room membership, isolated\nroom state, per-event validation +\nbyte-size caps)"]
        SNAP["Snapshot Reducers\n(in-memory room state,\nlate-join sync, bounded eviction)"]
        MW["Middleware\n(CORS validation,\nAxlero JWT auth)"]
        AUTH_R["Auth Routes\n(email/password + bcrypt,\nGoogle via Firebase Admin)"]
    end

    subgraph Persist["Persistence & Auth Layer"]
        MONGO["MongoDB\n(user/auth data;\nroom snapshots stay in-memory)"]
        FB["Firebase Auth\n(Google + email/password)"]
        JWT["Axlero JWT\n(issued at login,\nverified per request)"]
    end

    subgraph Export["Export Hub"]
        EXP["Rasterization Engine\n(content-bounds union,\nworld→viewport mapping\nunder pan/zoom,\nPNG • JPEG • AVIF • SVG • PDF)"]
    end

    UI --> KONVA
    UI --> EDITOR
    KONVA <--> EPH
    EDITOR <--> COM
    KONVA <--> COM
    PRES <--> EPH
    HIST --> COM
    EPH --> RT
    COM --> RT
    RT --> SNAP
    RT --> MW
    MW --> AUTH_R
    AUTH_R --> FB
    AUTH_R --> JWT
    SNAP --> MONGO
    KONVA --> EXP
```

**Data-flow summary:**

1. **Local gestures** mutate Konva nodes imperatively (60 fps, zero React state mid-drag); drop commits flow through one store entry point (`commitUpdate`).
2. **Live peers** see throttled previews (creation drafts, drag transforms) on the ephemeral channel; these never enter history, exports, or persistence.
3. **Committed ops** apply locally (single history entry, including multi-shape batches), broadcast once, and converge on peers — the server validates, snapshots, and relays them room-wide.
4. **Late joiners** hydrate from the server room snapshot (`canvas:sync-init`); undo/redo restores broadcast full snapshots (`canvas:history-sync`).

---

## Core Features & Modules

### Collaborative Whiteboard (`src/components/canvas/`)
- **Shapes & frames** — rectangle, diamond, ellipse/circle, arrow (with bend handles), line, freehand pen, text, images, and slide-container frames.
- **Marquee / multi-selection** — drag-to-select rectangle, shared Transformer, and multi-delete across the selection.
- **Alignment snap guides** — edge snapping with threshold while dragging (`snapping.js`).
- **Rotation support** — Transformer rotation baked into the shape model.
- **Frames as containers** — slide-container shapes with point-in-frame containment helpers.
- **Viewport sync** — pan streaming with receiver-side LERP smoothing.
- **Real-time live preview streaming** — throttled (~35 ms tick) creation/drag previews with cancel-on-drop convergence.

### Real-Time Code Collaboration (`src/components/editor/`, `src/hooks/`, `src/lib/yjsProvider.js`)
- Controlled editor synchronization with remote revision reconciliation.
- Room isolation via room-scoped state and per-room socket guards.
- Yjs provides room-scoped `Y.Doc` lifecycle with shared `canvas`/`code`/`metadata` structures; Socket.IO remains the active sync transport — Yjs transport/awareness synchronization is not yet wired end-to-end.

### Enterprise Security & Auth (`server/auth/`, `src/lib/auth.js`, `src/lib/firebaseAuth.js`)
- Axlero JWT issuance + per-request verification, Firebase Admin for Google and email/password flows, bcrypt password hashing, credential sanitization, and room membership with isolated per-room state.

### Full-Bounds Export (`src/components/canvas/utils/exportHub.js`, `src/utils/exportUtils.js`)
- Content-bounds union across all elements (stroke widths, arrows, text included), padding margin, and viewport-aware cropping to content bounds so exports never clip — PNG, JPEG, AVIF, SVG, and dynamically-sized PDF, plus selection-only variants.

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| Frontend | React 19, Vite 5, Tailwind CSS 3, Konva.js + react-konva |
| Backend | Node.js 22+, Express 5 |
| Real-Time Transport | Socket.IO 4 (room-scoped live + commit protocols) |
| Database | MongoDB 7 (users/auth data; room snapshots in-memory) |
| Auth | Firebase Auth + Firebase Admin, Axlero JWT (jsonwebtoken), bcryptjs |
| Collaboration Primitives | Yjs (room-scoped docs; transport pending), pure reducer ops (`src/lib/collabOps.js`) |
| Testing & Tooling | `node:test` (no framework), Vite build (Rollup), PostCSS/Autoprefixer |

---

## Local Setup & Development

### Prerequisites

- **Node.js ≥ 22** and **npm**
- **MongoDB** connection string (Atlas) **or** Firebase credentials — see `.env.example`
- Two terminal windows (frontend + realtime server run separately in dev)

### Step-by-step

```bash
# 1. Clone the repository
git clone <repo-url> Axlero_ps1
cd Axlero_ps1

# 2. Install dependencies
npm install

# 3. Configure environment (never commit .env)
cp .env.example .env
# then edit .env:
#   VITE_SYNCSPACE_SERVER_URL=http://localhost:3000
#   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/axlero
#   JWT_SECRET=<strong-random-secret>   # generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#   JWT_EXPIRES_IN=7d

# 4. Verify everything (unit + integration suites)
npm test

# 5. Run in development (terminal 1: frontend on :5173)
npm run dev

# 6. Run the realtime backend (terminal 2: server on :3000)
npm run dev:server

# 7. Production build (bake VITE_* vars BEFORE building)
npm run build
npm start   # serves the backend (point it at the dist/ frontend host)
```

| Script | What it does |
| :--- | :--- |
| `npm test` | `node --test test/*.test.cjs test/*.test.mjs` — full unit + integration suites |
| `npm run dev` | Vite dev server for the React frontend |
| `npm run dev:server` | Realtime backend (`node server/index.cjs`) |
| `npm run build` | Production Vite bundle into `dist/` |
| `npm start` | Production backend server |

> **Multi-window collab check:** open the app in two browser windows side by side, join the same room, and verify that drawing and code changes are reflected across both clients.

### LAN Development

The backend already listens on all interfaces. For the frontend, start Vite
with external access, then open the LAN URL on every device:

```bash
npm run dev -- --host   # then open http://<YOUR-LAN-IP>:5173/?room=<room-id>
```

If connecting directly to the backend from remote browsers,
`VITE_SYNCSPACE_SERVER_URL` must point to the reachable backend address
(e.g. `http://<YOUR-LAN-IP>:3000`). A private LAN address is NOT reachable
from arbitrary internet users; for public sharing, deploy with
`VITE_SYNCSPACE_SERVER_URL=https://<public-realtime-backend>` set BEFORE
`npm run build`.

---

## Testing & Verification

```bash
npm test
```

Suites cover (all pure, no network/DOM required):

| Area | Suites |
| :--- | :--- |
| Live-sync protocols | `live-sync.test.mjs` (preview payloads, validators, preview-map reducer, viewport LERP), `live-collab.test.cjs`, `stroke-stream.test.mjs`, `stroke-streaming.test.cjs` |
| Eraser contact | `eraser-collision.test.mjs` (drag-erase hit testing) |
| Room snapshots & ops | `room-snapshot.test.cjs`, `room-eviction.test.cjs`, `collab-ops.test.mjs` (op validation, echo suppression, revision guards, presence mapping), `collab-reorder.test.cjs` |
| Auth & transport | `auth.test.cjs`, `google-auth.test.cjs`, `mongo-connection.test.cjs`, `socket.test.cjs`, `cors.test.cjs`, `firebase-config.test.mjs` |
| Editor sync | `code-editor-sync.test.mjs` (controlled sync, no-echo guarantees) |
| UI state & layout | `entry-state.test.mjs`, `split-layout.test.mjs`, `dashboard-rooms.test.mjs`, `yjs-provider.test.mjs` |

---

## Project Structure

```
Axlero_ps1/
├── src/
│   ├── App.jsx                      # Room composition: Workspace + collab hooks
│   ├── components/
│   │   ├── canvas/                  # Whiteboard: stage, renderer, toolbar,
│   │   │   │                        #   bend handles, drawing + history hooks
│   │   │   ├── hooks/               #   useWhiteboardState (store), useCanvasHistory
│   │   │   └── utils/               #   shapes, snapping, liveSync, exportHub, …
│   │   ├── workspace/               # WhiteboardPanel / CodeEditorPanel shells
│   │   ├── editor/                  # Code editor integration point
│   │   ├── presence/ • room/ • auth/ • dashboard/ • layout/ • connection/
│   ├── hooks/                       # useCollaborativeWhiteboard (op shell), code collab
│   ├── lib/                         # collabOps (op validators/reducers), auth, room, socket, yjs
│   └── utils/                       # exportUtils (canonical raster export)
├── server/
│   ├── socket.cjs                   # Room manager: validation, snapshot reducers,
│   │                                #   eviction, relay
│   ├── index.cjs • cors.cjs • auth/ • db/
├── test/                            # node:test suites (*.test.cjs / *.test.mjs)
└── .github/workflows/ci.yml         # CI automation
```

---

## Team Contributions & Module Ownership

| Contributor / Handle | Role | Core Modules & Contributions |
| :--- | :--- | :--- |
| `@sayon999-d` | Full-Stack / Canvas Core | Base Konva whiteboard toolkit (shapes, frames, marquee selection, export hub) and canvas gesture pipeline |
| `@jayeshjadhav5672-spec` | Team Lead / Architecture | Core repo architecture, CI/CD automation pipelines, code editor integration (`CodeEditor.jsx`, controlled sync), and upstream release management |
| `@arun` | Backend & Transport | Socket.IO room management and presence engine, auth routes, and MongoDB user-store layers |
| `@kishan` *(editor owner, per in-code credits)* | Editor | Code editor integration surface (`CollabTextEditor.jsx`) |
| `@shree` *(Yjs owner, per in-code credits)* | CRDT / Presence Data | Yjs room `Y.Doc` lifecycle and shared structures (`yjsProvider.js`); transport/awareness integration pending |
| `@avantee` *(workspace UI owner, per in-code credits)* | Frontend UI | Workspace panels, split layout, dashboard and room shells |
