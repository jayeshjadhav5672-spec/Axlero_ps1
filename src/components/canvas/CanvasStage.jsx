import React, { useEffect, useRef, useState } from 'react';
import { Layer, Stage, Transformer } from 'react-konva';
import BendHandles from './BendHandles';
import ShapeRenderer from './ShapeRenderer';

export const EXCALIDRAW_ACCENT = '#6965db';

/**
 * CanvasStage — Sayon (Whiteboard / Konva.js Engineer)
 * Excalidraw aesthetic: off-white canvas, fine dot-grid, violet
 * transformer accents (#6965db) with rounded anchor dots.
 * - Responsive sizing via ResizeObserver (preserved foundation).
 * - Viewport = Stage scale/position; shape data stays in world coords.
 * - Wheel = zoom to pointer; stage draggable = pan (pan tool).
 * - Single Konva.Transformer attached to the selected shape.
 */
export default function CanvasStage({
  shapes,
  draftShape,
  selectedId: selectedShapeId,
  tool,
  scale,
  stagePos,
  stageRef,
  shapeNodesRef,
  transformerRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  onDragStageEnd,
  onShapeClick,
  onShapeSelect,
  onShapeDragEnd,
  onShapeDragStart,
  onTransformEnd,
  onTextDoubleClick,
  onBendCommit,
}) {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Publish the live Konva Stage to the whiteboard stage registry so the
  // export utility (`src/utils/exportUtils.js`) can resolve it even if the
  // `stageRef` prop chain ever disconnects (fail-safe fallback; the primary
  // path stays `stageRef.current`). ESM-bundled Konva never populates
  // `window.Konva.stages`, hence this explicit registry.
  useEffect(() => {
    const stage = stageRef?.current;
    if (!stage || typeof window === 'undefined') return undefined;
    window.__syncspaceStages = window.__syncspaceStages ?? [];
    if (!window.__syncspaceStages.includes(stage)) window.__syncspaceStages.push(stage);
    return () => {
      if (window.__syncspaceStages) {
        window.__syncspaceStages = window.__syncspaceStages.filter((s) => s !== stage);
      }
    };
  }, [stageRef, size]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const updateSize = () => {
      setSize({ width: container.clientWidth, height: container.clientHeight });
    };
    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Transformer lifecycle: attach to the selected node, detach otherwise.
  // Every branch explicitly releases with nodes([]) + batchDraw() so the
  // transformer never holds a detached node after a delete — the stale
  // hook that broke all subsequent selections/deletions.
  // Selection is available in every tool except text (the text tool owns
  // all pointer events), so the transformer hides while placing text.
  useEffect(() => {
    const tr = transformerRef?.current;
    if (!tr) return;
    if (!selectedShapeId || tool === 'text') {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const selectedNode =
      shapeNodesRef?.current?.get(selectedShapeId) ??
      stageRef?.current?.findOne?.(`#${selectedShapeId}`) ??
      null;
    if (selectedNode) {
      tr.nodes([selectedNode]);
      tr.getLayer()?.batchDraw();
    } else {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
    }
  }, [selectedShapeId, shapes, draftShape, tool, shapeNodesRef, stageRef, transformerRef, size]);

  const cursorForTool = () => {    switch (tool) {
      case 'pan':
        return 'grab';
      case 'select':
        return 'default';
      case 'text':
        return 'text';
      case 'eraser':
        return 'pointer';
      default:
        return 'crosshair';
    }
  };

  // Bend handles appear whenever an arrow or line is selected — in
  // Selection mode AND while the Arrow/Line tool (or any other styling
  // tool) is active. Only the text tool is excluded (it owns all pointer
  // events for text placement).
  // Images resize proportionally (Transformer keepRatio); all other
  // types keep freeform scaling.
  const selectedShape = shapes?.find((s) => s.id === selectedShapeId) ?? null;
  const selectedIsImage = selectedShape?.type === 'image';
  const showBendHandles =
    tool !== 'text' &&
    (selectedShape?.type === 'arrow' || selectedShape?.type === 'line');

  // Never feed NaN/Infinity into Konva attrs (zero-distance pointer
  // releases can otherwise produce `NaN is not a valid value for "x"`).
  const finiteOr = (v, fallback) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const safeScale = finiteOr(scale, 1) || 1;
  const safePos = {
    x: finiteOr(stagePos?.x, 0),
    y: finiteOr(stagePos?.y, 0),
  };

  return (
    <div
      ref={containerRef}
      className="h-full min-h-[420px] w-full touch-none overflow-hidden bg-[#ffffff] bg-[radial-gradient(#d3d8de_1px,transparent_1.25px)] [background-size:20px_20px]"
      style={{ cursor: cursorForTool() }}
      data-testid="excalidraw-canvas"
    >
      {size.width > 0 && size.height > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          scaleX={safeScale}
          scaleY={safeScale}
          x={safePos.x}
          y={safePos.y}
          draggable={tool === 'pan'}
          onDragEnd={tool === 'pan' ? onDragStageEnd : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
        >
          <Layer>
            <ShapeRenderer
              shapes={shapes}
              selectedId={selectedShapeId}
              tool={tool}
              shapeNodesRef={shapeNodesRef}
              onShapeClick={onShapeClick}
              onSelect={onShapeSelect}
              onDragEnd={onShapeDragEnd}
              onDragStart={onShapeDragStart}
              onTransformEnd={onTransformEnd}
              onTextDoubleClick={onTextDoubleClick}
            />
            {showBendHandles && (
              <BendHandles
                shape={selectedShape}
                scale={scale}
                shapeNodesRef={shapeNodesRef}
                onCommitBend={onBendCommit}
              />
            )}
            <Transformer
              ref={transformerRef}
              rotateEnabled
              keepRatio={selectedIsImage}
              borderStroke={EXCALIDRAW_ACCENT}
              borderStrokeWidth={1.5}
              anchorStroke={EXCALIDRAW_ACCENT}
              anchorFill="#ffffff"
              anchorStrokeWidth={1.5}
              anchorSize={9}
              anchorCornerRadius={5}
              rotateAnchorOffset={20}
              padding={4}
              flipEnabled={false}
              boundBoxFunc={(oldBox, newBox) => {
                if (
                  !Number.isFinite(newBox?.width) ||
                  !Number.isFinite(newBox?.height) ||
                  newBox.width < 5 ||
                  newBox.height < 5
                ) {
                  return oldBox;
                }
                return newBox;
              }}
            />
          </Layer>
        </Stage>
      )}
    </div>
  );
}
