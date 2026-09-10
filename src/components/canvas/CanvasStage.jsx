import { useEffect, useRef, useState } from 'react';
import { Layer, Stage, Transformer } from 'react-konva';
import ShapeRenderer from './ShapeRenderer';

/**
 * CanvasStage — Sayon (Whiteboard / Konva.js Engineer)
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
  onShapeDragEnd,
  onTransformEnd,
  onTextDoubleClick,
}) {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

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
  // Selection is available in every tool, so this follows the selection
  // rather than the active tool.
  useEffect(() => {
    const tr = transformerRef?.current;
    if (!tr) return;
    if (!selectedShapeId) {
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
  }, [selectedShapeId, shapes, draftShape, shapeNodesRef, stageRef, transformerRef, size]);

  const cursorForTool = () => {
    switch (tool) {
      case 'pan':
        return 'grab';
      case 'select':
        return 'default';
      case 'text':
        return 'text';
      default:
        return 'crosshair';
    }
  };

  return (
    <div
      ref={containerRef}
      className="h-full min-h-[420px] w-full touch-none overflow-hidden bg-slate-50/50 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:16px_16px]"
      style={{ cursor: cursorForTool() }}
    >
      {size.width > 0 && size.height > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          scaleX={scale}
          scaleY={scale}
          x={stagePos.x}
          y={stagePos.y}
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
              onDragEnd={onShapeDragEnd}
              onTransformEnd={onTransformEnd}
              onTextDoubleClick={onTextDoubleClick}
            />
            <Transformer
              ref={transformerRef}
              rotateEnabled
              enabledAnchors={
                // Circles/text scale uniformly; rect/line/arrow free-scale.
                undefined
              }
              boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 5 || newBox.height < 5) return oldBox;
                return newBox;
              }}
            />
          </Layer>
        </Stage>
      )}
    </div>
  );
}
