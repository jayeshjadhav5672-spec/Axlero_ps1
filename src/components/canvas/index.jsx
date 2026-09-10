import { useState } from 'react';
import CanvasStage from './CanvasStage';
import Toolbar from './Toolbar';
import useCanvasDrawing from './useCanvasDrawing';

export default function Canvas() {
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#0f766e');
  const { shapes, handleMouseDown, handleMouseMove, handleMouseUp, clearCanvas } =
    useCanvasDrawing({ tool, color });

  return (
    <section className="flex h-full min-h-[520px] min-w-0 flex-col overflow-hidden rounded-xl border border-teal-100 bg-teal-50 shadow-sm">
      <Toolbar
        tool={tool}
        color={color}
        onToolChange={setTool}
        onColorChange={setColor}
        onClear={clearCanvas}
      />

      <div className="min-h-0 flex-1 p-3">
        <div className="h-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-inner">
          <CanvasStage
            shapes={shapes}
            onPointerDown={handleMouseDown}
            onPointerMove={handleMouseMove}
            onPointerUp={handleMouseUp}
          />
        </div>
      </div>
    </section>
  );
}

