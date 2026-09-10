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
  selectedId,
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

  // Attach transformer to the selected node (or detach on deselect).
  // Selection is available in every tool (clicking a shape selects it),
  // so the transformer follows the selection rather than the tool.
  useEffect(() => {
    const transformer = transformerRef?.current;
    if (!transformer) return;
    const node = selectedId ? shapeNodesRef?.current?.get(selectedId) : null;
    if (node) {
      transformer.nodes([node]);
    } else {
      transformer.nodes([]);
    }
    transformer.getLayer()?.batchDraw();
  }, [selectedId, shapes, draftShape, shapeNodesRef, transformerRef, size]);

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
              selectedId={selectedId}
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
