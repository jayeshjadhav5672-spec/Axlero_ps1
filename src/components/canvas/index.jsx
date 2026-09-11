import { useCallback, useEffect, useState } from 'react';
import CanvasStage from './CanvasStage';
import TextEditorOverlay from './TextEditorOverlay';
import Toolbar from './Toolbar';
import PropertySidebar from './PropertySidebar';
import ZoomBar from './ZoomBar';
import useCanvasDrawing from './useCanvasDrawing';
import { DEFAULTS, FONT_FAMILIES, duplicateShape, elbowPoints } from './utils/shapes.js';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

const clampZoom = (s) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s));

/**
 * Whiteboard — Sayon, Interactive Whiteboard / Konva.js Engineer
 * Excalidraw-styled shell: top-center floating tool island, top-left
 * contextual property sidebar, bottom zoom/status pill, cream canvas.
 *
 * CANONICAL export of the SyncSpace whiteboard subsystem.
 * `Canvas` remains as a backwards-compatible alias (existing `main.jsx`
 * and Avantee shell imports keep working unchanged).
 *
 * Collaboration-ready boundary: shapes are plain serializable JSON with
 * stable `shape-<uuid>` ids. No Socket.io / Yjs imports here.
 *
 * Props (all optional for standalone use; wired by Avantee/Shree):
 * - shapes: controlled shape array (external/Yjs state). Omit for local state.
 * - selectedShapeId: controlled selection. Omit for local selection.
 * - tool, color, strokeWidth, fill/backgroundColor, strokeStyle, opacity,
 *   roughness, roundness, startArrowhead, endArrowhead, fontFamily,
 *   fontSize, textAlign: optionally controlled.
 * - onToolChange, onColorChange, onStrokeWidthChange, onFillChange,
 *   onStrokeStyleChange, onOpacityChange, onRoughnessChange,
 *   onRoundnessChange, onStartArrowheadChange, onEndArrowheadChange,
 *   onFontFamilyChange, onFontSizeChange, onTextAlignChange:
 *   fire in both modes.
 * - onShapeCreate(shape), onShapeUpdate(shapeId, changes),
 *   onShapeDelete(shapeId), onCanvasClear(), onSelectionChange(shapeId),
 *   onShapesReorder(nextShapes)
 */
