import { useCallback, useState } from 'react';

const DEFAULT_STROKE_WIDTH = 4;

const createShapeId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `shape-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const getPointerPosition = (event) => {
  const stage = event.target.getStage();
  return stage?.getPointerPosition() ?? null;
};

/**
 * Owns the local drawing state. The returned shapes are intentionally plain
 * objects so they can be sent over a WebSocket without transformation.
 */
export default function useCanvasDrawing({
  tool = 'pen',
  color = '#0f766e',
  strokeWidth = DEFAULT_STROKE_WIDTH,
}) {
  const [shapes, setShapes] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [activeShapeId, setActiveShapeId] = useState(null);

  const handleMouseDown = useCallback(
    (event) => {
      const position = getPointerPosition(event);
      if (!position) return;

      const id = createShapeId();
      const nextShape =
        tool === 'rectangle'
          ? {
              id,
              type: 'rectangle',
              x: position.x,
              y: position.y,
              width: 0,
              height: 0,
              stroke: color,
              strokeWidth,
              fill: 'transparent',
            }
          : {
              id,
              type: 'line',
              points: [position.x, position.y],
              stroke: color,
              strokeWidth,
              lineCap: 'round',
              lineJoin: 'round',
            };

      setShapes((currentShapes) => [...currentShapes, nextShape]);
      setActiveShapeId(id);
      setIsDrawing(true);
    },
    [color, strokeWidth, tool],
  );

  const handleMouseMove = useCallback(
    (event) => {
      if (!isDrawing || !activeShapeId) return;

      const position = getPointerPosition(event);
      if (!position) return;

      setShapes((currentShapes) =>
        currentShapes.map((shape) => {
          if (shape.id !== activeShapeId) return shape;

          if (shape.type === 'line') {
            return {
              ...shape,
              points: [...shape.points, position.x, position.y],
            };
          }

          return {
            ...shape,
            width: position.x - shape.x,
            height: position.y - shape.y,
          };
        }),
      );
    },
    [activeShapeId, isDrawing],
  );

  const handleMouseUp = useCallback(() => {
    setIsDrawing(false);
    setActiveShapeId(null);
  }, []);

  const clearCanvas = useCallback(() => {
    setShapes([]);
    setIsDrawing(false);
    setActiveShapeId(null);
  }, []);

  return {
    shapes,
    isDrawing,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    clearCanvas,
    setShapes,
  };
}

