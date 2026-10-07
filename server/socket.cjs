const { Server } = require("socket.io");

const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const COLLABORATION_EVENTS = ["canvas:update", "code:update", "cursor:update"];
// High-frequency pen-stroke streaming: relayed without the generic JSON
// size check (a size-capped points array is validated cheaply below, so the
// hot path never pays a full stringify per pointermove).
const STROKE_STREAM_EVENTS = ["draw:stroke-progress", "draw:stroke-complete", "draw:stroke-cancel"];
const MAX_STREAM_POINTS = 20000;

/**
 * Server-side room snapshots (Issue 1: ghost artifacts). The relay is
 * otherwise stateless, so a late joiner would see an empty board — and any
 * shape deleted/cleared before they arrived would resurrect the moment an
 * older client re-broadcasts. `roomState` tracks the authoritative shape
 * array per room from every validated mutation channel (unified +
 * legacy ops); `room:join` delivers it as `canvas:sync-init` to the
 * joiner only. Bounded (rooms + shapes caps, oldest IDLE room evicted)
 * so memory cannot grow unboundedly. A room with live presence is NEVER
 * evicted automatically; when every slot holds a live room, new entries
 * are rejected with `connection:error` instead. Ephemeral streams
 * (previews, cursors, trails, in-progress strokes) never touch it.
 *
 * Capacity contract (explicit, never silent): a mutation that would push a
 * room past MAX_ROOM_SHAPES is REJECTED with `connection:error` ("room
 * shape limit reached") and is neither relayed nor stored — so the stored
 * snapshot is always complete and a late joiner can never receive a
 * silently truncated board. Room eviction likewise only targets rooms with
 * no live presence (nothing connected to lose state).
 */
const MAX_ROOMS = 200;
const MAX_ROOM_SHAPES = 2000;

/**
 * Shared room project (collaborative file tree + per-file contents).
 * Every room owns exactly one project, keyed by roomId — the server is the
 * authority for the tree, so browsers can never diverge. The default
 * "Collaborative Code" document (DEFAULT_FILE_ID) always exists: rooms
 * created before projects existed migrate automatically the first time a
 * snapshot is built or a legacy `code:update` (no fileId) arrives.
 *
 * Memory bounds (per room): at most MAX_PROJECT_NODES nodes, each file at
 * most MAX_FILE_TEXT_BYTES, whole-project text at most
 * MAX_PROJECT_TEXT_BYTES. Over-cap mutations are REJECTED with
 * `connection:error` — never stored, never relayed. In-memory only: a
 * server restart drops all projects (documented in docs/architecture.md).
 */
const DEFAULT_FILE_ID = "shared-collaborative-code";
const DEFAULT_FILE_NAME = "Collaborative Code";
const MAX_PROJECT_NODES = 200;
const MAX_NODE_NAME = 100;
const MAX_FILE_TEXT_BYTES = 100 * 1024;
const MAX_PROJECT_TEXT_BYTES = 2 * 1024 * 1024;

function createEmptyProject() {
  const now = Date.now();
  return {
    nodes: new Map([
      [DEFAULT_FILE_ID, { id: DEFAULT_FILE_ID, name: DEFAULT_FILE_NAME, type: "file", parentId: null, createdAt: now }],
    ]),
    files: new Map([[DEFAULT_FILE_ID, { text: "", rev: 0 }]]),
    updatedAt: now,
  };
}

function ensureDefaultFile(project) {
  if (!project.nodes.has(DEFAULT_FILE_ID)) {
    project.nodes.set(DEFAULT_FILE_ID, {
      id: DEFAULT_FILE_ID,
      name: DEFAULT_FILE_NAME,
      type: "file",
      parentId: null,
      createdAt: Date.now(),
    });
  }
  if (!project.files.has(DEFAULT_FILE_ID)) {
    project.files.set(DEFAULT_FILE_ID, { text: "", rev: 0 });
  }
}

function publicNode(node) {
  return { id: node.id, name: node.name, type: node.type, parentId: node.parentId ?? null, createdAt: node.createdAt };
}

/** Snapshot payload for `project:state` (late joiners, reconnects, refresh). */
function projectSnapshot(project) {
  ensureDefaultFile(project);
  const files = {};
  for (const [id, entry] of project.files) {
    files[id] = { text: typeof entry.text === "string" ? entry.text : "", rev: Number.isFinite(entry.rev) ? entry.rev : 0 };
  }
  return { nodes: [...project.nodes.values()].map(publicNode), files };
}

function projectTextBytes(project) {
  let total = 0;
  for (const entry of project.files.values()) {
    try {
      total += Buffer.byteLength(typeof entry.text === "string" ? entry.text : "", "utf8");
    } catch {
      // unmeasurable entry — ignore (validation rejects it on write)
    }
  }
  return total;
}

/**
 * Validate a client-proposed tree node against the authoritative project.
 * Returns the clean node to commit. Throws with a user-facing message on
 * any violation (duplicate names resolve deterministically: the first
 * commit wins, later ones are rejected — never silently overwritten).
 * Exported for unit tests.
 */
function validateProjectNode(input, project) {
  if (!isPlainObject(input)) throw new Error("node must be an object");
  const id = input.id;
  if (!isIdString(id)) throw new Error("node id must be a 1-128 character string");
  if (project.nodes.has(id)) throw new Error("node id already exists");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new Error("Enter a name.");
  if (name.length > MAX_NODE_NAME) throw new Error(`Keep names under ${MAX_NODE_NAME} characters.`);
  if (/[\\/]/.test(name)) throw new Error("Names can't contain / or \\.");
  if (name === "." || name === ".." || /^\.+$/.test(name)) throw new Error("That name is reserved.");
  if (/[\0-\x1f\x7f]/.test(name)) throw new Error("Names can't contain control characters.");
  if (input.type !== "file" && input.type !== "folder") throw new Error("type must be 'file' or 'folder'");
  const parentId = input.parentId === undefined || input.parentId === null ? null : input.parentId;
  if (parentId !== null) {
    if (typeof parentId !== "string") throw new Error("parentId must be a node id or null");
    const parent = project.nodes.get(parentId);
    if (!parent || parent.type !== "folder") throw new Error("parent folder does not exist");
  }
  for (const sibling of project.nodes.values()) {
    if ((sibling.parentId ?? null) === parentId && String(sibling.name).toLowerCase() === name.toLowerCase()) {
      throw new Error("An item with this name already exists.");
    }
  }
  if (project.nodes.size >= MAX_PROJECT_NODES) {
    throw new Error(`room file limit reached (${MAX_PROJECT_NODES} items)`);
  }
  return { id, name, type: input.type, parentId, createdAt: Date.now() };
}

