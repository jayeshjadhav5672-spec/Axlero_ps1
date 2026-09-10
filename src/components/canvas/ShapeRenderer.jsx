import { Line, Rect } from 'react-konva';

export default function ShapeRenderer({ shapes }) {
  return shapes.map((shape) => {
    if (shape.type === 'line') {
      return (
        <Line
          key={shape.id}
          points={shape.points}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          lineCap={shape.lineCap}
          lineJoin={shape.lineJoin}
          tension={0.1}
        />
      );
    }

    if (shape.type === 'rectangle') {
      return (
        <Rect
          key={shape.id}
          x={shape.width < 0 ? shape.x + shape.width : shape.x}
          y={shape.height < 0 ? shape.y + shape.height : shape.y}
          width={Math.abs(shape.width)}
          height={Math.abs(shape.height)}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          fill={shape.fill}
        />
      );
    }

    return null;
  });
}

