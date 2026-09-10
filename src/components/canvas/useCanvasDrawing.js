import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useWhiteboardState from './hooks/useWhiteboardState.js';
import {
  bakeDragEnd,
  bakeTransform,
  circleRadius,
  createShape,
  normalizeRect,
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
  color = '#0f766e',
  strokeWidth = 4,
  shapes: controlledShapes,
  selectedShapeId: controlledSelection,
  onShapeCreate,
  onShapeUpdate,
  onShapeDelete,
  onCanvasClear,
  onSelectionChange,
  // Called after a shape is committed (draw or text). The shell uses it
  // to return to select/move mode so no explicit Select button is needed.
  onDrawingCommitted,
} = {}) {
  // ---- shape store (local state + normalization + collab callbacks) ----
  const {
    shapes,
    selectedId,
    commitCreate,
    commitUpdate: storeCommitUpdate,
    commitDelete: storeCommitDelete,
    deleteShape,
    selectShape,
    applyRemoteShapes,
    clearAll,
  } = useWhiteboardState({
    shapes: controlledShapes,
    selectedShapeId: controlledSelection,
    onShapeCreate,
    onShapeUpdate,
    onShapeDelete,
    onCanvasClear,
    onSelectionChange,
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
      detachTransformerFrom(shapeId);
      storeCommitDelete(shapeId);
    },
    [detachTransformerFrom, storeCommitDelete],
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

  // Viewport (stage container) -> world coordinates. Uses
  // getRelativePointerPosition so the result is correct whether the
  // pointer landed on empty canvas or on top of an existing shape.
  const getWorldFromEvent = useCallback(
    (event) => {
      const stage = event.target?.getStage?.() ?? stageRef.current;
      if (!stage) return null;
      const relative =
        stage.getRelativePointerPosition?.() ?? stage.getPointerPosition();
      if (!relative) return null;
      return toWorld(stage, relative);
    },
    [toWorld],
  );

  // ---- Stage pointer handlers ----
  const handleStageMouseDown = useCallback(
    (event) => {
      // Click on empty area: select tool deselects; text tool places editor.
      const clickedOnEmpty = event.target === event.target.getStage();
      const world = getWorldFromEvent(event);
      if (!world) return;

      if (tool === 'select' || tool === 'pan') {
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
          });
        }
        return;
      }

      // Drawing tools: begin draft (not yet in shapes array).
      const seed = createShape(tool, world, { color, strokeWidth });
      if (!seed) return;
      isDrawingRef.current = true;
      drawStartRef.current = world;
      setDraftShape(seed);
      if (tool !== 'freehand') selectShape(null);
    },
    [color, getWorldFromEvent, selectShape, strokeWidth, textEditor, toScreen, tool],
  );

  const handleStageMouseMove = useCallback(
    (event) => {
      if (!isDrawingRef.current || !draftShape || !drawStartRef.current) return;
      const world = getWorldFromEvent(event);
      if (!world) return;
      const start = drawStartRef.current;

      switch (draftShape.type) {
        case 'freehand': {
          const pts = draftShape.points;
          const n = pts.length;
          const dx = world.x - pts[n - 2];
          const dy = world.y - pts[n - 1];
          // Draft optimization: skip points closer than MIN_FREEHAND_STEP
          // and update only the small draft object (no full-array map).
          if (Math.hypot(dx, dy) < MIN_FREEHAND_STEP) return;
          setDraftShape((d) =>
            d ? { ...d, points: [...d.points, world.x, world.y] } : d,
          );
          break;
        }
        case 'rectangle': {
          const norm = normalizeRect(start.x, start.y, world.x, world.y);
          setDraftShape((d) => (d ? { ...d, ...norm } : d));
          break;
        }
        case 'circle': {
          setDraftShape((d) =>
            d ? { ...d, radius: circleRadius(start.x, start.y, world.x, world.y) } : d,
          );
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
    const start = drawStartRef.current;
    setDraftShape(null);
    drawStartRef.current = null;

    // Discard degenerate shapes (click without drag).
    if (finished.type === 'rectangle' && (finished.width < 2 || finished.height < 2)) return;
    if (finished.type === 'circle' && finished.radius < 2) return;
    if (finished.type === 'line' || finished.type === 'arrow') {
      const [x1, y1, x2, y2] = finished.points;
      if (Math.hypot(x2 - x1, y2 - y1) < 2) return;
    }
    if (finished.type === 'freehand' && finished.points.length < 4) return;
    void start;

    commitCreate(finished);
    selectShape(finished.id);
    onDrawingCommitted?.();
  }, [commitCreate, draftShape, onDrawingCommitted, selectShape]);

  // ---- zoom (wheel) + pan ----
  const handleWheel = useCallback((event) => {
    event.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = stage.scaleX();
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
      event.cancelBubble = true;
      selectShape(shapeId);
    },
    [selectShape, tool],
  );

  const handleShapeDragEnd = useCallback(
    (shapeId, nodeX, nodeY) => {
      const shape = shapes.find((s) => s.id === shapeId);
      if (!shape) return;
      const changes = bakeDragEnd(shape, nodeX, nodeY);
      if (changes) commitUpdate(shapeId, changes);
      else {
        // Reset transient node offset for point-based shapes even if ~0.
        const node = shapeNodesRef.current.get(shapeId);
        if (node && (shape.type === 'freehand' || shape.type === 'line' || shape.type === 'arrow')) {
          node.position({ x: shape.x ?? 0, y: shape.y ?? 0 });
        }
      }
    },
    [commitUpdate, shapes],
  );

  const handleTransformEnd = useCallback(
    (shapeId) => {
      const shape = shapes.find((s) => s.id === shapeId);
      const node = shapeNodesRef.current.get(shapeId);
      if (!shape || !node) return;
      const changes = bakeTransform(shape, {
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
        rotation: node.rotation(),
      });
      node.scale({ x: 1, y: 1 }); // baked into model; reset node
      if (changes) commitUpdate(shapeId, changes);
    },
    [commitUpdate, shapes],
  );

  // ---- text editing ----
  const openTextEditorForShape = useCallback(
    (shape) => {
      const screen = toScreen({ x: shape.x, y: shape.y });
      setTextEditor({
        mode: 'edit',
        shapeId: shape.id,
        worldX: shape.x,
        worldY: shape.y,
        screenX: screen.x,
        screenY: screen.y,
        value: shape.text ?? '',
      });
    },
    [toScreen],
  );

  const commitTextEditor = useCallback(
    (value) => {
      if (!textEditor) return;
      const trimmed = (value ?? '').trim();
      if (textEditor.mode === 'create') {
        if (trimmed) {
          const shape = createShape('text', { x: textEditor.worldX, y: textEditor.worldY }, { color, strokeWidth });
          commitCreate({ ...shape, text: trimmed, fill: color });
          selectShape(shape.id);
        }
      } else if (textEditor.shapeId) {
        if (trimmed) commitUpdate(textEditor.shapeId, { text: trimmed });
        else commitDelete(textEditor.shapeId); // empty edit deletes
      }
      setTextEditor(null);
      onDrawingCommitted?.();
    },
    [color, commitCreate, commitDelete, commitUpdate, onDrawingCommitted, selectShape, strokeWidth, textEditor],
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
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelected, selectShape, selectedId, textEditor]);

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
    handleShapeClick,
    handleShapeDragEnd,
    handleTransformEnd,
    openTextEditorForShape,
    commitTextEditor,
    cancelTextEditor,
    deleteSelected,
    clearCanvas,
    selectShape,
    applyRemoteShapes,
    setScale,
    setStagePos,
  };
}