function validateProjectRename(input, project) {
  if (!isPlainObject(input) || !isIdString(input.id)) throw new Error("node id must be a 1-128 character string");
  if (input.id === DEFAULT_FILE_ID) throw new Error("The shared document cannot be renamed.");
  const current = project.nodes.get(input.id);
  if (!current) throw new Error("item not found");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new Error("Enter a name.");
  if (name.length > MAX_NODE_NAME) throw new Error(`Keep names under ${MAX_NODE_NAME} characters.`);
  if (/[\\/]/.test(name)) throw new Error("Names can't contain / or \\");
  if (name === "." || name === ".." || /^\.+$/.test(name)) throw new Error("That name is reserved.");
  if (/[\0-\x1f\x7f]/.test(name)) throw new Error("Names can't contain control characters.");
  for (const sibling of project.nodes.values()) {
    if (sibling.id !== current.id && (sibling.parentId ?? null) === (current.parentId ?? null) && String(sibling.name).toLowerCase() === name.toLowerCase()) {
      throw new Error("An item with this name already exists.");
    }
  }
  return { ...current, name };
}

function projectDeleteIds(nodeId, project) {
  if (nodeId === DEFAULT_FILE_ID) throw new Error("The shared document cannot be deleted.");
  if (!project.nodes.has(nodeId)) throw new Error("item not found");
  const deleted = [];
  const visit = (id) => {
    deleted.push(id);
    for (const child of project.nodes.values()) {
      if ((child.parentId ?? null) === id) visit(child.id);
    }
  };
  visit(nodeId);
  return deleted;
}

function commitListOf(data) {
  if (!isPlainObject(data)) return [];
  if (Array.isArray(data.shapes)) return data.shapes;
  if (data.shape !== undefined) return [data.shape];
  return [];
}

function validShapeEntries(list) {
  return (Array.isArray(list) ? list : []).filter(
    (s) => isPlainObject(s) && typeof s.id === "string" && s.id
  );
}

/**
 * Pure room-snapshot reducer: folds one validated mutation event into the
 * previous shape array. Returns the same reference when nothing changed.
 * Exported for unit tests.
 */
function applyRoomMutation(prevShapes, event, data) {
  const prev = Array.isArray(prevShapes) ? prevShapes : [];
  switch (event) {
    case "shapes:commit":
    case "draw:stroke-complete": {
      const fresh = validShapeEntries(commitListOf(data)).filter(
        (s) => !prev.some((p) => p.id === s.id)
      );
      if (fresh.length === 0) return prev;
      return [...prev, ...fresh];
    }
    case "shapes:update-batch":
    case "canvas:history-sync": {
      if (!isPlainObject(data) || !Array.isArray(data.shapes)) return prev;
      const incoming = validShapeEntries(data.shapes);
      if (event === "canvas:history-sync") return incoming;
      if (incoming.length === 0) return prev;
      const merged = new Map(prev.map((s) => [s.id, s]));
      for (const s of incoming) merged.set(s.id, { ...merged.get(s.id), ...s });
      // Adopt sender order when id sets match (reorder sync).
      const inIds = incoming.map((s) => s.id);
      if (inIds.length === prev.length && inIds.every((id) => merged.has(id))) {
        const prevIds = new Set(prev.map((s) => s.id));
        if (inIds.every((id) => prevIds.has(id))) return inIds.map((id) => merged.get(id));
      }
      const next = [...merged.values()];
      return next.length === prev.length && next.every((s, i) => s === prev[i]) ? prev : next;
    }
    case "shapes:delete": {
      if (!isPlainObject(data)) return prev;
      const ids = new Set(
        (Array.isArray(data.shapeIds) ? data.shapeIds : data.shapeId !== undefined ? [data.shapeId] : []).filter(
          (id) => typeof id === "string"
        )
      );
      if (ids.size === 0) return prev;
      const next = prev.filter((s) => !ids.has(s.id));
      return next.length === prev.length ? prev : next;
    }
    case "canvas:clear":
      return prev.length === 0 ? prev : [];
    case "canvas:update": {
      // Legacy op envelope { op, ... } from the controlled shell.
      if (!isPlainObject(data) || typeof data.op !== "string") return prev;
      if (data.op === "create" && isPlainObject(data.shape) && typeof data.shape.id === "string") {
        return prev.some((s) => s.id === data.shape.id) ? prev : [...prev, data.shape];
      }
      if (data.op === "update" && typeof data.shapeId === "string" && isPlainObject(data.changes)) {
        if (!prev.some((s) => s.id === data.shapeId)) return prev;
        return prev.map((s) => (s.id === data.shapeId ? { ...s, ...data.changes } : s));
      }
      if (data.op === "update-many" && isPlainObject(data) && Array.isArray(data.updates)) {
        // Atomic multi-shape commit (frame drags). Entries referencing
        // unknown ids are skipped; an op with no known ids changes nothing
        // (same no-op contract as single-shape update above).
        const byId = new Map();
        for (const u of data.updates) {
          if (isPlainObject(u) && typeof u.shapeId === "string" && isPlainObject(u.changes)) {
            byId.set(u.shapeId, u.changes);
          }
        }
        if (byId.size === 0 || !prev.some((s) => s && byId.has(s.id))) return prev;
        return prev.map((s) => (s && byId.has(s.id) ? { ...s, ...byId.get(s.id) } : s));
      }
      if (data.op === "delete" && typeof data.shapeId === "string") {
        const next = prev.filter((s) => s.id !== data.shapeId);
        return next.length === prev.length ? prev : next;
      }
      if (data.op === "clear") return prev.length === 0 ? prev : [];
      if (data.op === "reorder" && Array.isArray(data.shapes)) {
        return validShapeEntries(data.shapes);
      }
      return prev;
    }
    default:
      return prev;
  }
}