export function Whiteboard({
  shapes: controlledShapes,
  selectedShapeId: controlledSelection,
  tool: controlledTool,
  color: controlledColor,
  strokeWidth: controlledWidth,
  fill: controlledFill,
  backgroundColor: controlledBackground,
  strokeStyle: controlledStrokeStyle,
  opacity: controlledOpacity,
  roughness: controlledRoughness,
  roundness: controlledRoundness,
  startArrowhead: controlledStartArrowhead,
  endArrowhead: controlledEndArrowhead,
  arrowType: controlledArrowType,
  fontFamily: controlledFontFamily,
  fontFamilyKey: controlledFontFamilyKey,
  fontSize: controlledFontSize,
  textAlign: controlledTextAlign,
  align: controlledAlign,
  onToolChange,
  onColorChange,
  onStrokeWidthChange,
  onFillChange,
  onBackgroundChange,
  onStrokeStyleChange,
  onOpacityChange,
  onRoughnessChange,
  onRoundnessChange,
  onStartArrowheadChange,
  onEndArrowheadChange,
  onArrowTypeChange,
  onFontFamilyChange,
  onFontSizeChange,
  onTextAlignChange,
  onAlignChange,
  onShapeCreate,
  onShapeUpdate,
  onShapeDelete,
  onCanvasClear,
  onShapesReorder,
  onSelectionChange,
} = {}) {
  const [internalTool, setInternalTool] = useState('select');
  const [internalColor, setInternalColor] = useState('#1e1e1e');
  const [internalWidth, setInternalWidth] = useState(4);
  const [internalFill, setInternalFill] = useState('transparent');
  const [internalStrokeStyle, setInternalStrokeStyle] = useState('solid');
  const [internalOpacity, setInternalOpacity] = useState(1);
  const [internalRoughness, setInternalRoughness] = useState(DEFAULTS.roughness);
  const [internalRoundness, setInternalRoundness] = useState(DEFAULTS.roundness);
  const [internalStartArrowhead, setInternalStartArrowhead] = useState(DEFAULTS.startArrowhead);
  const [internalEndArrowhead, setInternalEndArrowhead] = useState(DEFAULTS.endArrowhead);
  const [internalArrowType, setInternalArrowType] = useState(DEFAULTS.arrowType);
  const [internalFontFamilyKey, setInternalFontFamilyKey] = useState(DEFAULTS.fontFamilyKey);
  const [internalFontSize, setInternalFontSize] = useState(DEFAULTS.fontSize);
  const [internalTextAlign, setInternalTextAlign] = useState(DEFAULTS.textAlign);

  const tool = controlledTool ?? internalTool;
  const color = controlledColor ?? internalColor;
  const strokeWidth = controlledWidth ?? internalWidth;
  const fill = controlledFill ?? controlledBackground ?? internalFill;
  const strokeStyle = controlledStrokeStyle ?? internalStrokeStyle;
  const opacity = controlledOpacity ?? internalOpacity;
  const roughness = controlledRoughness ?? internalRoughness;
  const roundness = controlledRoundness ?? internalRoundness;
  const startArrowhead = controlledStartArrowhead ?? internalStartArrowhead;
  const endArrowhead = controlledEndArrowhead ?? internalEndArrowhead;
  const arrowType = controlledArrowType ?? internalArrowType;
  const fontFamilyKey = controlledFontFamilyKey ?? internalFontFamilyKey;
  const fontFamily = controlledFontFamily ?? FONT_FAMILIES[fontFamilyKey] ?? FONT_FAMILIES.hand;
  const fontSize = controlledFontSize ?? internalFontSize;
  const textAlign = controlledTextAlign ?? controlledAlign ?? internalTextAlign;

  const handleToolChange = useCallback(
    (next) => {
      if (controlledTool === undefined) setInternalTool(next);
      onToolChange?.(next);
    },
    [controlledTool, onToolChange],
  );
  const handleColorChange = useCallback(
    (next) => {
      if (controlledColor === undefined) setInternalColor(next);
      onColorChange?.(next);
    },
    [controlledColor, onColorChange],
  );
  const handleWidthChange = useCallback(
    (next) => {
      if (controlledWidth === undefined) setInternalWidth(next);
      onStrokeWidthChange?.(next);
    },
    [controlledWidth, onStrokeWidthChange],
  );
  const handleFillChange = useCallback(
    (next) => {
      if (controlledFill === undefined && controlledBackground === undefined) {
        setInternalFill(next);
      }
      onFillChange?.(next);
      onBackgroundChange?.(next);
    },
    [controlledBackground, controlledFill, onBackgroundChange, onFillChange],
  );
  const handleStrokeStyleChange = useCallback(
    (next) => {
      if (controlledStrokeStyle === undefined) setInternalStrokeStyle(next);
      onStrokeStyleChange?.(next);
    },
    [controlledStrokeStyle, onStrokeStyleChange],
  );
  const handleOpacityChange = useCallback(
    (next) => {
      if (controlledOpacity === undefined) setInternalOpacity(next);
      onOpacityChange?.(next);
    },
    [controlledOpacity, onOpacityChange],
  );
  const handleRoughnessChange = useCallback(
    (next) => {
      if (controlledRoughness === undefined) setInternalRoughness(next);
      onRoughnessChange?.(next);
    },
    [controlledRoughness, onRoughnessChange],
  );
  const handleRoundnessChange = useCallback(
    (next) => {
      if (controlledRoundness === undefined) setInternalRoundness(next);
      onRoundnessChange?.(next);
    },
    [controlledRoundness, onRoundnessChange],
  );
  const handleStartArrowheadChange = useCallback(
    (next) => {
      if (controlledStartArrowhead === undefined) setInternalStartArrowhead(next);
      onStartArrowheadChange?.(next);
    },
    [controlledStartArrowhead, onStartArrowheadChange],
  );
  const handleEndArrowheadChange = useCallback(
    (next) => {
      if (controlledEndArrowhead === undefined) setInternalEndArrowhead(next);
      onEndArrowheadChange?.(next);
    },
    [controlledEndArrowhead, onEndArrowheadChange],
  );
  const handleArrowTypeChange = useCallback(
    (next) => {
      if (controlledArrowType === undefined) setInternalArrowType(next);
      onArrowTypeChange?.(next);
    },
    [controlledArrowType, onArrowTypeChange],
  );
  const handleFontFamilyChange = useCallback(
    (nextKey) => {
      if (controlledFontFamilyKey === undefined) setInternalFontFamilyKey(nextKey);
      onFontFamilyChange?.(nextKey, FONT_FAMILIES[nextKey]);
    },
    [controlledFontFamilyKey, onFontFamilyChange],
  );
  const handleFontSizeChange = useCallback(
    (next) => {
      if (controlledFontSize === undefined) setInternalFontSize(next);
      onFontSizeChange?.(next);
    },
    [controlledFontSize, onFontSizeChange],
  );
  const handleTextAlignChange = useCallback(
    (next) => {
      if (controlledTextAlign === undefined && controlledAlign === undefined) {
        setInternalTextAlign(next);
      }
      onTextAlignChange?.(next);
      onAlignChange?.(next);
    },
    [controlledAlign, controlledTextAlign, onAlignChange, onTextAlignChange],
  );

  // The active drawing tool stays selected after each committed shape
  // so users can draw repeated strokes without re-picking the tool.
  // (Previously this reset to 'select' on every mouse release, forcing a
  // manual tool re-click after each stroke.)
  // Kept as a stable no-op callback to preserve the `onDrawingCommitted`
  // integration boundary with useCanvasDrawing.
  const handleDrawingCommitted = useCallback(() => {}, []);

  const {
    visibleShapes,
    shapes: storeShapes,
    selectedId,
    textEditor,
    scale,
    stagePos,
    stageRef,
    shapeNodesRef,
    transformerRef,
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
    handleWheel,
    handleDragStageEnd,
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
    setScale,
    setStagePos,
    sendToBack,
    bringToFront,
    sendBackward,
    bringForward,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useCanvasDrawing({
    tool,
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
    shapes: controlledShapes,
    selectedShapeId: controlledSelection,
    onShapeCreate,
    onShapeUpdate,
    onShapeDelete,
    onCanvasClear,
    onShapesReorder,
    onSelectionChange,
    onDrawingCommitted: handleDrawingCommitted,
  });

  const selectedShape = visibleShapes.find((s) => s.id === selectedId) ?? null;

  // Inspector values: reflect the live selection when present (Excalidraw
  // parity), otherwise fall back to the next-shape tool defaults.
  const inspectorColor = selectedShape
    ? (selectedShape.type === 'text' ? (selectedShape.fill ?? color) : (selectedShape.stroke ?? color))
    : color;
  const inspectorFill = selectedShape ? (selectedShape.fill ?? fill) : fill;
  const inspectorWidth = selectedShape?.strokeWidth ?? strokeWidth;
  const inspectorStyle = selectedShape?.strokeStyle ?? strokeStyle;
  const inspectorOpacity = selectedShape?.opacity ?? opacity;
  const inspectorRoughness = selectedShape?.roughness ?? roughness;
  const inspectorRoundness = selectedShape?.roundness ?? roundness;
  const inspectorStartArrowhead = selectedShape?.startArrowhead ?? startArrowhead;
  const inspectorEndArrowhead =
    selectedShape?.endArrowhead ?? (selectedShape?.type === 'arrow' ? 'arrow' : endArrowhead);
  const inspectorArrowType = selectedShape?.arrowType ?? arrowType ?? DEFAULTS.arrowType;
  const inspectorFontKey = selectedShape?.fontFamilyKey ?? fontFamilyKey;
  const inspectorFontSize = selectedShape?.fontSize ?? fontSize;
  const inspectorAlign = selectedShape?.textAlign ?? selectedShape?.align ?? textAlign;

  // Excalidraw-style: style picks apply to the current selection too.
  const stylizeSelection = useCallback(
    (changes) => {
      if (selectedId) commitUpdate(selectedId, changes);
    },
    [commitUpdate, selectedId],
  );

  const handleSidebarColor = useCallback(
    (next) => {
      handleColorChange(next);
      if (!selectedId || !selectedShape) return;
      if (selectedShape.type === 'text') stylizeSelection({ fill: next });
      else if (selectedShape.type === 'arrow') {
        stylizeSelection({ stroke: next, fill: next });
      } else stylizeSelection({ stroke: next });
    },
    [handleColorChange, selectedId, selectedShape, stylizeSelection],
  );
  const handleSidebarFill = useCallback(
    (next) => {
      handleFillChange(next);
      if (selectedId) stylizeSelection({ fill: next });
    },
    [handleFillChange, selectedId, stylizeSelection],
  );
  const handleSidebarWidth = useCallback(
    (next) => {
      handleWidthChange(next);
      if (selectedId) stylizeSelection({ strokeWidth: next });
    },
    [handleWidthChange, selectedId, stylizeSelection],
  );
  const handleSidebarStyle = useCallback(
    (next) => {
      handleStrokeStyleChange(next);
      if (selectedId) stylizeSelection({ strokeStyle: next });
    },
    [handleStrokeStyleChange, selectedId, stylizeSelection],
  );
  const handleSidebarOpacity = useCallback(
    (next) => {
      handleOpacityChange(next);
      if (selectedId) stylizeSelection({ opacity: next });
    },
    [handleOpacityChange, selectedId, stylizeSelection],
  );
  const handleSidebarRoughness = useCallback(
    (next) => {
      handleRoughnessChange(next);
      if (selectedId) stylizeSelection({ roughness: next });
    },
    [handleRoughnessChange, selectedId, stylizeSelection],
  );
  const handleSidebarRoundness = useCallback(
    (next) => {
      handleRoundnessChange(next);
      if (selectedId) stylizeSelection({ roundness: next });
    },
    [handleRoundnessChange, selectedId, stylizeSelection],
  );
  const handleSidebarStartArrowhead = useCallback(
    (next) => {
      handleStartArrowheadChange(next);
      if (selectedId) stylizeSelection({ startArrowhead: next });
    },
    [handleStartArrowheadChange, selectedId, stylizeSelection],
  );
  const handleSidebarEndArrowhead = useCallback(
    (next) => {
      handleEndArrowheadChange(next);
      if (selectedId) stylizeSelection({ endArrowhead: next });
    },
    [handleEndArrowheadChange, selectedId, stylizeSelection],
  );
  // Arrow-type picker: connects the sidebar buttons directly to canvas
  // curvature. Switching type rewrites the selected arrow's points so the
  // change is visible immediately (a 2-point arrow has no midpoint for
  // Konva tension to smooth, so Curved injects a perpendicular-offset
  // midpoint; Straight collapses bends back to endpoints; Elbow
  // materializes the orthogonal corner). Commits flow through the single
  // onShapeUpdate JSON boundary. With no arrow selected, only the tool
  // default is updated.
  const handleSidebarArrowType = useCallback(
    (next) => {
      handleArrowTypeChange(next);
      if (!selectedId || !selectedShape || selectedShape.type !== 'arrow') return;
      const pts = Array.isArray(selectedShape.points)
        ? selectedShape.points.filter((v) => typeof v === 'number' && Number.isFinite(v))
        : [];
      if (pts.length < 4) {
        stylizeSelection({ arrowType: next });
        return;
      }
      if (next === 'curved') {
        if (pts.length === 4) {
          const midX = (pts[0] + pts[2]) / 2 - (pts[3] - pts[1]) * 0.2;
          const midY = (pts[1] + pts[3]) / 2 + (pts[2] - pts[0]) * 0.2;
          if (Number.isFinite(midX) && Number.isFinite(midY)) {
            stylizeSelection({
              arrowType: 'curved',
              tension: 0.35,
              points: [pts[0], pts[1], midX, midY, pts[2], pts[3]],
            });
            return;
          }
        }
        stylizeSelection({ arrowType: 'curved', tension: 0.35 });
      } else if (next === 'straight') {
        stylizeSelection({
          arrowType: 'straight',
          tension: 0,
          points: [pts[0], pts[1], pts[pts.length - 2], pts[pts.length - 1]],
        });
      } else if (next === 'elbow') {
        stylizeSelection({
          arrowType: 'elbow',
          tension: 0,
          points: pts.length === 4 ? elbowPoints(pts) : pts,
        });
      } else {
        stylizeSelection({ arrowType: next });
      }
    },
    [handleArrowTypeChange, selectedId, selectedShape, stylizeSelection],
  );
  const handleSidebarFontFamily = useCallback(
    (nextKey) => {
      handleFontFamilyChange(nextKey);
      if (selectedId) {
        stylizeSelection({
          fontFamilyKey: nextKey,
          fontFamily: FONT_FAMILIES[nextKey] ?? FONT_FAMILIES.hand,
        });
      }
    },
    [handleFontFamilyChange, selectedId, stylizeSelection],
  );
  const handleSidebarFontSize = useCallback(
    (next) => {
      handleFontSizeChange(next);
      if (selectedId) stylizeSelection({ fontSize: next });
    },
    [handleFontSizeChange, selectedId, stylizeSelection],
  );
  const handleSidebarTextAlign = useCallback(
    (next) => {
      handleTextAlignChange(next);
      if (selectedId) stylizeSelection({ textAlign: next, align: next });
    },
    [handleTextAlignChange, selectedId, stylizeSelection],
  );

  const handleDuplicate = useCallback(() => {
    if (!selectedShape) return;
    // Clone beside the original with a small (+15px x/y) offset, then
    // select the copy. commitCreate/selectShape fire the Yjs/CRDT
    // onShapeCreate + onSelectionChange triggers as usual.
    const clone = duplicateShape(selectedShape, 15);
    if (!clone) return;
    commitCreate(clone);
    selectShape(clone.id);
  }, [commitCreate, selectShape, selectedShape]);

  // ---- bent arrows: one committed `{ points }` update per bend gesture ----
  const handleBendCommit = useCallback(
    (shapeId, points) => {
      commitUpdate(shapeId, { points });
    },
    [commitUpdate],
  );
  const handleStraighten = useCallback(() => {
    if (!selectedShape || selectedShape.type !== 'arrow') return;
    const p = selectedShape.points ?? [];
    if (p.length <= 4) return;
    commitUpdate(selectedShape.id, { points: [p[0], p[1], p[p.length - 2], p[p.length - 1]] });
  }, [commitUpdate, selectedShape]);

  // ---- z-order actions (sidebar buttons + [ ] shortcuts below) ----
  const handleBringToFront = useCallback(() => {
    if (selectedId) bringToFront(selectedId);
  }, [bringToFront, selectedId]);
  const handleSendToBack = useCallback(() => {
    if (selectedId) sendToBack(selectedId);
  }, [selectedId, sendToBack]);
  const handleBringForward = useCallback(() => {
    if (selectedId) bringForward(selectedId);
  }, [bringForward, selectedId]);
  const handleSendBackward = useCallback(() => {
    if (selectedId) sendBackward(selectedId);
  }, [selectedId, sendBackward]);

  // ---- zoom controls (center-based; shape data stays in world coords) ----
  const zoomBy = useCallback(
    (factor) => {
      const stage = stageRef.current;
      const oldScale = stage ? stage.scaleX() : scale;
      const newScale = clampZoom(oldScale * factor);
      if (newScale === oldScale) return;
      if (stage) {
        const center = { x: stage.width() / 2, y: stage.height() / 2 };
        const world = {
          x: (center.x - stage.x()) / oldScale,
          y: (center.y - stage.y()) / oldScale,
        };
        stage.scale({ x: newScale, y: newScale });
        stage.position({ x: center.x - world.x * newScale, y: center.y - world.y * newScale });
        setScale(newScale);
        setStagePos({ x: stage.x(), y: stage.y() });
      } else {
        setScale(newScale);
      }
    },
    [scale, setScale, setStagePos, stageRef],
  );
  const handleZoomIn = useCallback(() => zoomBy(1.2), [zoomBy]);
  const handleZoomOut = useCallback(() => zoomBy(1 / 1.2), [zoomBy]);
  const handleResetZoom = useCallback(() => {
    const stage = stageRef.current;
    if (stage) {
      stage.scale({ x: 1, y: 1 });
      stage.position({ x: 0, y: 0 });
    }
    setScale(1);
    setStagePos({ x: 0, y: 0 });
  }, [setScale, setStagePos, stageRef]);

  // ---- keyboard shortcuts (ignored while typing / editing text) ----
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (textEditor) return;
      const k = event.key.toLowerCase();
      const map = {
        1: 'select',
        v: 'select',
        2: 'rectangle',
        r: 'rectangle',
        3: 'circle',
        c: 'circle',
        4: 'diamond',
        d: 'diamond',
        a: 'arrow',
        l: 'line',
        p: 'freehand',
        t: 'text',
        e: 'eraser',
        h: 'pan',
      };
      const next = map[k];
      if (next) {
        event.preventDefault();
        handleToolChange(next);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleToolChange, textEditor]);

  return (
    <section className="flex h-full min-h-[520px] min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-[#f8f9fa] shadow-sm">
      <div className="relative min-h-0 flex-1">
        <div className="relative h-full min-h-[520px] overflow-hidden">
          <CanvasStage
            shapes={visibleShapes}
            selectedId={selectedId}
            tool={tool}
            scale={scale}
            stagePos={stagePos}
            stageRef={stageRef}
            shapeNodesRef={shapeNodesRef}
            transformerRef={transformerRef}
            onPointerDown={handleStageMouseDown}
            onPointerMove={handleStageMouseMove}
            onPointerUp={handleStageMouseUp}
            onWheel={handleWheel}
            onDragStageEnd={handleDragStageEnd}
            onShapeClick={handleShapeClick}
            onShapeSelect={handleShapeSelect}
            onShapeDragEnd={handleShapeDragEnd}
            onShapeDragStart={handleShapeDragStart}
            onTransformEnd={handleTransformEnd}
            onTextDoubleClick={openTextEditorForShape}
            onBendCommit={handleBendCommit}
          />
          {/* Top-center floating tool island */}
          <div className="pointer-events-none absolute inset-x-0 top-4 z-50 flex justify-center px-3">
            <Toolbar
              tool={tool}
              onToolChange={handleToolChange}
            />
          </div>
          {/* Top-left contextual property sidebar */}
          <div className="pointer-events-none absolute left-3 top-[76px] z-40 flex">
            <PropertySidebar
              color={inspectorColor}
              fill={inspectorFill}
              strokeWidth={inspectorWidth}
              strokeStyle={inspectorStyle}
              opacity={inspectorOpacity}
              roughness={inspectorRoughness}
              roundness={inspectorRoundness}
              startArrowhead={inspectorStartArrowhead}
              endArrowhead={inspectorEndArrowhead}
              arrowType={inspectorArrowType}
              fontFamilyKey={inspectorFontKey}
              fontSize={inspectorFontSize}
              textAlign={inspectorAlign}
              align={inspectorAlign}
              activeTool={tool}
              tool={tool}
              hasSelection={Boolean(selectedId)}
              selectedShape={selectedShape}
              onColorChange={handleSidebarColor}
              onFillChange={handleSidebarFill}
              onStrokeWidthChange={handleSidebarWidth}
              onStrokeStyleChange={handleSidebarStyle}
              onOpacityChange={handleSidebarOpacity}
              onRoughnessChange={handleSidebarRoughness}
              onRoundnessChange={handleSidebarRoundness}
              onStartArrowheadChange={handleSidebarStartArrowhead}
              onEndArrowheadChange={handleSidebarEndArrowhead}
              onArrowTypeChange={handleSidebarArrowType}
              onFontFamilyChange={handleSidebarFontFamily}
              onFontSizeChange={handleSidebarFontSize}
              onTextAlignChange={handleSidebarTextAlign}
              onAlignChange={handleSidebarTextAlign}
              onDuplicate={handleDuplicate}
              onDelete={deleteSelected}
              onClear={clearCanvas}
              onStraighten={handleStraighten}
              onBringToFront={handleBringToFront}
              onSendToBack={handleSendToBack}
              onBringForward={handleBringForward}
              onSendBackward={handleSendBackward}
            />
          </div>
          {/* Bottom-left zoom + status */}
          <div className="pointer-events-none absolute bottom-4 left-4 z-40 flex">
            <ZoomBar
              scale={scale}
              shapeCount={storeShapes.length}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onResetZoom={handleResetZoom}
              onUndo={undo}
              onRedo={redo}
              canUndo={canUndo}
              canRedo={canRedo}
              onClear={clearCanvas}
            />
          </div>
          <TextEditorOverlay
            editor={textEditor}
            color={color}
            onCommit={commitTextEditor}
            onCancel={cancelTextEditor}
          />
        </div>
      </div>
    </section>
  );
}

// P0 integration contract: Whiteboard is canonical;
// Canvas stays as a backwards-compatible alias.
export { Whiteboard as Canvas, Whiteboard as default };
