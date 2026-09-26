import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useWhiteboardState from './hooks/useWhiteboardState.js';
import { autoStraightenStroke } from './utils/shapeRecognition.js';
import { snapMovingShape } from './utils/snapping.js';
import {
  applyRemoteStrokeEvent,
  buildStrokeProgressPayload,
  expireRemotePreviews,
  strokeDebug,
} from './utils/strokeStream.js';
import {
  applyRemotePreviewEvent,
  buildPreviewProgressPayload,
  lerpViewportStep,
  mergeRenderShapes,
  unpackViewportPayload,
} from './utils/liveSync.js';
import {
  bakeDragEnd,
  bakeTransform,
  boxesIntersect,
  circleRadius,
  createFrameShape,
  createGroupShape,
  createShape,
  DEFAULTS,
  duplicateShape,
  estimateTextWidth,
  getShapeAnchors,
  getShapeBounds,
  isFiniteNum,
  isShapeInsideFrame,
  isShapeIntersectingPoint,
  moveArrowEndpoint,
  normalizeRect,
  normalizeSelectBox,
  sanitizePoints,
  ungroupShape,
} from './utils/shapes.js';

const MIN_FREEHAND_STEP = 2; // px in world coords — draft optimization
const MIN_ZOOM = 0.25; // 25% minimum (zoom out allowed)
const MAX_ZOOM = 1.0; // 100% maximum — users can never zoom in past 100%

/**
 * useCanvasDrawing — Sayon (Whiteboard / Konva.js Engineer)
 *
 * Interaction layer (tools, viewport, text overlay, keyboard) on top of
 * `hooks/useWhiteboardState` (shape store + collab callbacks).
 *
 * Owns interaction state as PLAIN serializable objects (no Konva nodes).
 * All stored coordinates are WORLD coordinates; Stage scale/position
 * (viewport) never mutates shape data.
 *
 * Controlled mode: pass `shapes` prop (Yjs/Socket side owns array).
 * Uncontrolled mode: omit `shapes`, the store hook owns internal state.
 * Either way the collaboration callbacks always fire.
 */
