import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  bakeDragEnd,
  bakeTransform,
  circleRadius,
  createShape,
  normalizeRect,
  serializeShape,
} from './shapeModel';

const MIN_FREEHAND_STEP = 2; // px in world coords — draft optimization
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

/**
 * useCanvasDrawing — Sayon (Whiteboard / Konva.js Engineer)
 *
 * Owns local drawing state as PLAIN serializable objects (no Konva nodes).
 * All stored coordinates are WORLD coordinates; Stage scale/position
 * (viewport) never mutates shape data.
 *
 * Controlled mode: pass `shapes` prop (Yjs/Socket side owns array).
 * Uncontrolled mode: omit `shapes`, hook owns internal state.
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
} = {}) {
  const isControlled = controlledShapes !== undefined;

  const [internalShapes, setInternalShapes] = useState([]);
  const [internalSelection, setInternalSelection] = useState(null);
  const shapes = isControlled ? controlledShapes : internalShapes;
  const selectedId =
    controlledSelection !== undefined ? controlledSelection : internalSelection;

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

  // ---- internal commit helpers (internal state + always fire callbacks) ----
  const commitCreate = useCallback(
    (shape) => {
      const clean = serializeShape(shape);
      if (!clean) return;
      if (!isControlled) setInternalShapes((prev) => [...prev, clean]);
      onShapeCreate?.(clean);
    },
    [isControlled, onShapeCreate],
  );

  const commitUpdate = useCallback(
    (shapeId, changes) => {
      if (!shapeId || !changes || Object.keys(changes).length === 0) return;
      const clean = serializeShape(changes);
      if (!clean) return;
      if (!isControlled) {
        setInternalShapes((prev) =>
          prev.map((s) => (s.id === shapeId ? { ...s, ...clean } : s)),
        );
      }
      // Keep in-progress draft in sync if it is the same shape.
      setDraftShape((d) => (d && d.id === shapeId ? { ...d, ...clean } : d));
      onShapeUpdate?.(shapeId, clean);
    },
    [isControlled, onShapeUpdate],
  );

  const commitDelete = useCallback(
    (shapeId) => {
      if (!shapeId) return;
      if (!isControlled) {
        setInternalShapes((prev) => prev.filter((s) => s.id !== shapeId));
      }
      shapeNodesRef.current.delete(shapeId);
      onShapeDelete?.(shapeId);
    },
    [isControlled, onShapeDelete],
  );

  const selectShape = useCallback(
    (shapeId) => {
      if (controlledSelection === undefined) setInternalSelection(shapeId);
      onSelectionChange?.(shapeId);
    },
    [controlledSelection, onSelectionChange],
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

  const getWorldFromEvent = useCallback(
    (event) => {
      const stage = event.target?.getStage?.() ?? stageRef.current;
      if (!stage) return null;
      const pointer = stage.getPointerPosition();
      if (!pointer) return null;
      return toWorld(stage, pointer);
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
        if (clickedOnEmpty && !textEditor) {
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
  }, [commitCreate, draftShape, selectShape]);

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

  // ---- shape interactions (select mode) ----
  const handleShapeClick = useCallback(
    (event, shapeId) => {
      if (tool !== 'select') return;
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
    },
    [color, commitCreate, commitDelete, commitUpdate, selectShape, strokeWidth, textEditor],
  );

  const cancelTextEditor = useCallback(() => setTextEditor(null), []);

  // ---- delete / clear ----
  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    commitDelete(selectedId);
    selectShape(null);
  }, [commitDelete, selectShape, selectedId]);

  const clearCanvas = useCallback(() => {
    if (!isControlled) setInternalShapes([]);
    setDraftShape(null);
    isDrawingRef.current = false;
    drawStartRef.current = null;
    setTextEditor(null);
    shapeNodesRef.current.clear();
    if (controlledSelection === undefined) setInternalSelection(null);
    onCanvasClear?.();
  }, [controlledSelection, isControlled, onCanvasClear]);

  // Backspace/Delete removes the selected shape (unless typing in overlay/input).
  useEffect(() => {
    const onKeyDown = (event) => {
      if (textEditor) return; // overlay handles its own keys
      const tag = document.activeElement?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if ((event.key === 'Backspace' || event.key === 'Delete') && selectedId) {
        event.preventDefault();
        deleteSelected();
      }
      if (event.key === 'Escape' && selectedId) selectShape(null);
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
    setScale,
    setStagePos,
  };
}