/**
 * Unified live-collaboration channels. Two classes:
 * - Ephemeral peer-to-peer streams (high-frequency, never persisted):
 *   shape:preview-progress / shape:preview-cancel (all-tool creation
 *   drag previews), cursor:move, eraser:trail.
 * - Committed mutations (persisted, full room sync): shapes:commit,
 *   shapes:delete, shapes:update-batch, canvas:clear, canvas:history-sync.
 *
 * Legacy channels stay operational: draw:stroke-* (pen streaming),
 * canvas:update / code:update / cursor:update (committed ops + presence).
 */
const LIVE_COLLAB_EVENTS = [
  "shape:preview-progress",
  "shape:preview-cancel",
  "cursor:move",
  "eraser:trail",
  "shapes:commit",
  "shapes:delete",
  "shapes:update-batch",
  "canvas:clear",
  "canvas:history-sync",
  // Peer selection presence (ephemeral overlay; tools/selection stay local
  // per client — this channel only paints non-intrusive peer highlights).
  "collab:selection",
  // Shared viewport + toolbar sync (ephemeral, last-writer-wins).
  "canvas:viewport-sync",
  "collab:tool-sync",
];
const MAX_PREVIEW_BYTES = 64 * 1024;
const MAX_BATCH_SHAPES = 500;
const MAX_TRAIL_POINTS = 5000;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidRoomId(roomId) {
  return typeof roomId === "string" && ROOM_PATTERN.test(roomId);
}

function hasAcceptableSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}

