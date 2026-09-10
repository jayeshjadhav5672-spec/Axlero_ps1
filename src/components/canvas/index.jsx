import { useState } from 'react';
import CanvasStage from './CanvasStage';
import TextEditorOverlay from './TextEditorOverlay';
import Toolbar from './Toolbar';
import useCanvasDrawing from './useCanvasDrawing';

/**
 * Canvas (Whiteboard) — Sayon, Interactive Whiteboard / Konva.js Engineer
 *
 * Collaboration-ready boundary: shapes are plain serializable JSON with
 * stable `shape-<uuid>` ids. No Socket.io / Yjs imports here.
 *
 * Props (all optional for standalone use; wired by Avantee/Shree):
 * - shapes: controlled shape array (external/Yjs state). Omit for local state.
 * - selectedShapeId: controlled selection. Omit for local selection.
 * - tool, color, strokeWidth: optionally controlled.
 * - onShapeCreate(shape), onShapeUpdate(shapeId, changes),
 *   onShapeDelete(shapeId), onCanvasClear(), onSelectionChange(shapeId)
 */
export default function Canvas({
  shapes: controlledShapes,
  selectedShapeId: controlledSelection,
  tool: controlledTool,
  color: controlledColor,
  strokeWidth: controlledWidth,
  onShapeCreate,
  onShapeUpdate,
  onShapeDelete,
  onCanvasClear,
  onSelectionChange,
} = {}) {
  const [internalTool, setInternalTool] = useState('select');
  const [internalColor, setInternalColor] = useState('#0f766e');
  const [internalWidth, setInternalWidth] = useState(4);

  const tool = controlledTool ?? internalTool;
  const color = controlledColor ?? internalColor;
  const strokeWidth = controlledWidth ?? internalWidth;
  const setTool = controlledTool !== undefined ? () => {} : setInternalTool;
  const setColor = controlledColor !== undefined ? () => {} : setInternalColor;
  const setStrokeWidth = controlledWidth !== undefined ? () => {} : setInternalWidth;

  const {
    visibleShapes,
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
    handleShapeDragEnd,
    handleTransformEnd,
    openTextEditorForShape,
    commitTextEditor,
    cancelTextEditor,
    deleteSelected,
    clearCanvas,
  } = useCanvasDrawing({
    tool,
    color,
    strokeWidth,
    shapes: controlledShapes,
    selectedShapeId: controlledSelection,
    onShapeCreate,
    onShapeUpdate,
    onShapeDelete,
    onCanvasClear,
    onSelectionChange,
  });

  return (
    <section className="flex h-full min-h-[520px] min-w-0 flex-col overflow-hidden rounded-xl border border-teal-100 bg-teal-50 shadow-sm">
      <Toolbar
        tool={tool}
        color={color}
        strokeWidth={strokeWidth}
        hasSelection={Boolean(selectedId)}
        onToolChange={setTool}
        onColorChange={setColor}
        onStrokeWidthChange={setStrokeWidth}
        onDelete={deleteSelected}
        onClear={clearCanvas}
      />

      <div className="min-h-0 flex-1 p-3">
        <div className="relative h-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-inner">
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
            onShapeDragEnd={handleShapeDragEnd}
            onTransformEnd={handleTransformEnd}
            onTextDoubleClick={openTextEditorForShape}
          />
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