export default function useCanvasDrawing({
  tool = 'select',
  color = '#1e1e1e',
  strokeWidth = 4,
  fill = 'transparent',
  strokeStyle = 'solid',
  opacity = 1,
  roughness = DEFAULTS.roughness,
  roundness = DEFAULTS.roundness,
  startArrowhead = DEFAULTS.startArrowhead,
  endArrowhead = DEFAULTS.endArrowhead,
  arrowType = DEFAULTS.arrowType,
  fontFamily = DEFAULTS.fontFamily,
  fontFamilyKey = DEFAULTS.fontFamilyKey,
  fontSize = DEFAULTS.fontSize,
  textAlign = DEFAULTS.textAlign,
  shapes: controlledShapes,
  selectedShapeId: controlledSelection,
  onShapeCreate,
  onShapeUpdate,
  onShapeDelete,
  onCanvasClear,
  onSelectionChange,
  onShapesReorder,
  // Called after a shape is committed (draw or text). The shell uses it
  // to return to select/move mode so no explicit Select button is needed.
  onDrawingCommitted,
  // Week 2: "Draw to Shape" toggle — when true, finished freehand strokes
  // are analyzed (circle/rect/line) and replaced by clean shapes.
  autoDetect = false,
  // Live pen-stroke streaming (optional): room-scoped socket used to
  // broadcast in-progress freehand points (`draw:stroke-progress`,
  // throttled ~30ms) and the finalized shape (`draw:stroke-complete`).
  // Omit both for standalone/offline boards — drawing stays local.
  socket = null,
  roomId = null,
} = {}) {
  // ---- shape store (local state + normalization + collab callbacks) ----
  const {
    shapes,
    selectedId,
    commitCreate,
    commitUpdate: storeCommitUpdate,
    deleteShape,
    selectShape,
    applyRemoteShapes,
    clearAll,
    sendToBack,
    bringToFront,
    sendBackward,
    bringForward,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useWhiteboardState({
    shapes: controlledShapes,
    selectedShapeId: controlledSelection,
    onShapeCreate,
    onShapeUpdate,
    onShapeDelete,
    onCanvasClear,
    onSelectionChange,
    onShapesReorder,
    // Unified-protocol transport for the shape store (effective in
    // uncontrolled mode; controlled shells propagate via callbacks).
    socket,
    roomId,
  });

  // Draft shape being drawn (NOT yet committed) — updating only this
  // small object on pointermove avoids re-mapping the full shapes array.
  const [draftShape, setDraftShape] = useState(null);
  const drawStartRef = useRef(null); // world point where drag began
  const isDrawingRef = useRef(false);

  // ---- live pen-stroke streaming refs (mutable, never trigger renders) ----
  const activeStrokeIdRef = useRef(null);
  const currentStrokePointsRef = useRef([]);
  const didStreamRef = useRef(false);
  // Latest style values for the in-flight stroke (pointermove closes over
  // stale props, so the current values ride a ref instead).
  const streamStyleRef = useRef({ tool: 'select', stroke: color, strokeWidth, opacity });
  streamStyleRef.current = { tool, stroke: color, strokeWidth, opacity };
  // Live mirror of committed shapes for the imperative drag path below
  // (plain ref write during render — no subscription, no re-render).
  const committedShapesRef = useRef(shapes);
  committedShapesRef.current = shapes;
  // Room id mirror for the receive subscription (socket identity is stable).
  const streamRoomIdRef = useRef(roomId);
  streamRoomIdRef.current = roomId;
  // Remote in-progress strokes from peers: { [strokeId]: previewShape }.
  // Render-only — never enters history, exports, or collab ops.
  const [remoteStrokes, setRemoteStrokes] = useState({});

  const emitStrokeEvent = useCallback(
    (event, data) => {
      try {
        // TRACE probe — pipeline stage 1 (client broadcast). Enable with
        // `window.__SYNCSPACE_STROKE_DEBUG = true`; silent otherwise so the
        // ~30Hz flush never spams production consoles.
        if (!socket || typeof socket.emit !== 'function') {
          strokeDebug('TRACE:CLIENT suppressed: no socket', { event });
          return;
        }
        if (!roomId) {
          strokeDebug('TRACE:CLIENT suppressed: no roomId', { event });
          return;
        }
        if (socket.connected === false) {
          strokeDebug('TRACE:CLIENT suppressed: socket NOT connected during drawing!', { event, roomId });
          return;
        }
        strokeDebug('TRACE:CLIENT emitting', event, {
          strokeId: data?.strokeId,
          pointCount: data?.points?.length,
          roomId,
          connected: socket.connected,
        });
        socket.emit(event, { roomId, data });
      } catch {
        // presence-style best-effort: never throw into the pointer path
      }
    },
    [socket, roomId],
  );

  // ---- fixed-tick broadcast (hardware-independent ~33Hz network rate) ----
  // All high-frequency emitters (pen points, shape previews, pan position)
  // funnel through ONE timestamp throttle instead of monitor-bound
  // requestAnimationFrame: a 144Hz screen therefore transmits at most once
  // per 30ms, so 60Hz (or slower) peers are never packet-flooded.
  // Leading edge fires immediately once the threshold has elapsed;
  // otherwise a trailing timer guarantees the final coordinates land.
  // Payloads are built from refs AT FIRE TIME (latest-wins): every flush
  // carries the newest buffer, never a stale closure.
  const TICK_INTERVAL_MS = 30;
  const lastTickEmitRef = useRef(0);
  const tickTimerRef = useRef(null);
  const tickPendingRef = useRef(new Set());

  const nowMs = () => {
    try {
      if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
      }
    } catch {
      // fall through to Date.now
    }
    return Date.now();
  };

  const flushTickChannels = useCallback(() => {
    const pending = tickPendingRef.current;
    tickPendingRef.current = new Set();
    if (pending.has('stroke')) {
      const payload = buildStrokeProgressPayload({
        strokeId: activeStrokeIdRef.current,
        points: currentStrokePointsRef.current,
        stroke: streamStyleRef.current.stroke,
        strokeWidth: streamStyleRef.current.strokeWidth,
        opacity: streamStyleRef.current.opacity,
      });
      if (payload) {
        didStreamRef.current = true;
        emitStrokeEvent('draw:stroke-progress', payload);
      }
    }
    if (pending.has('preview')) {
      const payload = buildPreviewProgressPayload({
        draftId: activePreviewIdRef.current,
        shape: previewBufferRef.current,
      });
      if (payload) {
        didPreviewRef.current = true;
        strokeDebug('TRACE:CLIENT emitting', 'shape:preview-progress', {
          draftId: payload.draftId,
          type: payload.shape?.type,
        });
        emitStrokeEvent('shape:preview-progress', payload);
      }
    }
    if (pending.has('viewport')) {
      try {
        const stage = stageRef.current;
        if (stage) {
          const scale = stage.scaleX() || 1;
          const pos = stage.position();
          if (isFiniteNum(scale) && isFiniteNum(pos?.x) && isFiniteNum(pos?.y)) {
            const last = lastEmittedPosRef.current;
            // Change detection: skip the packet when nothing moved since
            // the last flush (shared with the drop-path final emit).
            if (!last || pos.x !== last.x || pos.y !== last.y) {
              lastEmittedPosRef.current = { x: pos.x, y: pos.y };
              emitStrokeEvent('canvas:viewport-sync', {
                stagePos: { x: pos.x, y: pos.y },
                scale,
              });
            }
          }
        }
      } catch {
        // best-effort; never throw into gesture paths
      }
    }
  }, [emitStrokeEvent]);

  const scheduleTick = useCallback(
    (channel) => {
      tickPendingRef.current.add(channel);
      const now = nowMs();
      const elapsed = now - lastTickEmitRef.current;
      if (elapsed >= TICK_INTERVAL_MS) {
        if (tickTimerRef.current) {
          clearTimeout(tickTimerRef.current);
          tickTimerRef.current = null;
        }
        lastTickEmitRef.current = now;
        flushTickChannels();
      } else if (!tickTimerRef.current) {
        const wait = Math.max(0, TICK_INTERVAL_MS - elapsed);
        tickTimerRef.current = setTimeout(() => {
          tickTimerRef.current = null;
          lastTickEmitRef.current = nowMs();
          flushTickChannels();
        }, wait);
      }
    },
    [flushTickChannels],
  );

  /** Pen flush via the fixed tick (same trailing guarantee as before). */
  const scheduleStrokeProgress = useCallback(() => {
    scheduleTick('stroke');
  }, [scheduleTick]);

  /** Reset in-flight streaming state (tick drained by callers first). */
  const resetStrokeStream = useCallback(() => {
    activeStrokeIdRef.current = null;
    currentStrokePointsRef.current = [];
    didStreamRef.current = false;
  }, []);

  // ---- universal live-preview streaming refs (all non-pen draw tools) ----
  // Buffer carries a full draft-shape snapshot broadcast as
  // `shape:preview-progress` { draftId, shape } on the shared fixed tick.
  // Pen keeps its dedicated points channel.
  const activePreviewIdRef = useRef(null);
  const previewBufferRef = useRef(null);
  const didPreviewRef = useRef(false);

  const schedulePreviewFlush = useCallback(() => {
    scheduleTick('preview');
  }, [scheduleTick]);

  /** Reset live-preview state (tick drained by callers first). */
  const resetPreviewStream = useCallback(() => {
    activePreviewIdRef.current = null;
    previewBufferRef.current = null;
    didPreviewRef.current = false;
  }, []);

  const clearPreviewTimer = useCallback(() => {
    // Drop any unsent preview without flushing (abort paths).
    tickPendingRef.current.delete('preview');
  }, []);

  /** Drain pending tick work immediately (drop-path final emits). */
  const flushPendingTick = useCallback(() => {
    if (tickTimerRef.current) {
      clearTimeout(tickTimerRef.current);
      tickTimerRef.current = null;
    }
    if (tickPendingRef.current.size > 0) {
      lastTickEmitRef.current = nowMs();
      flushTickChannels();
    }
  }, [flushTickChannels]);

  // Room switch mid-stroke: drop in-flight buffers/timers so a stale
  // stroke or preview can never leak into the new room, and clear stale
  // remote previews — the receive guard (streamRoomIdRef) already tracks
  // the current roomId every render, so post-switch events filter correctly.
  const prevStreamRoomRef = useRef(roomId);
  useEffect(() => {
    if (prevStreamRoomRef.current === roomId) return;
    prevStreamRoomRef.current = roomId;
    if (tickTimerRef.current) {
      clearTimeout(tickTimerRef.current);
      tickTimerRef.current = null;
    }
    tickPendingRef.current = new Set();
    resetStrokeStream();
    clearPreviewTimer();
    resetPreviewStream();
    if (viewportTimerRef.current) {
      clearTimeout(viewportTimerRef.current);
      viewportTimerRef.current = null;
    }
    if (viewportLerpRafRef.current) {
      cancelAnimationFrame(viewportLerpRafRef.current);
      viewportLerpRafRef.current = null;
    }
    viewportLerpTargetRef.current = null;
    lastEmittedPosRef.current = null;
    // Room initialization resets the viewport to 100%: a stale zoom (e.g.
    // 273% from the previous room) must never carry over on room switch.
    try {
      viewportMirrorRef.current = { x: 0, y: 0, scale: 1, at: Date.now() };
    } catch {
      // best-effort; state reset below still applies
    }
    setScale(1);
    setStagePos({ x: 0, y: 0 });
    setRemoteStrokes({});
  }, [roomId, resetStrokeStream, clearPreviewTimer, resetPreviewStream]);

  // Drop the throttle timers on unmount mid-stroke.
  useEffect(
    () => () => {
      if (tickTimerRef.current) {
        clearTimeout(tickTimerRef.current);
        tickTimerRef.current = null;
      }
      if (viewportTimerRef.current) {
        clearTimeout(viewportTimerRef.current);
        viewportTimerRef.current = null;
      }
    },
    [],
  );

  // ---- inbound remote strokes: previews merge into renderShapes ----
  // Drag previews for COMMITTED ids bypass state via tryImperativeDragMove
  // (direct Konva mutation, see below); everything else uses the map.
  const tryImperativeDragMove = useCallback((data) => {
    try {
      const shape = data?.shape;
      if (!shape || typeof shape.id !== 'string') return false;
      const known = (committedShapesRef.current ?? []).some((s) => s?.id === shape.id);
      if (!known) return false;
      const node =
        shapeNodesRef.current.get(shape.id) ??
        stageRef.current?.findOne?.(`#${shape.id}`) ??
        null;
      if (!node || typeof node.position !== 'function') return false;
      const attrs = dragPreviewNodeUpdate(shape);
      if (!attrs) return false;
      node.position({ x: attrs.x, y: attrs.y });
      if (attrs.points && typeof node.points === 'function') node.points(attrs.points);
      if (attrs.rotation !== undefined && typeof node.rotation === 'function') {
        node.rotation(attrs.rotation);
      }
      node.getLayer()?.batchDraw();
      strokeDebug('TRACE:CLIENT imperative drag move', { id: shape.id });
      return true;
    } catch {
      return false;
    }
  }, []);
  useEffect(() => {
    if (!socket || typeof socket.on !== 'function') return undefined;
    const makeHandler = (event) => (payload) => {
      // TRACE probe — pipeline stage 3 (client reception): room match +
      // sender identity. Mismatched rooms return silently by design.
      if (!payload || payload.roomId !== streamRoomIdRef.current) {
        strokeDebug('TRACE:CLIENT ignored', event, {
          payloadRoom: payload?.roomId ?? null,
          expectedRoom: streamRoomIdRef.current,
        });
        return;
      }
      strokeDebug('TRACE:CLIENT received', event, {
        strokeId: payload.data?.strokeId,
        pointCount: payload.data?.points?.length,
        from: payload.socketId ?? null,
      });
      setRemoteStrokes((prev) => applyRemoteStrokeEvent(prev, event, payload.data, payload.socketId ?? null));
    };
    const onProgress = makeHandler('draw:stroke-progress');
    const onComplete = makeHandler('draw:stroke-complete');
    const onCancel = makeHandler('draw:stroke-cancel');
    socket.on('draw:stroke-progress', onProgress);
    socket.on('draw:stroke-complete', onComplete);
    socket.on('draw:stroke-cancel', onCancel);
    // Unified live-collab preview + commit-side cleanup channels. Creation
    // previews for every tool merge into the same render-only map;
    // commit/delete/clear/history events reconcile it when authoritative
    // ops land (or standalone, where no authoritative op follows).
    const makePreviewHandler = (event) => (payload) => {
      if (!payload || payload.roomId !== streamRoomIdRef.current) return;
      strokeDebug('TRACE:CLIENT received', event, {
        draftId: payload.data?.draftId ?? payload.data?.shape?.id ?? null,
        from: payload.socketId ?? null,
      });
      // Imperative drag fast path: when a progress preview targets an
      // already-committed shape id (live drag transform), mutate the Konva
      // node DIRECTLY — position/points + one layer batchDraw — instead of
      // routing through setRemoteStrokes (which would re-render + reconcile
      // per packet). O(1) DOM writes, zero React work. Creation previews
      // (unknown ids) and all non-progress events keep the state path.
      if (event === 'shape:preview-progress' && tryImperativeDragMove(payload.data)) return;
      setRemoteStrokes((prev) => applyRemotePreviewEvent(prev, event, payload.data, payload.socketId ?? null));
    };
    const previewEvents = [
      'shape:preview-progress',
      'shape:preview-cancel',
      'shapes:commit',
      'shapes:delete',
      'canvas:clear',
      'canvas:history-sync',
    ];
    const previewHandlers = previewEvents.map((event) => [event, makePreviewHandler(event)]);
    for (const [event, handler] of previewHandlers) socket.on(event, handler);
    return () => {
      try {
        socket.off?.('draw:stroke-progress', onProgress);
        socket.off?.('draw:stroke-complete', onComplete);
        socket.off?.('draw:stroke-cancel', onCancel);
        for (const [event, handler] of previewHandlers) socket.off?.(event, handler);
      } catch {
        // ignore teardown failures
      }
    };
  }, [socket]);

  // TRACE probe — pipeline stage 4 (Konva rendering): live preview count
  // changes only — silent when zero so the flag costs nothing at rest.
  // A rising count here with nothing painting on stage isolates the break
  // to CanvasStage.jsx / ShapeRenderer.jsx.
  useEffect(() => {
    const n = Object.keys(remoteStrokes ?? {}).length;
    if (n > 0) strokeDebug('TRACE:CLIENT remote previews live (renderShapes):', n);
  }, [remoteStrokes]);

  // Stale-preview expiry: an active stroke/drag re-upserts every ~35ms
  // (refreshing receivedAt), so only orphaned ghosts — e.g. a drop whose
  // cancel was lost on disconnect — age out (20s). Backstop behind the
  // authoritative cancel/commit cleanup, never ahead of it.
  useEffect(() => {
    const timer = setInterval(() => {
      setRemoteStrokes((prev) => expireRemotePreviews(prev));
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Text overlay editor state: { mode: 'create'|'edit', worldX, worldY, value, shapeId? }
  const [textEditor, setTextEditor] = useState(null);

  // Viewport (never stored in shapes): zoom + pan offset.
  const [scale, setScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const stageRef = useRef(null);
  const shapeNodesRef = useRef(new Map()); // shapeId -> Konva node
  const transformerRef = useRef(null);

  // Smart alignment guides: active snap lines in world coords, rendered
  // by CanvasStage's guidelines layer. Cleared on drag end.
  const [guidelines, setGuidelines] = useState([]);

  // Marquee multi-selection: drag over empty canvas with the Select tool
  // tracks a selection rectangle (world coords). Pointer-up selects all
  // shapes whose bounding boxes intersect it.
  const [selectBox, setSelectBox] = useState(null);
  const marqueeStartRef = useRef(null);
  const marqueeActiveRef = useRef(false);

  // Multi-selection: ordered list of selected ids. `selectedId` (store)
  // stays the primary single selection for sidebars/exports; selectedIds
  // mirrors it plus marquee additions for the shared Transformer.
  const [selectedIds, setSelectedIds] = useState([]);
  const selectedIdsRef = useRef([]);
  useEffect(() => {
    if (selectedId) {
      selectedIdsRef.current = [selectedId];
      setSelectedIds((cur) => (cur.length === 1 && cur[0] === selectedId ? cur : [selectedId]));
    } else if (!marqueeActiveRef.current) {
      selectedIdsRef.current = [];
      setSelectedIds((cur) => (cur.length === 0 ? cur : []));
    }
  }, [selectedId]);

  /** Select several shapes at once (marquee / shift-click future). */
  const selectShapes = useCallback(
    (ids) => {
      const clean = Array.isArray(ids) ? [...new Set(ids.filter(Boolean))] : [];
      selectedIdsRef.current = clean;
      setSelectedIds(clean);
      selectShape(clean[0] ?? null);
      // Attach all selected nodes to the active Transformer immediately
      // (synchronous bridge; the CanvasStage effect re-attaches on render).
      const tr = transformerRef.current;
      if (tr) {
        const nodes = clean
          .map((id) => shapeNodesRef.current.get(id) ?? stageRef.current?.findOne?.(`#${id}`) ?? null)
          .filter(Boolean);
        tr.nodes(nodes);
        tr.getLayer()?.batchDraw();
      }
    },
    [selectShape],
  );

  // Store wrappers: keep the in-progress draft in sync and drop dead node refs.
  // Detach runs on EVERY delete path (button, keyboard, empty text edit)
  // so the Transformer never survives its node.
  const detachTransformerFrom = useCallback((shapeId) => {
    const victim = shapeId ? shapeNodesRef.current.get(shapeId) : null;
    const transformer = transformerRef.current;
    if (transformer && victim && transformer.nodes().includes(victim)) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
    }
    shapeNodesRef.current.delete(shapeId);
  }, []);

  const commitUpdate = useCallback(
    (shapeId, changes) => {
      storeCommitUpdate(shapeId, changes);
      if (changes && Object.keys(changes).length > 0) {
        const clean = JSON.parse(JSON.stringify(changes));
        setDraftShape((d) => (d && d.id === shapeId ? { ...d, ...clean } : d));
      }
    },
    [storeCommitUpdate],
  );

  const commitDelete = useCallback(
    (shapeId) => {
      // Detach the Transformer BEFORE removal so it never holds a
      // reference to a detached node (which broke later selections
      // and forced users to hit Clear to recover).
      // Atomic store delete: resets selection to null so no stale id
      // survives (e.g. empty-text-edit deletes).
      detachTransformerFrom(shapeId);
      deleteShape(shapeId);
    },
    [detachTransformerFrom, deleteShape],
  );

  // ---- drag-erase: pointer-down + move with the eraser deletes every
  // shape under the cursor on contact. Hits batch into ONE deleteShape
  // call per sweep step, so peers receive a single `shapes:delete`
  // (uncontrolled+socket) or one delete op per shape (controlled shell)
  // immediately — nothing waits for pointerup, nothing is left orphaned.
  // Click-to-delete (handleShapeClick) keeps working for single taps.
  // Declared HERE (above all pointer handlers) on purpose: the stage
  // handlers list this callback in their useCallback dep arrays, which
  // evaluate eagerly during render — a declaration below them would throw
  // `ReferenceError: can't access lexical declaration before
  // initialization` (TDZ) and white-screen the board.
  const eraserDownRef = useRef(false);

  const eraseAtPoint = useCallback(
    (world) => {
      if (!world) return 0;
      const hits = (shapes ?? []).filter(
        (s) => s && !s.remotePreview && isShapeIntersectingPoint(s, world),
      );
      if (hits.length === 0) return 0;
      for (const h of hits) detachTransformerFrom(h.id);
      deleteShape(hits.map((h) => h.id));
      return hits.length;
    },
    [shapes, detachTransformerFrom, deleteShape],
  );

  // ---- connector follow: re-attach bound arrow ends after a shape settles.
  // Declared HERE (above all pointer/shape handlers) on purpose, same TDZ
  // rule as the eraser callbacks above: `handleShapeDragEnd` lists this
  // callback in its useCallback dep array, which evaluates eagerly during
  // render — a declaration below it throws `ReferenceError: can't access
  // lexical declaration before initialization` and white-screens the board.
  // `movedShape` is the committed post-drag descriptor; each attached arrow
  // commits once (own history entry + broadcast). Arrows bound to a
  // missing/renamed anchor keep their coordinates. No-op for shapes without
  // anchors (arrows/lines/strokes can't be snap targets).
  const followBoundArrows = useCallback(
    (movedId, movedShape) => {
      const anchors = getShapeAnchors(movedShape);
      if (anchors.length === 0) return;
      for (const a of shapes ?? []) {
        if (!a || a.type !== 'arrow' || a.remotePreview) continue;
        if (!Array.isArray(a.points) || a.points.length < 4) continue;
        let next = null;
        for (const end of ['start', 'end']) {
          const key = end === 'start' ? 'startBinding' : 'endBinding';
          const binding = a[key];
          if (!binding || binding.shapeId !== movedId) continue;
          const anchor = anchors.find((k) => k.anchor === binding.anchor);
          if (!anchor) continue;
          const aNode = shapeNodesRef.current.get(a.id);
          const ox = aNode ? aNode.x() : 0;
          const oy = aNode ? aNode.y() : 0;
          next = moveArrowEndpoint(next ?? a.points, end, anchor.x - ox, anchor.y - oy);
          if (!next) break;
        }
        if (next) {
          // Imperative nudge so the arrow tracks immediately; the commit
          // below re-renders authoritatively with identical values.
          try {
            const aNode = shapeNodesRef.current.get(a.id);
            if (aNode) {
              aNode.points(next);
              aNode.getLayer()?.batchDraw();
            }
          } catch {
            // best-effort; the commit still converges
          }
          commitUpdate(a.id, { points: next });
        }
      }
    },
    [shapes, commitUpdate],
  );

  // ---- coordinate helpers: viewport <-> world ----
  const toWorld = useCallback(
    (stage, viewportPoint) => {
      const s = stage ? stage.scaleX() : scale;
      const pos = stage ? stage.position() : stagePos;
      return {
        x: (viewportPoint.x - pos.x) / s,
        y: (viewportPoint.y - pos.y) / s,
      };
    },
    [scale, stagePos],
  );

  const toScreen = useCallback(
    (worldPoint) => ({
      x: worldPoint.x * scale + stagePos.x,
      y: worldPoint.y * scale + stagePos.y,
    }),
    [scale, stagePos],
  );

  // Viewport (stage container) -> world coordinates.
  //
  // ALWAYS resolve through `stageRef.current` + `getRelativePointerPosition()`.
  // Never use `event.target`, `e.evt.offsetX/layerX`, or target-local coords:
  // when the pointer is over an existing shape, `event.target` is that child
  // shape and DOM offsets are relative to it, so new shapes would spawn far
  // from the cursor.
  //
  // `stage.getRelativePointerPosition()` applies the inverse of the stage's
  // absolute transform (scale + pan offset) to the container-relative pointer,
  // so it already returns WORLD coordinates — including correct results when
  // zoomed/panned and identical results whether the pointer is over empty
  // canvas or on top of an existing shape. Do NOT run it through `toWorld`
  // again (that would double-apply scale/offset).
  const getWorldFromEvent = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pointer = stage.getRelativePointerPosition();
    if (!pointer) return null;
    const { x, y } = pointer;
    // Pointer releases without a drag (or pointer-leave) can yield
    // NaN/undefined coords — never let those reach shape math or Konva.
    if (!isFiniteNum(x) || !isFiniteNum(y)) return null;
    return { x, y };
  }, []);

  // ---- Stage pointer handlers ----
  const handleStageMouseDown = useCallback(
    (event) => {
      // Click on empty area: select tool deselects; text tool places editor.
      const clickedOnEmpty = event.target === event.target.getStage();
      // Stage-ref resolution: identical world point whether the pointer is
      // over empty canvas or inside/on top of an existing shape.
      const world = getWorldFromEvent();
      if (!world) return;

      // 'selection' is an alias of 'select' (spec + legacy callers).
      const isSelectTool = tool === 'select' || tool === 'selection';
      if (isSelectTool || tool === 'pan' || tool === 'eraser') {
        if (tool === 'eraser') {
          // Drag-erase gesture begins here; contact deletions run on move.
          // Erasing the down-point immediately covers taps whose pointer
          // never moves before click (click-to-delete fires as well and
          // no-ops on the already-gone guard).
          eraserDownRef.current = true;
          eraseAtPoint(world);
          if (clickedOnEmpty) selectShape(null);
          return;
        }
        if (isSelectTool && clickedOnEmpty) {
          // Marquee multi-selection: dragging over empty canvas tracks a
          // selection rectangle; a plain click (no drag) deselects on up.
          marqueeStartRef.current = world;
          marqueeActiveRef.current = true;
          setSelectBox({ x: world.x, y: world.y, width: 0, height: 0 });
          return;
        }
        if (clickedOnEmpty) selectShape(null);
        return; // dragging shapes / stage pan handled by Konva draggable
      }

      if (tool === 'text') {
        // Text places ANYWHERE — empty canvas or inside/on top of an
        // existing shape (shapes are non-listening in text mode, and
        // this handler ignores the event target on purpose).
        if (!textEditor) {
          const screen = toScreen(world);
          setTextEditor({
            mode: 'create',
            shapeId: null,
            worldX: world.x,
            worldY: world.y,
            screenX: screen.x,
            screenY: screen.y,
            value: '',
            align: textAlign,
            textAlign,
          });
        }
        return;
      }

      // Drawing tools: begin draft (not yet in shapes array).
      // 'pen' is an alias of 'freehand' (legacy callers / spec wording).
      // All points are absolute world coords from getRelativePointerPosition().
      // 'frame' seeds a slide-container draft (drag-to-create bounds).
      if (tool === 'frame') {
        const frameCount = (shapes ?? []).filter((s) => s?.type === 'frame').length;
        const seed = createFrameShape({
          x: world.x,
          y: world.y,
          width: 0,
          height: 0,
          count: frameCount + 1,
        });
        if (!seed) return;
        isDrawingRef.current = true;
        drawStartRef.current = world;
        setDraftShape(seed);
        selectShape(null);
        // Seed the universal live-preview buffer: peers see the frame grow
        // from the first pointermove via `shape:preview-progress`.
        activePreviewIdRef.current = seed.id;
        previewBufferRef.current = { ...seed };
        return;
      }
      const drawTool = tool === 'pen' ? 'freehand' : tool;
      const seed = createShape(drawTool, world, {
        color,
        strokeWidth,
        fill,
        strokeStyle,
        opacity,
        roughness,
        roundness,
        startArrowhead,
        endArrowhead,
        arrowType,
        fontFamily,
        fontFamilyKey,
        fontSize,
        textAlign,
      });
      if (!seed) return;
      isDrawingRef.current = true;
      drawStartRef.current = world;
      setDraftShape(seed);
      if (drawTool !== 'freehand') {
        selectShape(null);
        // Seed the universal live-preview buffer for every non-pen tool —
        // peers see rects/circles/arrows grow via `shape:preview-progress`.
        activePreviewIdRef.current = seed.id;
        previewBufferRef.current = { ...seed };
      } else {
        // Seed the live-stream refs: peers receive incremental points
        // from the first pointermove until pointerup completes/cancels.
        activeStrokeIdRef.current = seed.id;
        currentStrokePointsRef.current = [...(seed.points ?? [])];
      }
    },
    [color, fill, fontFamily, fontFamilyKey, fontSize, textAlign, getWorldFromEvent, arrowType, endArrowhead, eraseAtPoint, opacity, roughness, roundness, selectShape, shapes, startArrowhead, strokeStyle, strokeWidth, textEditor, toScreen, tool],
  );

  const handleStageMouseMove = useCallback(
    (event) => {
      // Drag-erase sweep: delete every shape under the cursor on contact.
      // Runs ahead of marquee/draft handling; the eraser owns the gesture
      // from its pointerdown until pointerup/leave resets eraserDownRef.
      if (tool === 'eraser' && eraserDownRef.current) {
        const world = getWorldFromEvent();
        if (world) eraseAtPoint(world);
        return;
      }
      // Marquee drag: render the semi-transparent blue selection rectangle
      // (rgba(59,130,246,0.15) + dashed border in CanvasStage) live.
      if (marqueeActiveRef.current && marqueeStartRef.current) {
        const world = getWorldFromEvent();
        if (!world) return;
        const start = marqueeStartRef.current;
        setSelectBox({
          x: start.x,
          y: start.y,
          width: world.x - start.x,
          height: world.y - start.y,
        });
        return;
      }
      if (!isDrawingRef.current || !draftShape || !drawStartRef.current) return;
      const world = getWorldFromEvent();
      if (!world) return;
      const start = drawStartRef.current;
      if (!isFiniteNum(start.x) || !isFiniteNum(start.y)) return;

      switch (draftShape.type) {
        case 'freehand': {
          const pts = Array.isArray(draftShape.points) ? draftShape.points : [];
          if (pts.length < 2) return;
          const dx = world.x - pts[pts.length - 2];
          const dy = world.y - pts[pts.length - 1];
          if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
          // Draft optimization: skip points closer than MIN_FREEHAND_STEP
          // and update only the small draft object (no full-array map).
          if (Math.hypot(dx, dy) < MIN_FREEHAND_STEP) return;
          setDraftShape((d) =>
            d ? { ...d, points: [...d.points, world.x, world.y] } : d,
          );
          // Live streaming: accumulate the same point into the in-flight
          // buffer and flush a throttled progress event to room peers so
          // the stroke renders remotely BEFORE pointerup. Local preview
          // updates immediately above; the broadcast trails by ~30ms.
          if (streamStyleRef.current.tool === 'pen' || streamStyleRef.current.tool === 'freehand') {
            if (activeStrokeIdRef.current && draftShape.id === activeStrokeIdRef.current) {
              currentStrokePointsRef.current.push(world.x, world.y);
              scheduleStrokeProgress();
            }
          }
          break;
        }
        case 'rectangle':
        case 'diamond':
        case 'frame': {
          const norm = normalizeRect(start.x, start.y, world.x, world.y);
          setDraftShape((d) => (d ? { ...d, ...norm } : d));
          // Universal live preview: absolute (non-incremental) bounds merge
          // onto the seeded buffer, then flush throttled to room peers.
          if (activePreviewIdRef.current && draftShape.id === activePreviewIdRef.current) {
            previewBufferRef.current = { ...(previewBufferRef.current ?? draftShape), ...norm };
            schedulePreviewFlush();
          }
          break;
        }
        case 'circle': {
          const r = circleRadius(start.x, start.y, world.x, world.y);
          if (!Number.isFinite(r)) return;
          setDraftShape((d) => (d ? { ...d, radius: r } : d));
          if (activePreviewIdRef.current && draftShape.id === activePreviewIdRef.current) {
            previewBufferRef.current = { ...(previewBufferRef.current ?? draftShape), radius: r };
            schedulePreviewFlush();
          }
          break;
        }
        case 'line':
        case 'arrow': {
          setDraftShape((d) =>
            d ? { ...d, points: [start.x, start.y, world.x, world.y] } : d,
          );
          if (activePreviewIdRef.current && draftShape.id === activePreviewIdRef.current) {
            previewBufferRef.current = {
              ...(previewBufferRef.current ?? draftShape),
              points: [start.x, start.y, world.x, world.y],
            };
            schedulePreviewFlush();
          }
          break;
        }
        default:
          break;
      }
    },
    [draftShape, getWorldFromEvent, scheduleStrokeProgress, schedulePreviewFlush, tool, eraseAtPoint],
  );

  const handleStageMouseUp = useCallback(() => {
    // End any drag-erase sweep (pointerup AND pointerleave both land here —
    // CanvasStage wires onPointerLeave to this handler).
    if (eraserDownRef.current) eraserDownRef.current = false;
    // Marquee release: select all shapes whose bounding boxes intersect
    // the selection rectangle, then attach them to the Transformer.
    if (marqueeActiveRef.current) {
      marqueeActiveRef.current = false;
      const start = marqueeStartRef.current;
      const box = selectBox;
      marqueeStartRef.current = null;
      setSelectBox(null);
      if (start && box && (Math.abs(box.width) > 4 || Math.abs(box.height) > 4)) {
        const norm = normalizeSelectBox(start.x, start.y, start.x + box.width, start.y + box.height);
        const hits = (shapes ?? []).filter((s) => {
          const b = getShapeBounds(s);
          if (!b) return false;
          const nb = { x: Math.min(b.x, b.x + b.width), y: Math.min(b.y, b.y + b.height), width: Math.abs(b.width), height: Math.abs(b.height) };
          return boxesIntersect(norm, nb);
        }).map((s) => s.id);
        if (hits.length > 0) {
          selectShapes(hits);
        } else {
          selectShapes([]);
        }
      } else {
        // Plain click on empty space: deselect.
        selectShapes([]);
      }
      return;
    }
    if (!isDrawingRef.current || !draftShape) return;
    isDrawingRef.current = false;
    const finished = draftShape;
    setDraftShape(null);
    drawStartRef.current = null;

    // Live streaming: settle the remote preview for the in-flight stroke.
    // `endStream(shape)` finalizes peers — `draw:stroke-complete` with the
    // committed shape, or `draw:stroke-cancel` when the stroke was
    // discarded — then resets the streaming refs. No-ops when nothing was
    // ever broadcast (standalone boards, non-pen tools, unmoved clicks).
    // The pending tick drains first so trailing coordinates land before
    // the complete/cancel settles the preview (didStream flags update).
    flushPendingTick();
    clearPreviewTimer();
    // Universal live preview settle: cancel the peer preview when one was
    // broadcast. Fires on BOTH degenerate aborts and successful commits —
    // on commit the authoritative `canvas:update` create op delivers the
    // persisted shape (id-dedupe covers either arrival order). No-ops when
    // no preview was ever broadcast (pen path uses endStream instead).
    const endPreview = () => {
      const pid = activePreviewIdRef.current;
      if (pid && didPreviewRef.current) {
        emitStrokeEvent('shape:preview-cancel', { draftId: pid });
      }
      resetPreviewStream();
    };
    const endStream = (committedShape) => {
      const sid = activeStrokeIdRef.current;
      if (sid && didStreamRef.current) {
        if (committedShape) {
          emitStrokeEvent('draw:stroke-complete', { strokeId: sid, shape: committedShape });
        } else {
          emitStrokeEvent('draw:stroke-cancel', { strokeId: sid });
        }
      }
      resetStrokeStream();
    };

    // Discard degenerate shapes (click without drag) and anything with
    // non-finite geometry so NaN never reaches Konva or the store.
    // Every exit settles BOTH streams (each no-ops when inactive: pen
    // drafts never seed previews and vice versa).
    if (finished.type === 'frame') {
      const w = finished.width;
      const h = finished.height;
      if (!isFiniteNum(w) || !isFiniteNum(h)) return (endStream(null), endPreview());
      if (!isFiniteNum(finished.x) || !isFiniteNum(finished.y)) return (endStream(null), endPreview());
      if (Math.abs(w) < 10 || Math.abs(h) < 10) return (endStream(null), endPreview());
    } else if (finished.type === 'rectangle' || finished.type === 'diamond') {
      const w = finished.width;
      const h = finished.height;
      if (!isFiniteNum(w) || !isFiniteNum(h)) return (endStream(null), endPreview());
      if (!isFiniteNum(finished.x) || !isFiniteNum(finished.y)) return (endStream(null), endPreview());
      if (Math.abs(w) < 2 || Math.abs(h) < 2) return (endStream(null), endPreview());
    } else if (finished.type === 'circle') {
      if (!isFiniteNum(finished.x) || !isFiniteNum(finished.y)) return (endStream(null), endPreview());
      const radii = [finished.radius, finished.radiusX, finished.radiusY].filter((v) => v !== undefined);
      if (radii.some((v) => !isFiniteNum(v))) return (endStream(null), endPreview());
      const biggest = Math.max(0, ...radii);
      if (biggest < 2) return (endStream(null), endPreview());
    } else if (finished.type === 'line' || finished.type === 'arrow' || finished.type === 'freehand') {
      // Validate line/arrow/freehand points: drop non-finite entries;
      // abort unless at least one full (x, y) pair survives.
      const clean = sanitizePoints(finished.points);
      if (clean.length < 4) return (endStream(null), endPreview());
      if (clean.some((v) => !Number.isFinite(v))) return (endStream(null), endPreview());
      // Endpoints decide: arrows may carry extra bend points, so compare
      // first vs last instead of assuming a 4-number array.
      const dx = clean[clean.length - 2] - clean[0];
      const dy = clean[clean.length - 1] - clean[1];
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return (endStream(null), endPreview());
      if (Math.hypot(dx, dy) < 2) return (endStream(null), endPreview());
      // Week 2 "Draw to Shape": locked to the Pen tool — recognized only
      // when the stroke was drawn with tool === 'pen'/'freehand' AND the
      // toggle is on. Strokes finished under any other tool stay raw, and
      // switching away from Pen bypasses recognition entirely.
      const isPenTool = tool === 'pen' || tool === 'freehand';
      if (autoDetect && isPenTool && finished.type === 'freehand') {
        const recognized = autoStraightenStroke(
          { ...finished, points: clean },
          { color, strokeWidth, fill, strokeStyle, opacity, roughness, roundness },
        );
        if (recognized) {
          commitCreate(recognized);
          selectShape(recognized.id);
          onDrawingCommitted?.();
          endStream(recognized);
          endPreview();
          return;
        }
      }
      const committed = { ...finished, points: clean };
      commitCreate(committed);
      selectShape(finished.id);
      onDrawingCommitted?.();
      endStream(committed);
      endPreview();
      return;
    }

    commitCreate(finished);
    selectShape(finished.id);
    onDrawingCommitted?.();
    endStream(finished);
    endPreview();
  }, [autoDetect, tool, color, commitCreate, draftShape, emitStrokeEvent, fill, flushPendingTick, onDrawingCommitted, opacity, resetStrokeStream, resetPreviewStream, clearPreviewTimer, roughness, roundness, selectShape, selectShapes, selectBox, shapes, strokeStyle, strokeWidth]);

  // ---- shared viewport sync (pan/zoom mirror, last-writer-wins) ----
  // Broadcasts are trailing-edge throttled (~120ms, wheel fires at 60Hz+)
  // and read the LIVE stage so the flush always carries current values.
  // Inbound applies set state + mutate the stage directly (never emit),
  // so convergence is loop-free by construction.
  const viewportTimerRef = useRef(null);
  // Last emitted pan position for change detection (declared up here so
  // every handler below can close over it without TDZ hazards). Shared by
  // the fixed-tick viewport channel and the drop-path final emit.
  const lastEmittedPosRef = useRef(null);

  const scheduleViewportSync = useCallback(() => {
    if (viewportTimerRef.current) return;
    viewportTimerRef.current = setTimeout(() => {
      viewportTimerRef.current = null;
      try {
        const stage = stageRef.current;
        if (!stage) return;
        const scale = stage.scaleX() || 1;
        const pos = stage.position();
        if (!isFiniteNum(scale) || !isFiniteNum(pos?.x) || !isFiniteNum(pos?.y)) return;
        emitStrokeEvent('canvas:viewport-sync', {
          stagePos: { x: pos.x, y: pos.y },
          scale,
        });
      } catch {
        // best-effort; never throw into gesture paths
      }
    }, 120);
  }, [emitStrokeEvent]);

  // Last mirrored viewport (prevents render storms: direct node mutation
  // runs every packet while React state mirrors only meaningful changes).
  const viewportMirrorRef = useRef({ x: 0, y: 0, scale: 1, at: 0 });

  // Keep the mirror tracking local truth (pan/zoom handlers, remote
  // mirrors) so incoming packets compare against the actual viewport.
  useEffect(() => {
    viewportMirrorRef.current = {
      ...viewportMirrorRef.current,
      x: stagePos?.x ?? 0,
      y: stagePos?.y ?? 0,
      scale,
    };
  }, [stagePos, scale]);

  // Receiver-side LERP target: validated packets land here; a dedicated
  // rAF loop eases the live Konva node toward it each frame (jitter-free
  // across 60/120/144Hz displays since interpolation is per-frame
  // proportional, not per-packet snapping). React state mirrors only on
  // meaningful change (see loop), so no render storm.
  const viewportLerpTargetRef = useRef(null);
  const viewportLerpRafRef = useRef(null);

  const stepViewportLerp = useCallback(() => {
    viewportLerpRafRef.current = null;
    const target = viewportLerpTargetRef.current;
    const stage = stageRef.current;
    if (!target || !stage || typeof stage.position !== 'function') {
      viewportLerpTargetRef.current = null;
      return;
    }
    const now = Date.now();
    const current = { x: stage.x(), y: stage.y(), scale: stage.scaleX() || 1 };
    const next = lerpViewportStep(current, target);
    if (typeof stage.scale === 'function') stage.scale({ x: next.scale, y: next.scale });
    stage.position({ x: next.x, y: next.y });
    // CRITICAL FIX: Konva requires an explicit repaint instruction.
    // Direct node mutations bypass React, so react-konva's render-driven
    // redraw never fires for them; without this the mirror lags behind
    // the state (and freezes entirely on sub-threshold drift that skips
    // the state mirror below). One batched repaint per frame.
    try {
      if (typeof stage.batchDraw === 'function') stage.batchDraw();
    } catch {
      // best-effort; a failed repaint must never break the loop
    }
    // Mirror React state only on meaningful change so CanvasStage props +
    // zoom badge stay truthful without re-rendering per frame.
    const mirror = viewportMirrorRef.current;
    let mirrored = false;
    if (next.scale !== mirror.scale) {
      setScale(next.scale);
      mirrored = true;
    }
    if (
      Math.abs(next.x - mirror.x) > 0.5 ||
      Math.abs(next.y - mirror.y) > 0.5 ||
      now - mirror.at > 150
    ) {
      setStagePos({ x: next.x, y: next.y });
      mirrored = true;
    }
    viewportMirrorRef.current = { x: next.x, y: next.y, scale: next.scale, at: now };
    if (mirrored) {
      setTextEditor((ed) =>
        ed && isFiniteNum(next.scale) && next.scale > 0
          ? { ...ed, screenX: ed.worldX * next.scale + next.x, screenY: ed.worldY * next.scale + next.y }
          : ed,
      );
    }
    if (!next.done) {
      viewportLerpRafRef.current = requestAnimationFrame(stepViewportLerp);
    } else {
      viewportLerpTargetRef.current = null;
    }
  }, []);

  const applyRemoteViewport = useCallback((input = {}) => {
    // Dual-envelope unpack (flat or nested) with numeric coercion.
    // Zoom stays strictly local: the remote `scale` is intentionally
    // ignored so a peer sitting at 400% can never drag this client off
    // its 100% (1.0) default — incoming packets retarget pan position
    // only, and zoom-only packets are no-ops. Outbound broadcasts still
    // carry our scale (protocol unchanged).
    const { stagePos } = unpackViewportPayload(input);
    const nextPos = stagePos;
    if (nextPos === null) return;
    // Retarget (never snap): the rAF loop eases toward the newest packet;
    // a newer packet simply moves the target — no backlog, no jitter.
    const stage = stageRef.current;
    viewportLerpTargetRef.current = {
      x: nextPos?.x ?? stage?.x?.() ?? viewportMirrorRef.current.x,
      y: nextPos?.y ?? stage?.y?.() ?? viewportMirrorRef.current.y,
      scale: stage?.scaleX?.() ?? viewportMirrorRef.current.scale,
    };
    if (!viewportLerpRafRef.current) {
      viewportLerpRafRef.current = requestAnimationFrame(stepViewportLerp);
    }
  }, [stepViewportLerp]);

  useEffect(() => {
    if (!socket || typeof socket.on !== 'function') return undefined;
    const onViewport = (payload) => {
      if (!payload || payload.roomId !== streamRoomIdRef.current) return;
      strokeDebug('TRACE:CLIENT received', 'canvas:viewport-sync', { from: payload.socketId ?? null });
      // Dual-envelope safe: unpack accepts the full relay envelope or the
      // bare data object; room mismatch above returns silently (no throw).
      applyRemoteViewport(payload);
    };
    socket.on('canvas:viewport-sync', onViewport);
    return () => {
      try {
        socket.off?.('canvas:viewport-sync', onViewport);
      } catch {
        // ignore teardown failures
      }
    };
  }, [socket, applyRemoteViewport]);

  // Drop the viewport timer on unmount / room switch alongside strokes.
  useEffect(
    () => () => {
      if (viewportTimerRef.current) {
        clearTimeout(viewportTimerRef.current);
        viewportTimerRef.current = null;
      }
      if (viewportLerpRafRef.current) {
        cancelAnimationFrame(viewportLerpRafRef.current);
        viewportLerpRafRef.current = null;
      }
      viewportLerpTargetRef.current = null;
    },
    [],
  );

  // ---- zoom (wheel) + pan ----
  const handleWheel = useCallback((event) => {
    event.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = stage.scaleX() || 1;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    const direction = event.evt.deltaY > 0 ? -1 : 1;
    const newScale = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, direction > 0 ? oldScale * 1.1 : oldScale / 1.1),
    );
    stage.scale({ x: newScale, y: newScale });
    stage.position({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
    setScale(newScale);
    setStagePos({ x: stage.x(), y: stage.y() });

    // Keep text editor anchored under zoom/pan.
    setTextEditor((ed) =>
      ed
        ? {
            ...ed,
            screenX: ed.worldX * newScale + stage.x(),
            screenY: ed.worldY * newScale + stage.y(),
          }
        : ed,
    );
    // Shared viewport: broadcast the settled zoom for room peers.
    scheduleViewportSync();
  }, [scheduleViewportSync]);

  const handleDragStageEnd = useCallback((event) => {
    setStagePos({ x: event.target.x(), y: event.target.y() });
    setTextEditor((ed) =>
      ed
        ? {
            ...ed,
            screenX: ed.worldX * event.target.scaleX() + event.target.x(),
            screenY: ed.worldY * event.target.scaleY() + event.target.y(),
          }
        : ed,
    );
    // Shared viewport: flush any pending tick immediately so the settled
    // pan lands on peers with no trailing delay, then broadcast the final
    // position (change detection inside the tick suppresses duplicates).
    flushPendingTick();
    tickPendingRef.current.add('viewport');
    flushPendingTick();
  }, [flushPendingTick]);

  // Continuous pan streaming (Stage onDragMove, pan tool only — CanvasStage
  // gates attachment): routes through the shared fixed 30ms tick, so peers
  // mirror the pan in real time with zero redundant packets (change
  // detection inside the tick). Deliberately emits NO local setState —
  // Konva owns the node mid-drag (it is ALREADY moving the canvas
  // natively) and controlled re-renders would fight it; React state
  // commits once on drag end above. Receiving peers bypass their own
  // render queue by mutating the Konva node directly in
  // applyRemoteViewport, so no packet backlog accumulates.
  const handleDragStageMove = useCallback((event) => {
    const node = event?.target;
    if (!node || (stageRef.current && node !== stageRef.current)) return;
    scheduleTick('viewport');
  }, [scheduleTick]);

  // ---- programmatic zoom (navbar zoom buttons): zoom centered on the
  // stage viewport center, clamped to [MIN_ZOOM, MAX_ZOOM]. Mutates the
  // live Konva stage (same as handleWheel) AND mirrors into React state
  // so CanvasStage props and the navbar % badge stay in sync. Keeps the
  // text editor anchored like wheel-zoom does.
  const handleZoomChange = useCallback((nextScale) => {
    const raw = typeof nextScale === 'number' ? nextScale : Number(nextScale);
    if (!Number.isFinite(raw)) return;
    const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, raw));
    const stage = stageRef.current;
    if (!stage) {
      setScale(newScale);
      return;
    }
    const oldScale = stage.scaleX() || 1;
    const cx = stage.width() / 2;
    const cy = stage.height() / 2;
    const mousePointTo = {
      x: (cx - stage.x()) / oldScale,
      y: (cy - stage.y()) / oldScale,
    };
    stage.scale({ x: newScale, y: newScale });
    stage.position({
      x: cx - mousePointTo.x * newScale,
      y: cy - mousePointTo.y * newScale,
    });
    setScale(newScale);
    setStagePos({ x: stage.x(), y: stage.y() });
    setTextEditor((ed) =>
      ed
        ? {
            ...ed,
            screenX: ed.worldX * newScale + stage.x(),
            screenY: ed.worldY * newScale + stage.y(),
          }
        : ed,
    );
    // Shared viewport: broadcast the settled zoom for room peers.
    scheduleViewportSync();
  }, [scheduleViewportSync]);

  // ---- shape interactions (selection is available in every tool
  // EXCEPT text: the text tool owns all pointer events and delegates
  // placement to the Stage handler above).
  // Clicking any shape always selects it and stops the event reaching
  // the Stage, so the stage never immediately deselects it again.
  // (cancelBubble on click does not block the earlier pointerdown, so
  // in-progress drawing tools keep working.)
  const handleShapeClick = useCallback(
    (event, shapeId) => {
      if (tool === 'text') {
        // Allow the pointer event to reach the stage / text placement.
        return;
      }
      if (tool === 'eraser') {
        // Eraser: click a shape to delete it (stays in eraser for repeats).
        if (event) event.cancelBubble = true;
        deleteShape(shapeId);
        return;
      }
      if (event) event.cancelBubble = true;
      selectShape(shapeId);
    },
    [deleteShape, selectShape, tool],
  );

  // Immediate selection for pointer-down (nested-shape drag ownership):
  // ShapeRenderer calls this synchronously on onPointerDown/onMouseDown so
  // the pressed inner shape becomes selected BEFORE Konva resolves the
  // drag gesture. Without this, a press-drag on an unselected inner shape
  // would be owned by the previously-selected outer rectangle.
  const handleShapeSelect = useCallback(
    (shapeId) => {
      if (tool === 'text' || tool === 'eraser') return;
      selectShape(shapeId);
    },
    [selectShape, tool],
  );

  const handleShapeDragStart = useCallback(
    (shapeId, event) => {
      if (event) event.cancelBubble = true;
      if (tool === 'text' || tool === 'eraser') return;
      if (shapeId) selectShape(shapeId);
      // Snap the Transformer to the exact node being dragged RIGHT NOW.
      // React state (selectedId) propagates async, so without this the
      // previous sibling's bounding box would linger under the cursor and
      // visually block the drag. The CanvasStage effect re-attaches on the
      // next render; this is the synchronous bridge for the current gesture.
      const draggedNode = event?.target;
      const transformer = transformerRef.current;
      if (draggedNode && transformer && typeof draggedNode.getStage === 'function') {
        transformer.nodes([draggedNode]);
        transformer.getLayer()?.batchDraw();
      }
    },
    [selectShape, tool],
  );

  /**
   * Geometric snapping during drag: compare the moving shape's edges and
   * center against all other visible shapes (5px threshold). When within
   * range, snap the node's coordinate to the target edge/center and
   * publish the snap line descriptors for the guidelines layer.
   */
  const handleShapeDragMove = useCallback(
    (shapeId, nodeX, nodeY, event) => {
      if (event) event.cancelBubble = true;
      if (!isFiniteNum(nodeX) || !isFiniteNum(nodeY)) return;
      const shape = shapes.find((s) => s.id === shapeId);
      if (!shape || shape.remotePreview) {
        setGuidelines([]);
        return;
      }
      const siblings = (shapes ?? []).filter((s) => s.id !== shapeId);
      const { dx, dy, lines } = snapMovingShape(shape, { x: nodeX, y: nodeY }, siblings, 5);
      const node = event?.target ?? shapeNodesRef.current.get(shapeId);
      if (node && typeof node.x === 'function' && (dx !== 0 || dy !== 0)) {
        node.x(nodeX + dx);
        node.y(nodeY + dy);
      }
      setGuidelines(lines);
      // Live drag transform: broadcast the snapped translated snapshot so
      // peers replace the committed entry in place (same id, same index —
      // no duplication, no ghosting). Peers converge exactly on drop via
      // the authoritative update + preview-cancel. Groups/frames preview
      // their own node placement; children follow on drag end as usual.
      const snappedX = nodeX + dx;
      const snappedY = nodeY + dy;
      const moved = bakeDragEnd(shape, snappedX, snappedY);
      if (moved) {
        activePreviewIdRef.current = shapeId;
        previewBufferRef.current = { ...shape, ...moved };
        schedulePreviewFlush();
      }
    },
    [shapes, schedulePreviewFlush],
  );

  const handleShapeDragEnd = useCallback(
    (shapeId, nodeX, nodeY) => {
      // Clear smart-alignment guidelines immediately on drag end.
      setGuidelines([]);
      // Settle any live drag preview: peers drop the ghost; the
      // authoritative commitUpdate(s) below deliver the final coordinates.
      clearPreviewTimer();
      if (activePreviewIdRef.current && didPreviewRef.current) {
        emitStrokeEvent('shape:preview-cancel', { draftId: activePreviewIdRef.current });
      }
      resetPreviewStream();
      if (!isFiniteNum(nodeX) || !isFiniteNum(nodeY)) return;
      const shape = shapes.find((s) => s.id === shapeId);
      if (!shape) return;
      // Composite group move: the Group node owns placement — commit x/y
      // only; children stay relative to the group origin.
      if (shape.type === 'group') {
        const node = shapeNodesRef.current.get(shapeId);
        if (node && (nodeX !== shape.x || nodeY !== shape.y)) {
          commitUpdate(shapeId, { x: nodeX, y: nodeY });
        }
        const transformer = transformerRef.current;
        if (transformer && node && typeof node.getStage === 'function') {
          if (!transformer.nodes().includes(node)) transformer.nodes([node]);
          transformer.getLayer()?.batchDraw();
        } else {
          transformer?.getLayer()?.batchDraw();
        }
        return;
      }
      // Frame move: shift every child whose center falls inside the
      // frame's PRE-move bounds by the same (dx, dy) translation, then
      // commit the frame's own new position. Children that are frames
      // themselves move without recursing (their children stay put unless
      // also inside the moved frame).
      if (shape.type === 'frame') {
        const dx = nodeX - shape.x;
        const dy = nodeY - shape.y;
        if (isFiniteNum(dx) && isFiniteNum(dy) && (dx !== 0 || dy !== 0)) {
          for (const child of shapes) {
            if (!child || child.id === shapeId || child.type === 'frame') continue;
            if (!isShapeInsideFrame(child, shape)) continue;
            if (
              child.type === 'freehand' ||
              child.type === 'pen' ||
              child.type === 'line' ||
              child.type === 'arrow'
            ) {
              const src = sanitizePoints(child.points);
              if (src.length < 4) continue;
              const moved = src.map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
              if (moved.some((v) => !Number.isFinite(v))) continue;
              commitUpdate(child.id, { x: 0, y: 0, points: moved });
            } else if (isFiniteNum(child.x) && isFiniteNum(child.y)) {
              commitUpdate(child.id, { x: child.x + dx, y: child.y + dy });
            }
          }
        }
        const node = shapeNodesRef.current.get(shapeId);
        if (node && (nodeX !== shape.x || nodeY !== shape.y)) {
          commitUpdate(shapeId, { x: nodeX, y: nodeY });
        }
        const transformer = transformerRef.current;
        if (transformer && node && typeof node.getStage === 'function') {
          if (!transformer.nodes().includes(node)) transformer.nodes([node]);
          transformer.getLayer()?.batchDraw();
        } else {
          transformer?.getLayer()?.batchDraw();
        }
        return;
      }
      // nodeX/nodeY are the exact absolute node position Konva already
      // moved to. For absolute-points shapes (freehand/pen/line/arrow)
      // bakeDragEnd folds the offset into a fresh points array; for
      // positioned shapes (rect/circle/diamond/text) it commits x/y
      // directly. Deltas are never re-added, so the shape drops exactly
      // where released with zero teleporting.
      const changes = bakeDragEnd(shape, nodeX, nodeY);
      const node = shapeNodesRef.current.get(shapeId);
      const isPointBased =
        shape.type === 'freehand' ||
        shape.type === 'pen' ||
        shape.type === 'line' ||
        shape.type === 'arrow';
      if (changes) {
        if (node && isPointBased) {
          // Reset the Konva node position to 0 immediately to prevent
          // doubling: the committed points already contain the offset,
          // and the re-render pins the node back at (0, 0).
          node.position({ x: 0, y: 0 });
        }
        commitUpdate(shapeId, changes);
        // Connector follow: settled descriptor in world coords (positioned
        // shapes commit x/y; point-path shapes fold into points).
        followBoundArrows(
          shapeId,
          isPointBased ? { ...shape, ...changes } : { ...shape, x: nodeX, y: nodeY },
        );
      } else {
        // Reset transient node offset for point-based shapes even if ~0.
        // Absolute-points nodes rest at (0, 0) — never at a stale
        // shape.x/shape.y.
        if (node && isPointBased) {
          node.position({ x: 0, y: 0 });
        }
      }
      // Refresh the Transformer immediately so its bounding box tightly
      // hugs the newly committed position without lagging or detaching.
      // (The CanvasStage effect re-attaches on the next render; this is
      // the synchronous sync for the current gesture.)
      const transformer = transformerRef.current;
      if (transformer && node && typeof node.getStage === 'function') {
        if (!transformer.nodes().includes(node)) transformer.nodes([node]);
        transformer.getLayer()?.batchDraw();
      } else {
        transformer?.getLayer()?.batchDraw();
      }
    },
    [commitUpdate, shapes, clearPreviewTimer, emitStrokeEvent, resetPreviewStream, followBoundArrows],
  );

  const handleTransformEnd = useCallback(
    (shapeId) => {
      const shape = shapes.find((s) => s.id === shapeId);
      const node = shapeNodesRef.current.get(shapeId);
      if (!shape || !node) return;
      const sx = node.scaleX();
      const sy = node.scaleY();
      const rot = node.rotation();
      // A NaN scale/rotation (e.g. collapsed to zero size) must not bake
      // into the model — reset the node and keep stored geometry instead.
      if (!isFiniteNum(sx) || !isFiniteNum(sy) || !isFiniteNum(rot)) {
        node.scale({ x: 1, y: 1 });
        return;
      }
      const changes = bakeTransform(shape, {
        scaleX: sx,
        scaleY: sy,
        rotation: rot,
      });
      node.scale({ x: 1, y: 1 }); // baked into model; reset node
      if (changes) commitUpdate(shapeId, changes);
    },
    [commitUpdate, shapes],
  );

  // ---- text editing ----
  const openTextEditorForShape = useCallback(
    (shape) => {
      if (!isFiniteNum(shape?.x) || !isFiniteNum(shape?.y)) return;
      const screen = toScreen({ x: shape.x, y: shape.y });
      setTextEditor({
        mode: 'edit',
        shapeId: shape.id,
        worldX: shape.x,
        worldY: shape.y,
        screenX: screen.x,
        screenY: screen.y,
        value: shape.text ?? '',
        align: shape.align ?? shape.textAlign ?? 'left',
        textAlign: shape.textAlign ?? shape.align ?? 'left',
      });
    },
    [toScreen],
  );

  const commitTextEditor = useCallback(
    (value, measuredWidth) => {
      if (!textEditor) return;
      const trimmed = (value ?? '').trim();
      // Overlay reports CSS (screen) px; the model stores WORLD units.
      const stageScale = stageRef.current?.scaleX?.() || 1;
      const measuredWorld =
        isFiniteNum(measuredWidth) && isFiniteNum(stageScale) && stageScale > 0
          ? measuredWidth / stageScale
          : NaN;
      if (textEditor.mode === 'create') {
        if (trimmed) {
          if (!isFiniteNum(textEditor.worldX) || !isFiniteNum(textEditor.worldY)) {
            setTextEditor(null);
            return;
          }
          const shape = createShape('text', { x: textEditor.worldX, y: textEditor.worldY }, {
            color,
            strokeWidth,
            fill,
            strokeStyle,
            opacity,
            fontFamily,
            fontFamilyKey,
            fontSize,
            textAlign,
          });
          // Alignment-box width: keep the widest of the rendered measure
          // and the deterministic estimate so multi-line align has a box
          // to work within from the first render.
          const width = Math.max(
            estimateTextWidth(trimmed, fontSize),
            isFiniteNum(measuredWorld) ? measuredWorld : 0,
          );
          commitCreate({ ...shape, text: trimmed, fill: color, width, align: textAlign, textAlign });
          selectShape(shape.id);
          setTextEditor(null);
          // The tool returns to select ONLY once text is actually placed
          // (Enter / blur with non-empty input). It stays on 'text' while
          // the textarea is open and after empty/cancelled placements so
          // the next click can still place text.
          onDrawingCommitted?.('text');
        } else {
          // Empty create (Enter on empty input / blur without typing):
          // close the editor but keep the text tool active.
          setTextEditor(null);
        }
      } else if (textEditor.shapeId) {
        if (trimmed) {
          const existing = shapes.find((s) => s.id === textEditor.shapeId);
          const width = Math.max(
            estimateTextWidth(trimmed, existing?.fontSize ?? fontSize),
            isFiniteNum(measuredWorld) ? measuredWorld : 0,
            isFiniteNum(existing?.width) ? existing.width : 0,
          );
          commitUpdate(textEditor.shapeId, { text: trimmed, width });
        } else commitDelete(textEditor.shapeId); // empty edit deletes
        setTextEditor(null);
        // No tool change here: re-edits originate from other tools
        // (dblclick), so the active tool is left untouched.
      }
    },
    [color, commitCreate, commitDelete, commitUpdate, fill, fontFamily, fontFamilyKey, fontSize, textAlign, onDrawingCommitted, opacity, selectShape, shapes, strokeStyle, strokeWidth, textEditor],
  );

  const cancelTextEditor = useCallback(() => setTextEditor(null), []);

  // ---- delete / clear ----
  // deleteShape (store) removes the shape AND resets the selection to
  // null, so Delete/Backspace works continuously with no Clear needed.
  // Multi-selection: deletes every selected id, then clears the marquee set.
  const deleteSelected = useCallback(() => {
    const ids = selectedIdsRef.current.length > 0 ? selectedIdsRef.current : selectedId ? [selectedId] : [];
    if (ids.length === 0) return;
    for (const id of ids) {
      detachTransformerFrom(id);
      deleteShape(id);
    }
    selectedIdsRef.current = [];
    setSelectedIds([]);
  }, [deleteShape, detachTransformerFrom, selectedId]);

  /**
   * Duplicate selected shape(s) offset by (+20px, +20px).
   * Single selection clones beside the original and selects the copy;
   * multi-selection clones each member and selects the copies.
   */
  const duplicateSelected = useCallback(() => {
    const ids = selectedIdsRef.current.length > 0 ? selectedIdsRef.current : selectedId ? [selectedId] : [];
    if (ids.length === 0) return;
    const clones = [];
    for (const id of ids) {
      const shape = shapes.find((s) => s.id === id);
      if (!shape) continue;
      const clone = duplicateShape(shape, 20);
      if (!clone) continue;
      commitCreate(clone);
      clones.push(clone.id);
    }
    if (clones.length > 0) selectShapes(clones);
  }, [commitCreate, selectShapes, selectedId, shapes]);

  /**
   * Group selected shapes into a composite group (needs >= 2).
   * Commits the group then deletes the originals; selects the group.
   */
  const groupSelected = useCallback(() => {
    const ids = selectedIdsRef.current.length > 1 ? selectedIdsRef.current : null;
    if (!ids) return;
    const members = ids.map((id) => shapes.find((s) => s.id === id)).filter(Boolean);
    if (members.length < 2) return;
    const group = createGroupShape(members);
    if (!group) return;
    commitCreate(group);
    for (const m of members) {
      detachTransformerFrom(m.id);
      deleteShape(m.id);
    }
    selectShapes([group.id]);
  }, [commitCreate, deleteShape, detachTransformerFrom, selectShapes, shapes]);

  /** Ungroup the selected composite group back into world-coord children. */
  const ungroupSelected = useCallback(() => {
    const id = selectedId;
    if (!id) return;
    const shape = shapes.find((s) => s.id === id);
    if (!shape || shape.type !== 'group') return;
    const kids = ungroupShape(shape);
    if (kids.length === 0) return;
    detachTransformerFrom(id);
    deleteShape(id);
    for (const k of kids) commitCreate(k);
    selectShapes(kids.map((k) => k.id));
  }, [commitCreate, deleteShape, detachTransformerFrom, selectShapes, selectedId, shapes]);

  const clearCanvas = useCallback(() => {
    setDraftShape(null);
    isDrawingRef.current = false;
    drawStartRef.current = null;
    setTextEditor(null);
    shapeNodesRef.current.clear();
    clearAll();
  }, [clearAll]);

  // Backspace/Delete removes the selected shape (unless typing in overlay/input).
  // A ref mirrors the latest selection so the listener never acts on a
  // stale closure holding an already-deleted id.
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (textEditor) return; // overlay handles its own keys
      const tag = document.activeElement?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      const currentSelection = selectedIdRef.current;
      if ((event.key === 'Backspace' || event.key === 'Delete') && currentSelection) {
        event.preventDefault();
        deleteSelected();
      }
      if (event.key === 'Escape' && currentSelection) selectShapes([]);
      // Z-ordering: [ = backward, ] = forward; with Shift = to back/front.
      if ((event.key === '[' || event.key === '{') && currentSelection) {
        event.preventDefault();
        if (event.shiftKey) sendToBack(currentSelection);
        else sendBackward(currentSelection);
      }
      if ((event.key === ']' || event.key === '}') && currentSelection) {
        event.preventDefault();
        if (event.shiftKey) bringToFront(currentSelection);
        else bringForward(currentSelection);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bringForward, bringToFront, deleteSelected, selectShape, selectShapes, selectedId, sendBackward, sendToBack, textEditor]);

  // ---- undo / redo keyboard: Cmd+Z / Ctrl+Z = undo,
  // Cmd+Shift+Z / Ctrl+Y = redo (ignored while typing / editing text) ----
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.altKey) return;
      if (textEditor) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      const k = event.key.toLowerCase();
      if (k === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((k === 'z' && event.shiftKey) || k === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, textEditor, undo]);

  const visibleShapes = useMemo(() => (draftShape ? [...shapes, draftShape] : shapes), [shapes, draftShape]);

  // Render-only merge: remote in-progress strokes ride along for display
  // but stay out of `shapes`/`visibleShapes` (history, exports, counts,
  // collab ops). Previews whose id already committed are dropped so the
  // authoritative copy never double-draws during the complete handoff.
  const renderShapes = useMemo(
    () => mergeRenderShapes(visibleShapes, remoteStrokes),
    [visibleShapes, remoteStrokes],
  );

  return {
    shapes,
    visibleShapes,
    renderShapes,
    remoteStrokeCount: Object.keys(remoteStrokes ?? {}).length,
    draftShape,
    selectedId,
    selectedIds,
    selectShapes,
    guidelines,
    setGuidelines,
    selectBox,
    textEditor,
    scale,
    stagePos,
    stageRef,
    shapeNodesRef,
    transformerRef,
    toWorld,
    toScreen,
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
    handleWheel,
    handleDragStageEnd,
    handleDragStageMove,
    handleZoomChange,
    handleShapeClick,
    handleShapeSelect,
    handleShapeDragStart,
    handleShapeDragMove,
    handleShapeDragEnd,
    handleTransformEnd,
    openTextEditorForShape,
    commitTextEditor,
    cancelTextEditor,
    deleteSelected,
    duplicateSelected,
    groupSelected,
    ungroupSelected,
    clearCanvas,
    selectShape,
    commitCreate,
    commitUpdate,
    commitDelete,
    deleteShape,
    applyRemoteShapes,
    sendToBack,
    bringToFront,
    sendBackward,
    bringForward,
    undo,
    redo,
    canUndo,
    canRedo,
    setScale,
    setStagePos,
  };
}