function normalizeOptionalString(value, field, maxLength) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${field} must be a string of at most ${maxLength} characters`);
  }
  return value;
}

function isFiniteCoord(value) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e7;
}

function isIdString(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function byteSizeOk(value, cap) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= cap;
  } catch {
    return false;
  }
}

/**
 * Lightweight validation for the high-frequency stroke-stream envelope.
 * Points arrays are length-capped (no full-payload stringify on the hot
 * path); shape payloads on `draw:stroke-complete` reuse the generic byte
 * cap since they arrive once per stroke.
 */
function assertStrokeStreamPayload(payload, event) {
  if (!isPlainObject(payload) || !isValidRoomId(payload.roomId)) {
    throw new Error("payload must include a valid roomId");
  }
  const data = payload.data;
  if (!isPlainObject(data) || typeof data.strokeId !== "string" || data.strokeId.length === 0 || data.strokeId.length > 128) {
    throw new Error("payload data must include a valid strokeId");
  }
  if (event === "draw:stroke-progress") {
    const points = data.points;
    if (
      !Array.isArray(points) ||
      points.length < 2 ||
      points.length > MAX_STREAM_POINTS ||
      points.length % 2 !== 0 ||
      !points.every(isFiniteCoord)
    ) {
      throw new Error("stroke points must be a finite [x, y, ...] array within the stream cap");
    }
  }
  if (event === "draw:stroke-complete" && data.shape !== undefined && data.shape !== null) {
    if (!isPlainObject(data.shape) || !hasAcceptableSize(data.shape)) {
      throw new Error("completed shape must be an acceptable object");
    }
  }
}

/**
 * Validation for the unified live-collaboration envelope. Ephemeral
 * streams use cheap structural/size checks (no hot-path stringify beyond
 * a capped byte measure on small preview objects); committed mutations
 * reuse the generic byte cap. Every branch throws — callers convert to
 * `connection:error` so malformed input fails LOUD, never silent.
 */
function assertLiveCollabPayload(payload, event) {
  if (!isPlainObject(payload) || !isValidRoomId(payload.roomId)) {
    throw new Error("payload must include a valid roomId");
  }
  const data = payload.data;
  switch (event) {
    case "shape:preview-progress": {
      if (!isPlainObject(data) || !isIdString(data.draftId)) {
        throw new Error("preview progress must include a valid draftId");
      }
      if (
        !isPlainObject(data.shape) ||
        typeof data.shape.id !== "string" ||
        !data.shape.id ||
        typeof data.shape.type !== "string" ||
        !byteSizeOk(data, MAX_PREVIEW_BYTES)
      ) {
        throw new Error("preview progress must include an acceptable shape descriptor");
      }
      break;
    }
    case "shape:preview-cancel": {
      if (!isPlainObject(data) || !isIdString(data.draftId)) {
        throw new Error("preview cancel must include a valid draftId");
      }
      break;
    }
    case "cursor:move": {
      if (!isPlainObject(data) || !isFiniteCoord(data.x) || !isFiniteCoord(data.y)) {
        throw new Error("cursor move must include finite x/y");
      }
      if (data.user !== undefined && (typeof data.user !== "string" || data.user.length > 128)) {
        throw new Error("cursor user must be a string of at most 128 characters");
      }
      if (data.tool !== undefined && (typeof data.tool !== "string" || data.tool.length > 32)) {
        throw new Error("cursor tool must be a string of at most 32 characters");
      }
      break;
    }
    case "eraser:trail": {
      if (!isPlainObject(data) || !isIdString(data.eraserId)) {
        throw new Error("eraser trail must include a valid eraserId");
      }
      const points = data.points;
      if (
        !Array.isArray(points) ||
        points.length > MAX_TRAIL_POINTS ||
        !points.every(isFiniteCoord)
      ) {
        throw new Error("eraser points must be a finite array within the trail cap");
      }
      break;
    }
    case "shapes:commit": {
      if (!isPlainObject(data)) {
        throw new Error("commit must include a shape payload");
      }
      // Accept both envelopes: { shape } (legacy) and { shapes: [] }.
      const list = Array.isArray(data.shapes) ? data.shapes : data.shape !== undefined ? [data.shape] : null;
      if (!list || list.length === 0 || list.length > MAX_BATCH_SHAPES) {
        throw new Error("commit must include 1-500 shapes");
      }
      if (!list.every((s) => isPlainObject(s) && typeof s.id === "string" && s.id)) {
        throw new Error("every committed shape must include an id");
      }
      if (!byteSizeOk(list, MAX_PAYLOAD_BYTES)) {
        throw new Error("commit exceeds the size cap");
      }
      break;
    }
    case "shapes:delete": {
      if (!isPlainObject(data)) throw new Error("delete must include shape ids");
      const ids = Array.isArray(data.shapeIds) ? data.shapeIds : data.shapeId !== undefined ? [data.shapeId] : null;
      if (!ids || ids.length === 0 || ids.length > MAX_BATCH_SHAPES || !ids.every(isIdString)) {
        throw new Error("delete must include 1-500 valid shape ids");
      }
      break;
    }
    case "shapes:update-batch": {
      if (!isPlainObject(data) || !Array.isArray(data.shapes) || data.shapes.length === 0 || data.shapes.length > MAX_BATCH_SHAPES) {
        throw new Error("update batch must include 1-500 shapes");
      }
      if (!data.shapes.every((s) => isPlainObject(s) && typeof s.id === "string" && s.id)) {
        throw new Error("every batched shape must include an id");
      }
      if (!hasAcceptableSize(data.shapes)) {
        throw new Error("update batch exceeds the size cap");
      }
      break;
    }
    case "canvas:clear": {
      if (data !== undefined && data !== null && !isPlainObject(data)) {
        throw new Error("clear payload must be an object when present");
      }
      break;
    }
    case "canvas:history-sync": {
      // Full-array undo/redo restores: count-capped at the room snapshot
      // cap (not the incremental 500-op cap) so undo on a large-but-legal
      // board still propagates; the byte cap below still bounds abuse.
      if (!isPlainObject(data) || !Array.isArray(data.shapes) || data.shapes.length > MAX_ROOM_SHAPES) {
        throw new Error("history sync must include a shapes array within the room cap");
      }
      if (!hasAcceptableSize(data.shapes)) {
        throw new Error("history snapshot exceeds the size cap");
      }
      break;
    }
    case "collab:selection": {
      if (!isPlainObject(data)) {
        throw new Error("selection must include a payload object");
      }
      if (data.shapeIds !== undefined) {
        if (!Array.isArray(data.shapeIds) || data.shapeIds.length > MAX_BATCH_SHAPES || !data.shapeIds.every(isIdString)) {
          throw new Error("selection shapeIds must be 0-500 valid ids");
        }
      }
      if (data.userId !== undefined && !isIdString(data.userId)) {
        throw new Error("selection userId must be a valid id");
      }
      for (const field of ["userName", "color"]) {
        if (data[field] !== undefined && typeof data[field] !== "string") {
          throw new Error(`selection ${field} must be a string`);
        }
      }
      if (typeof data.userName === "string" && data.userName.length > 128) {
        throw new Error("selection userName must be at most 128 characters");
      }
      if (typeof data.color === "string" && data.color.length > 64) {
        throw new Error("selection color must be at most 64 characters");
      }
      break;
    }
    case "canvas:viewport-sync": {
      if (!isPlainObject(data)) {
        throw new Error("viewport sync must include a payload object");
      }
      if (data.stagePos !== undefined) {
        if (!isPlainObject(data.stagePos) || !isFiniteCoord(data.stagePos.x) || !isFiniteCoord(data.stagePos.y)) {
          throw new Error("viewport stagePos must hold finite x/y");
        }
      }
      if (data.scale !== undefined && (!isFiniteCoord(data.scale) || data.scale <= 0 || data.scale > 100)) {
        throw new Error("viewport scale must be a positive finite number");
      }
      break;
    }
    case "collab:tool-sync": {
      if (!isPlainObject(data) || typeof data.tool !== "string" || data.tool.length === 0 || data.tool.length > 32) {
        throw new Error("tool sync must include a tool name");
      }
      break;
    }
    default:
      throw new Error(`unknown live-collab event ${event}`);
  }
}

function createSocketServer(httpServer, options = {}) {
  const io = new Server(httpServer, {
    cors: options.cors || { origin: true, credentials: true },
    ...options.socket,
  });
  const roomPresence = new Map();
  const roomState = new Map(); // roomId -> { shapes: [], updatedAt }
  // Authoritative shared projects: roomId -> { nodes, files, updatedAt }.
  // Room-scoped by construction (keyed by roomId, relayed only within the
  // room, snapshotted joiner-only). In-memory only — a restart drops them.
  const roomProjects = new Map();

  function freeProjectCapacity() {
    if (roomProjects.size < MAX_ROOMS) return true;
    for (const [id] of roomProjects) {
      if (!roomHasLivePresence(id)) {
        roomProjects.delete(id);
        return true;
      }
    }
    return false;
  }

  /**
   * Return the authoritative project for a room, creating it (with the
   * default Collaborative Code document) on first use. Idle rooms are
   * evicted first when at capacity; a room with live presence is always
   * served its project (per-room node/text caps still bound memory).
   * When every one of the MAX_ROOMS slots holds a live room, creation
   * fails loudly with a coded ROOM_CAPACITY_EXHAUSTED error instead of
   * silently exceeding the documented bound. Live rooms are never evicted
   * (freeProjectCapacity only drops zero-presence rooms, never the
   * requested room itself).
   */
  function getRoomProject(roomId) {
    let project = roomProjects.get(roomId);
    if (!project) {
      if (!freeProjectCapacity()) {
        const error = new Error(
          `room project capacity exhausted (${MAX_ROOMS} live rooms); try again later`
        );
        error.code = "ROOM_CAPACITY_EXHAUSTED";
        throw error;
      }
      project = createEmptyProject();
      // Recency refresh so eviction targets rooms nobody touches.
      roomProjects.set(roomId, project);
    } else {
      roomProjects.delete(roomId);
      roomProjects.set(roomId, project);
    }
    project.updatedAt = Date.now();
    return project;
  }

  function getRoomShapes(roomId) {
    return roomState.get(roomId)?.shapes ?? [];
  }

  function roomHasLivePresence(roomId) {
    return (roomPresence.get(roomId)?.length ?? 0) > 0;
  }

  /**
   * Free one room-state slot when at capacity. Evicts the oldest IDLE
   * room (zero live presence) only — a live room is never evicted
   * automatically. Returns true when a slot is available.
   */
  function freeRoomCapacity() {
    if (roomState.size < MAX_ROOMS) return true;
    for (const [id] of roomState) {
      if (!roomHasLivePresence(id)) {
        roomState.delete(id);
        return true;
      }
    }
    return false;
  }

  function setRoomShapes(roomId, shapes) {
    const clean = validShapeEntries(shapes);
    // Recency refresh: rooms written to re-insert at the end, so eviction
    // below only targets rooms nobody has touched recently.
    if (roomState.has(roomId)) roomState.delete(roomId);
    // Bounded memory: evict rooms with no live presence first — their state
    // is unobservable (nobody connected to lose it), so eviction can never
    // silently empty a board out from under connected clients. A room with
    // live presence is NEVER evicted; when every slot is live, refuse the
    // new entry instead (callers reject with connection:error).
    if (roomState.size >= MAX_ROOMS && !freeRoomCapacity()) return false;
    roomState.set(roomId, { shapes: clean, updatedAt: Date.now() });
    return true;
  }

  /**
   * Fold a validated mutation into the room snapshot and store it.
   * MUST be called BEFORE relaying the op: mutations that would overflow
   * MAX_ROOM_SHAPES throw (converted to `connection:error` by callers),
   * so an over-cap op is never relayed without being stored — peers and
   * the snapshot can never silently diverge. No-op mutations return the
   * previous array untouched (no entry created, no eviction triggered).
   * A mutation needing a new entry while every MAX_ROOMS slot holds a
   * live room throws a coded ROOM_CAPACITY_EXHAUSTED error (likewise
   * converted to `connection:error`, with no relay and no snapshot
   * change) — a live room's snapshot is never discarded.
   */
  function commitRoomMutation(roomId, event, data) {
    const prev = getRoomShapes(roomId);
    const next = applyRoomMutation(prev, event, data);
    if (next.length > MAX_ROOM_SHAPES) {
      throw new Error(`room shape limit reached (${MAX_ROOM_SHAPES} shapes)`);
    }
    if (next === prev) return next;
    if (!roomState.has(roomId) && !freeRoomCapacity()) {
      const err = new Error(`room-state capacity exhausted (${MAX_ROOMS} live rooms); try again later`);
      err.code = "ROOM_CAPACITY_EXHAUSTED";
      throw err;
    }
    setRoomShapes(roomId, next);
    return next;
  }

  /**
   * Fold a `code:update` payload into the room project's per-file contents.
   * Returns true when the caller should relay the op, false to drop it.
   * Legacy-tolerant: non-object payloads (or objects without a text string)
   * are relayed by the caller but never stored, so old clients keep working
   * and can never poison a snapshot. Unknown fileIds are DROPPED (never
   * relayed, never stored): only files in the authoritative tree may reach
   * peers, so a client cannot inject content under an invented fileId.
   * New-protocol envelopes (text + finite rev, optional fileId defaulting
   * to the shared document) are stored unless strictly older than the
   * stored revision. A stale rev is dropped outright - no snapshot change
   * AND no relay - so a behind peer can never adopt it over the newer
   * authoritative state. Same-rev collisions stay arrival-LWW (not a
   * regression: the revision does not move backward). Over-cap writes
   * throw (rejected loudly, never relayed unstored).
   */
  function commitCodeUpdate(roomId, data) {
    if (!isPlainObject(data) || typeof data.text !== "string") return true;
    const project = getRoomProject(roomId);
    ensureDefaultFile(project);
    const fileId = typeof data.fileId === "string" && data.fileId ? data.fileId : DEFAULT_FILE_ID;
    const file = project.files.get(fileId);
    if (!file) return false; // unknown file: drop (never relay, never store)
    if (Buffer.byteLength(data.text, "utf8") > MAX_FILE_TEXT_BYTES) {
      throw new Error(`file text exceeds the ${MAX_FILE_TEXT_BYTES}-byte cap`);
    }
    let currentTotal = 0;
    try {
      currentTotal = projectTextBytes(project);
    } catch {
      currentTotal = 0;
    }
    let prevBytes = 0;
    try {
      prevBytes = Buffer.byteLength(file.text, "utf8");
    } catch {
      prevBytes = 0;
    }
    let nextBytes = 0;
    try {
      nextBytes = Buffer.byteLength(data.text, "utf8");
    } catch {
      throw new Error("file text is not measurable");
    }
    if (currentTotal - prevBytes + nextBytes > MAX_PROJECT_TEXT_BYTES) {
      throw new Error("room project storage limit reached");
    }
    if (
      Number.isFinite(data.rev) &&
      Number.isFinite(file.rev) &&
      data.rev < file.rev
    ) {
      return false; // stale rev: keep the newer snapshot AND do not relay it
    }
    project.files.set(fileId, { text: data.text, rev: Number.isFinite(data.rev) ? data.rev : file.rev });
    project.updatedAt = Date.now();
    return true;
  }

  function presenceFor(roomId) {
    return [...(roomPresence.get(roomId) || [])].map((entry) => ({ ...entry }));
  }

  function broadcastPresence(roomId) {
    io.to(roomId).emit("presence:update", {
      roomId,
      users: presenceFor(roomId),
    });
  }

  function sendError(socket, event, message, code = "INVALID_PAYLOAD", extra = null) {
    socket.emit("connection:error", { ...(isPlainObject(extra) ? extra : null), event, code, message });
  }

  // Membership diagnostics: the app-level tracker plus the adapter-level
  // ground truth (socket.rooms always contains the socket's own id plus
  // every room socket.join() added). Used by logs and by the
  // definitive-matching check on project:create-node. Never throws.
  function socketRoomDebug(socket) {
    let rooms = [];
    try {
      rooms =
        socket && socket.rooms && typeof socket.rooms.values === "function" ? [...socket.rooms.values()] : [];
    } catch {
      rooms = [];
    }
    let tracked = null;
    try {
      tracked = socket && socket.data ? (socket.data.roomId ?? null) : null;
    } catch {
      tracked = null;
    }
    return { tracked, rooms };
  }

  function removeFromPresence(socket) {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const users = roomPresence.get(roomId) || [];
    roomPresence.set(roomId, users.filter((entry) => entry.socketId !== socket.id));
    if (roomPresence.get(roomId).length === 0) roomPresence.delete(roomId);
    delete socket.data.roomId;
    broadcastPresence(roomId);
  }

  function addToPresence(socket, roomId, payload) {
    const users = roomPresence.get(roomId) || [];
    const identity = socket.user || {};
    users.push({
      socketId: socket.id,
      userId: identity.id || payload.userId,
      displayName: identity.displayName || payload.displayName,
      roomId,
    });
    roomPresence.set(roomId, users);
  }

  io.on("connection", (socket) => {
    socket.on("room:join", (payload) => {
      try {
        if (!isPlainObject(payload) || !isValidRoomId(payload.roomId)) {
          throw new Error("roomId must be a valid room identifier");
        }
        const userId = normalizeOptionalString(payload.userId, "userId", 128);
        const displayName = normalizeOptionalString(payload.displayName, "displayName", 128);

        // `socket.data.roomId` is an application-level hint. The adapter's
        // socket.rooms set is authoritative, including after reconnects.
        const alreadyMember =
          socket.data.roomId === payload.roomId &&
          socket.rooms &&
          typeof socket.rooms.has === "function" &&
          socket.rooms.has(payload.roomId);
        if (alreadyMember) {
          socket.emit("room:joined", {
            roomId: payload.roomId,
            presence: presenceFor(payload.roomId),
          });
          // Late-joiner convergence: deliver the current snapshot even on
          // idempotent rejoins (client merges; empty local boards adopt).
          socket.emit("canvas:sync-init", {
            roomId: payload.roomId,
            shapes: getRoomShapes(payload.roomId),
          });
          // Shared project: joiner-only snapshot so late joiners and
          // reconnects converge on the authoritative tree + file contents.
          socket.emit("project:state", {
            roomId: payload.roomId,
            data: projectSnapshot(getRoomProject(payload.roomId)),
          });
          return;
        }

        const prevRoom = socket.data.roomId;
        removeFromPresence(socket);
        if (prevRoom && prevRoom !== payload.roomId) {
          socket.leave(prevRoom);
        }
        socket.join(payload.roomId);
        if (!socket.rooms || !socket.rooms.has(payload.roomId)) {
          throw new Error("room join did not complete");
        }
        socket.data.roomId = payload.roomId;
        addToPresence(socket, payload.roomId, { userId, displayName });
        // Emission order matters (fixes presence-race flakes): the join's
        // `presence:update` broadcast goes out BEFORE the `room:joined`
        // ack. Socket.io preserves per-socket send order, so any listener
        // attached after observing `room:joined` can never catch this
        // stale join broadcast — it only sees subsequent events (leaves,
        // disconnects, later joins). Snapshot delivery stays last: it is
        // joiner-only and order-independent.
        broadcastPresence(payload.roomId);
        socket.emit("room:joined", {
          roomId: payload.roomId,
          presence: presenceFor(payload.roomId),
        });
        // Late-joiner convergence: current snapshot goes ONLY to the
        // joiner (not a room broadcast) so existing peers are undisturbed.
        socket.emit("canvas:sync-init", {
          roomId: payload.roomId,
          shapes: getRoomShapes(payload.roomId),
        });
        // Shared project snapshot (authoritative tree + per-file contents).
        socket.emit("project:state", {
          roomId: payload.roomId,
          data: projectSnapshot(getRoomProject(payload.roomId)),
        });
      } catch (error) {
        sendError(socket, "room:join", error.message, error.code ?? "INVALID_PAYLOAD");
      }
    });

    socket.on("room:leave", (payload) => {
      try {
        if (!isPlainObject(payload) || !isValidRoomId(payload.roomId)) {
          throw new Error("roomId must be a valid room identifier");
        }
        if (socket.data.roomId !== payload.roomId) {
          throw new Error("socket does not belong to this room");
        }

        const roomId = socket.data.roomId;
        removeFromPresence(socket);
        socket.leave(roomId);
        socket.emit("room:left", { roomId });
      } catch (error) {
        sendError(socket, "room:leave", error.message);
      }
    });

    // Shared project tree: the server is the authority. A creation is
    // validated, committed, then fanned out — ack to the creator (who opens
    // the node on receipt) plus broadcast to peers (whose active editors are
    // untouched). Rejections carry requestId so the creator's inline draft
    // can show the reason; first commit wins on simultaneous same-name
    // creates, the loser gets "already exists" — never a silent overwrite.
    //
    // Membership is NOT removed — it is grounded two ways (same contract as
    // the stroke/live-collab channels): the adapter-level socket.rooms set
    // is ground truth and the app-level tracker is re-synced on divergence.
    // Sockets that never joined are still rejected. Genuinely early sends
    // (before room:join is processed) are correctly rejected; the client
    // gates creates on the room:joined ack so users never hit this.
    socket.on("project:create-node", (payload) => {
      const nodeInput = isPlainObject(payload) && isPlainObject(payload.data) ? payload.data.node : null;
      try {
        if (!isPlainObject(payload) || !isValidRoomId(payload.roomId)) {
          throw new Error("payload must include a valid roomId");
        }
        let member = false;
        try {
          member =
            socket.rooms && typeof socket.rooms.has === "function"
              ? socket.rooms.has(payload.roomId)
              : socket.data.roomId === payload.roomId;
        } catch {
          member = socket.data.roomId === payload.roomId;
        }
        if (!member) {
          const dbg = socketRoomDebug(socket);
          console.warn(
            `[project] create-node rejected (not a member) socket=${socket.id} requested=${payload.roomId} tracked=${dbg.tracked} rooms=[${dbg.rooms.join(",")}]`
          );
          throw new Error("socket does not belong to this room");
        }
        if (socket.data.roomId !== payload.roomId) {
          socket.data.roomId = payload.roomId;
        }
        if (!isPlainObject(payload.data) || !hasAcceptableSize(payload.data)) {
          throw new Error("payload must include acceptable data");
        }
        const project = getRoomProject(payload.roomId);
        const node = validateProjectNode(nodeInput, project);
        project.nodes.set(node.id, node);
        if (node.type === "file") project.files.set(node.id, { text: "", rev: 0 });
        project.updatedAt = Date.now();
        const out = { roomId: payload.roomId, data: { node: publicNode(node) }, socketId: socket.id };
        socket.emit("project:node-created", out);
        socket.to(payload.roomId).emit("project:node-created", out);
      } catch (error) {
        const requestId = isPlainObject(nodeInput) && typeof nodeInput.id === "string" ? nodeInput.id : null;
        console.warn(`[project] create-node rejected room=${payload && payload.roomId} reason=${error.message}`);
        sendError(socket, "project:create-node", error.message, error.code ?? "INVALID_PAYLOAD", { requestId });
      }
    });

    socket.on("project:rename-node", (payload) => {
      const input = isPlainObject(payload) && isPlainObject(payload.data) ? payload.data.node : null;
      try {
        if (!isPlainObject(payload) || !isValidRoomId(payload.roomId)) throw new Error("payload must include a valid roomId");
        if (!socket.rooms.has(payload.roomId)) throw new Error("socket does not belong to this room");
        if (!isPlainObject(payload.data) || !hasAcceptableSize(payload.data)) throw new Error("payload must include acceptable data");
        const project = getRoomProject(payload.roomId);
        const node = validateProjectRename(input, project);
        project.nodes.set(node.id, node);
        project.updatedAt = Date.now();
        const out = { roomId: payload.roomId, data: { node: publicNode(node) }, socketId: socket.id };
        socket.emit("project:node-renamed", out);
        socket.to(payload.roomId).emit("project:node-renamed", out);
      } catch (error) {
        const requestId = isPlainObject(input) && typeof input.id === "string" ? input.id : null;
        sendError(socket, "project:rename-node", error.message, error.code ?? "INVALID_PAYLOAD", { requestId });
      }
    });

    socket.on("project:delete-node", (payload) => {
      const nodeId = isPlainObject(payload) && isPlainObject(payload.data) ? payload.data.nodeId : null;
      try {
        if (!isPlainObject(payload) || !isValidRoomId(payload.roomId)) throw new Error("payload must include a valid roomId");
        if (!socket.rooms.has(payload.roomId)) throw new Error("socket does not belong to this room");
        if (!isPlainObject(payload.data) || !hasAcceptableSize(payload.data)) throw new Error("payload must include acceptable data");
        const project = getRoomProject(payload.roomId);
        const deletedIds = projectDeleteIds(nodeId, project);
        for (const id of deletedIds) {
          project.nodes.delete(id);
          project.files.delete(id);
        }
        project.updatedAt = Date.now();
        const out = { roomId: payload.roomId, data: { deletedIds }, socketId: socket.id };
        socket.emit("project:nodes-deleted", out);
        socket.to(payload.roomId).emit("project:nodes-deleted", out);
      } catch (error) {
        sendError(socket, "project:delete-node", error.message, error.code ?? "INVALID_PAYLOAD", {
          requestId: typeof nodeId === "string" ? nodeId : null,
        });
      }
    });

    // On-demand authoritative snapshot (Explorer Refresh, panel remounts).
    // Joiner-only, like the room:join delivery — never a room broadcast.
    socket.on("project:state-request", (payload) => {
      try {
        if (!isPlainObject(payload) || !isValidRoomId(payload.roomId)) {
          throw new Error("payload must include a valid roomId");
        }
        if (socket.data.roomId !== payload.roomId) {
          throw new Error("socket does not belong to this room");
        }
        socket.emit("project:state", {
          roomId: payload.roomId,
          data: projectSnapshot(getRoomProject(payload.roomId)),
        });
      } catch (error) {
        sendError(socket, "project:state-request", error.message, error.code ?? "INVALID_PAYLOAD");
      }
    });

    for (const event of COLLABORATION_EVENTS) {
      socket.on(event, (payload) => {
        try {
          if (!isPlainObject(payload) || !isValidRoomId(payload.roomId)) {
            throw new Error("payload must include a valid roomId");
          }
          if (socket.data.roomId !== payload.roomId) {
            throw new Error("socket does not belong to this room");
          }
          if (!("data" in payload) || payload.data === undefined || !hasAcceptableSize(payload.data)) {
            throw new Error("payload must include acceptable data");
          }

          // Track legacy whiteboard ops in the room snapshot (code/cursor
          // payloads are ignored by the reducer). Runs BEFORE relay so an
          // over-cap mutation is rejected (connection:error) instead of
          // relayed-but-unstored. A capacity rejection likewise stops the
          // op entirely: no snapshot change, no relay (the coded error
          // below preserves ROOM_CAPACITY_EXHAUSTED).
          if (event === "canvas:update") {
            commitRoomMutation(socket.data.roomId, event, payload.data);
          }
          // Per-file code contents fold into the room project snapshot
          // BEFORE relay (same store-before-relay contract as canvas: an
          // over-cap write is rejected with connection:error instead of
          // relayed-but-unstored). Unknown fileIds and stale revs are
          // dropped outright (never relayed); legacy payloads pass through
          // untouched.
          if (event === "code:update") {
            if (!commitCodeUpdate(socket.data.roomId, payload.data)) return;
          }
          socket.to(socket.data.roomId).emit(event, {
            roomId: socket.data.roomId,
            data: payload.data,
            socketId: socket.id,
          });
        } catch (error) {
          sendError(socket, event, error.message, error.code ?? "INVALID_PAYLOAD");
        }
      });
    }

    // In-progress pen-stroke streaming: broadcast incremental points to
    // all OTHER clients in the room without sending back to the sender.
    // The relay itself is a single async emit (never blocks the loop);
    // validation above is O(points) with an early cap, no stringify.
    // Definitive room matching: relay on the VERIFIED payload roomId, with
    // membership decided by the adapter-level `socket.rooms` set (ground
    // truth) rather than the app-level `socket.data.roomId` tracker alone.
    // If the tracker diverged it is re-synced instead of dropping the
    // packet; sockets that never joined the room are still rejected, so
    // room-spoofing stays impossible (no blind auto-join on claim).
    // Self-instrumenting pipeline probe (audit): structured TRACE lines
    // for every stroke event. Enable with SYNCSPACE_STROKE_DEBUG=1 — kept
    // behind the flag so the ~30Hz hot path never spams production logs
    // (unconditional per-flush logging would itself add latency).
    const strokeDebugOn = process.env.SYNCSPACE_STROKE_DEBUG === "1";
    const traceServer = (...args) => {
      if (strokeDebugOn) console.log("[TRACE:SERVER]", ...args);
    };
    const traceServerError = (...args) => {
      if (strokeDebugOn) console.error("[TRACE:SERVER_ERROR]", ...args);
    };
    for (const event of STROKE_STREAM_EVENTS) {
      socket.on(event, (payload) => {
        try {
          // TRACE: incoming vs outgoing identity — pinpoints routing breaks.
          traceServer(`In-progress stroke received from ${socket.id}`, {
            event,
            payloadRoomId: payload?.roomId,
            socketJoinedRooms: Array.from(socket.rooms || []),
            trackedRoomId: socket.data.roomId ?? null,
            pointCount: payload?.data?.points?.length,
          });
          if (!payload?.roomId) {
            traceServerError("Missing payload.roomId!");
            throw new Error("payload must include a valid roomId");
          }
          assertStrokeStreamPayload(payload, event);
          const targetRoom = payload.roomId;
          let member = false;
          try {
            member =
              socket.rooms && typeof socket.rooms.has === "function"
                ? socket.rooms.has(targetRoom)
                : socket.data.roomId === targetRoom;
          } catch {
            member = socket.data.roomId === targetRoom;
          }
          if (!member) {
            // TRACE: sender not in the target room — packet must NOT relay
            // (blind force-join here would let any client inject into any
            // room, breaking room isolation; see stroke-streaming tests).
            traceServerError(
              `Sender ${socket.id} not in room "${targetRoom}" (joined: [${Array.from(socket.rooms || []).join(", ")}]) — packet dropped, spoofing rejected`
            );
            throw new Error("socket does not belong to this room");
          }
          if (socket.data.roomId !== targetRoom) {
            socket.data.roomId = targetRoom;
          }

          // Relay strictly to all other peers in the target room.
          // Stroke completions also fold into the room snapshot (the
          // authoritative commit op follows and dedupes by id). Stored
          // BEFORE relay so an over-cap completion is rejected loudly
          // instead of relayed-but-unstored.
          if (event === "draw:stroke-complete") {
            commitRoomMutation(targetRoom, event, payload.data);
          }
          socket.to(targetRoom).emit(event, {
            roomId: targetRoom,
            data: payload.data,
            socketId: socket.id,
          });
          traceServer(`Relayed ${event} to room "${targetRoom}" excluding sender ${socket.id}`);
        } catch (error) {
          traceServerError(`${event} from=${socket.id}: ${error.message}`);
          sendError(socket, event, error.message, error.code ?? "INVALID_PAYLOAD");
        }
      });
    }

    // Unified live-collaboration relay: ephemeral previews/cursors AND
    // committed mutations share one hardened path — verified roomId,
    // adapter-level membership (tracker re-synced on divergence, spoofers
    // rejected with connection:error), peers-only broadcast, TRACE probe.
    for (const event of LIVE_COLLAB_EVENTS) {
      socket.on(event, (payload) => {
        try {
          traceServer(`Live-collab received from ${socket.id}`, {
            event,
            payloadRoomId: payload?.roomId,
            socketJoinedRooms: Array.from(socket.rooms || []),
            trackedRoomId: socket.data.roomId ?? null,
          });
          assertLiveCollabPayload(payload, event);
          const targetRoom = payload.roomId;
          let member = false;
          try {
            member =
              socket.rooms && typeof socket.rooms.has === "function"
                ? socket.rooms.has(targetRoom)
                : socket.data.roomId === targetRoom;
          } catch {
            member = socket.data.roomId === targetRoom;
          }
          if (!member) {
            traceServerError(
              `Sender ${socket.id} not in room "${targetRoom}" (joined: [${Array.from(socket.rooms || []).join(", ")}]) — packet dropped, spoofing rejected`
            );
            throw new Error("socket does not belong to this room");
          }
          if (socket.data.roomId !== targetRoom) {
            socket.data.roomId = targetRoom;
          }

          // Ephemeral previews & cursor moves: broadcast only to other peers.
          // Committed mutations: broadcast to other peers (sender already
          // applied locally — loop-free by construction). Committed
          // mutations also fold into the room snapshot for late joiners;
          // ephemeral streams never touch it. Stored BEFORE relay so an
          // over-cap mutation is rejected loudly instead of
          // relayed-but-unstored.
          if (
            event === "shapes:commit" ||
            event === "shapes:update-batch" ||
            event === "shapes:delete" ||
            event === "canvas:clear" ||
            event === "canvas:history-sync"
          ) {
            commitRoomMutation(targetRoom, event, payload.data);
          }
          socket.to(targetRoom).emit(event, {
            roomId: targetRoom,
            data: payload.data,
            socketId: socket.id,
          });
          traceServer(`Relayed ${event} to room "${targetRoom}" excluding sender ${socket.id}`);
        } catch (error) {
          traceServerError(`${event} from=${socket.id}: ${error.message}`);
          sendError(socket, event, error.message, error.code ?? "INVALID_PAYLOAD");
        }
      });
    }

    socket.on("error", (error) => {
      sendError(socket, "socket", error?.message || "Socket error", "SOCKET_ERROR");
    });

    socket.on("disconnect", () => {
      removeFromPresence(socket);
    });
  });

  // Project capacity + lookup (exposed for regression tests).
  return { io, roomPresence, roomState, applyRoomMutation, getRoomProject, freeProjectCapacity };
}

module.exports = {
  createSocketServer,
  isValidRoomId,
  applyRoomMutation,
  MAX_ROOMS,
  MAX_ROOM_SHAPES,
  // Shared project surface (room-scoped file tree + per-file contents).
  createEmptyProject,
  ensureDefaultFile,
  validateProjectNode,
  validateProjectRename,
  projectDeleteIds,
  projectSnapshot,
  DEFAULT_FILE_ID,
  DEFAULT_FILE_NAME,
  MAX_PROJECT_NODES,
  MAX_NODE_NAME,
  MAX_FILE_TEXT_BYTES,
  MAX_PROJECT_TEXT_BYTES,
};
