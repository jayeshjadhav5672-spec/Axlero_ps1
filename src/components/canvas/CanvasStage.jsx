import { useEffect, useRef, useState } from 'react';
import { Layer, Stage } from 'react-konva';
import ShapeRenderer from './ShapeRenderer';

export default function CanvasStage({ shapes, onPointerDown, onPointerMove, onPointerUp }) {
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

  return (
    <div ref={containerRef} className="h-full min-h-[420px] w-full touch-none overflow-hidden bg-white">
      {size.width > 0 && size.height > 0 && (
        <Stage
          width={size.width}
          height={size.height}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <Layer>
            <ShapeRenderer shapes={shapes} />
          </Layer>
        </Stage>
      )}
    </div>
  );
}

