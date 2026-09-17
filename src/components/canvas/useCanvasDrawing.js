import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useWhiteboardState from './hooks/useWhiteboardState.js';
import { autoStraightenStroke } from './utils/shapeRecognition.js';
import {
  bakeDragEnd,
  bakeTransform,
  circleRadius,
  createFrameShape,
  createShape,
  DEFAULTS,
  estimateTextWidth,
  isFiniteNum,
  isShapeInsideFrame,
  normalizeRect,
  sanitizePoints,
} from './utils/shapes.js';

const MIN_FREEHAND_STEP = 2; // px in world coords — draft optimization
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

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
  });

  // Draft shape being drawn (NOT yet committed) — updating only this
  // small object on pointermove avoids re-mapping the full shapes array.
  const [draftShape, setDraftShape] = useState(null);
  const drawStartRef = useRef(null); // world point where drag began
  const isDrawingRef = useRef(false);

  // Text overlay editor state: { mode: 'create'|'edit', worldX, worldY, value, shapeId? }
  const [textEditor, setTextEditor] = useState(null);

  // Viewport (never stored in shapes): zoom + pan offset.
  const [scale, setScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const stageRef = useRef(null);
  const shapeNodesRef = useRef(new Map()); // shapeId -> Konva node
  const transformerRef = useRef(null);

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
      if (drawTool !== 'freehand') selectShape(null);
    },
    [color, fill, fontFamily, fontFamilyKey, fontSize, textAlign, getWorldFromEvent, arrowType, endArrowhead, opacity, roughness, roundness, selectShape, shapes, startArrowhead, strokeStyle, strokeWidth, textEditor, toScreen, tool],
  );

  const handleStageMouseMove = useCallback(
    (event) => {
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
          break;
        }
        case 'rectangle':
        case 'diamond':
        case 'frame': {
          const norm = normalizeRect(start.x, start.y, world.x, world.y);
          setDraftShape((d) => (d ? { ...d, ...norm } : d));
          break;
        }
        case 'circle': {
          const r = circleRadius(start.x, start.y, world.x, world.y);
          if (!Number.isFinite(r)) return;
          setDraftShape((d) => (d ? { ...d, radius: r } : d));
          break;
        }
        case 'line':
        case 'arrow': {
          setDraftShape((d) =>
            d ? { ...d, points: [start.x, start.y, world.x, world.y] } : d,
          );
          break;
        }
        default:
          break;
      }
    },
    [draftShape, getWorldFromEvent],
  );

  const handleStageMouseUp = useCallback(() => {
    if (!isDrawingRef.current || !draftShape) return;
    isDrawingRef.current = false;
    const finished = draftShape;
    setDraftShape(null);
    drawStartRef.current = null;

    // Discard degenerate shapes (click without drag) and anything with
    // non-finite geometry so NaN never reaches Konva or the store.
    if (finished.type === 'frame') {
      const w = finished.width;
      const h = finished.height;
      if (!isFiniteNum(w) || !isFiniteNum(h)) return;
      if (!isFiniteNum(finished.x) || !isFiniteNum(finished.y)) return;
      if (Math.abs(w) < 10 || Math.abs(h) < 10) return;
    } else if (finished.type === 'rectangle' || finished.type === 'diamond') {
      const w = finished.width;
      const h = finished.height;
      if (!isFiniteNum(w) || !isFiniteNum(h)) return;
      if (!isFiniteNum(finished.x) || !isFiniteNum(finished.y)) return;
      if (Math.abs(w) < 2 || Math.abs(h) < 2) return;
    } else if (finished.type === 'circle') {
      if (!isFiniteNum(finished.x) || !isFiniteNum(finished.y)) return;
      const radii = [finished.radius, finished.radiusX, finished.radiusY].filter((v) => v !== undefined);
      if (radii.some((v) => !isFiniteNum(v))) return;
      const biggest = Math.max(0, ...radii);
      if (biggest < 2) return;
    } else if (finished.type === 'line' || finished.type === 'arrow' || finished.type === 'freehand') {
      // Validate line/arrow/freehand points: drop non-finite entries;
      // abort unless at least one full (x, y) pair survives.
      const clean = sanitizePoints(finished.points);
      if (clean.length < 4) return;
      if (clean.some((v) => !Number.isFinite(v))) return;
      // Endpoints decide: arrows may carry extra bend points, so compare
      // first vs last instead of assuming a 4-number array.
      const dx = clean[clean.length - 2] - clean[0];
      const dy = clean[clean.length - 1] - clean[1];
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      if (Math.hypot(dx, dy) < 2) return;
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
          return;
        }
      }
      commitCreate({ ...finished, points: clean });
      selectShape(finished.id);
      onDrawingCommitted?.();
      return;
    }

    commitCreate(finished);
    selectShape(finished.id);
    onDrawingCommitted?.();
  }, [autoDetect, tool, color, commitCreate, draftShape, fill, onDrawingCommitted, opacity, roughness, roundness, selectShape, strokeStyle, strokeWidth]);

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
  }, []);

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
  }, []);

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
  }, []);

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

  const handleShapeDragEnd = useCallback(
    (shapeId, nodeX, nodeY) => {
      if (!isFiniteNum(nodeX) || !isFiniteNum(nodeY)) return;
      const shape = shapes.find((s) => s.id === shapeId);
      if (!shape) return;
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
    [commitUpdate, shapes],
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
  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    detachTransformerFrom(selectedId);
    deleteShape(selectedId);
  }, [deleteShape, detachTransformerFrom, selectedId]);

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
      if (event.key === 'Escape' && currentSelection) selectShape(null);
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
  }, [bringForward, bringToFront, deleteSelected, selectShape, selectedId, sendBackward, sendToBack, textEditor]);

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

  return {
    shapes,
    visibleShapes,
    draftShape,
    selectedId,
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
    handleZoomChange,
    handleShapeClick,
    handleShapeSelect,
    handleShapeDragStart,
    handleShapeDragEnd,
    handleTransformEnd,
    openTextEditorForShape,
    commitTextEditor,
    cancelTextEditor,
    deleteSelected,
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
