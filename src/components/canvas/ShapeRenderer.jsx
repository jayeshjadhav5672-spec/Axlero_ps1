import { Arrow, Circle, Line, Rect, Text } from 'react-konva';

/**
 * ShapeRenderer — Sayon (Whiteboard / Konva.js Engineer)
 * Renders plain serializable shape objects as Konva nodes.
 * Back-compat: legacy `{ type: 'line', points: [...] }` with more than
 * 4 points is rendered as a tensioned freehand stroke.
 */
export default function ShapeRenderer({
  shapes,
  selectedId,
  tool,
  shapeNodesRef,
  onShapeClick,
  onDragEnd,
  onTransformEnd,
  onTextDoubleClick,
}) {
  const draggable = tool === 'select';

  const registerNode = (shapeId) => (node) => {
    if (!shapeNodesRef) return;
    if (node) shapeNodesRef.current.set(shapeId, node);
    else shapeNodesRef.current.delete(shapeId);
  };

  return shapes.map((shape) => {
    // NOTE (React 19): `key` must be passed directly as a JSX prop.
    // It is intentionally NOT part of this spread object.
    const common = {
      ref: registerNode(shape.id),
      draggable,
      rotation: shape.rotation ?? 0,
      opacity: shape.id === selectedId ? 1 : 1,
      onClick: (e) => onShapeClick?.(e, shape.id),
      onTap: (e) => onShapeClick?.(e, shape.id),
      onDragEnd: (e) => onDragEnd?.(shape.id, e.target.x(), e.target.y()),
      onTransformEnd: () => onTransformEnd?.(shape.id),
    };

    // Legacy freehand blobs stored as type 'line' with long points arrays.
    if (shape.type === 'freehand' || (shape.type === 'line' && shape.points?.length > 4)) {
      return (
        <Line
          key={shape.id}
          {...common}
          x={shape.x ?? 0}
          y={shape.y ?? 0}
          points={shape.points}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          lineCap="round"
          lineJoin="round"
          tension={0.5}
          listening={tool === 'select' || common.draggable}
        />
      );
    }

    if (shape.type === 'rectangle') {
      return (
        <Rect
          key={shape.id}
          {...common}
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          fill={shape.fill ?? 'transparent'}
        />
      );
    }

    if (shape.type === 'circle') {
      return (
        <Circle
          key={shape.id}
          {...common}
          x={shape.x}
          y={shape.y}
          radius={Math.max(0.1, shape.radius)}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          fill={shape.fill ?? 'transparent'}
        />
      );
    }

    if (shape.type === 'line') {
      return (
        <Line
          key={shape.id}
          {...common}
          x={shape.x ?? 0}
          y={shape.y ?? 0}
          points={shape.points}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          lineCap="round"
          tension={0}
          hitStrokeWidth={Math.max(12, shape.strokeWidth + 8)}
        />
      );
    }

    if (shape.type === 'arrow') {
      return (
        <Arrow
          key={shape.id}
          {...common}
          x={shape.x ?? 0}
          y={shape.y ?? 0}
          points={shape.points}
          stroke={shape.stroke}
          fill={shape.fill ?? shape.stroke}
          strokeWidth={shape.strokeWidth}
          lineCap="round"
          lineJoin="round"
          pointerLength={12}
          pointerWidth={10}
          hitStrokeWidth={Math.max(12, shape.strokeWidth + 8)}
        />
      );
    }

    if (shape.type === 'text') {
      return (
        <Text
          key={shape.id}
          {...common}
          x={shape.x}
          y={shape.y}
          text={shape.text}
          fontSize={shape.fontSize ?? 20}
          fontFamily={shape.fontFamily ?? 'Inter, sans-serif'}
          fill={shape.fill ?? '#0f172a'}
          onDblClick={() => onTextDoubleClick?.(shape)}
          onDblTap={() => onTextDoubleClick?.(shape)}
        />
      );
    }

    return null;
  });
}
