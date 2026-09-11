import { useRef } from 'react';
import { Circle } from 'react-konva';

// Keep in sync with EXCALIDRAW_ACCENT in CanvasStage.jsx (imported directly
// here would create a CanvasStage <-> BendHandles module cycle).
const ACCENT = '#6965db';

const CLICK_SLACK_PX = 4; // screen px; a press+release inside this radius = click (no bend committed)

/**
 * BendHandles — Sayon (Whiteboard / Konva.js Engineer)
 *
 * Single draggable midpoint anchor for bending the selected arrow OR line.
 * Renders whenever an arrow/line shape is selected, regardless of the
 * active tool (selection mode AND arrow/line tool + inspector mode).
 * - Handle position (chord midpoint between endpoints):
 *     midX = (points[0] + points[points.length - 2]) / 2
 *     midY = (points[1] + points[points.length - 1]) / 2
 * - Dragging rewrites the shape as [startX, startY, newMidX, newMidY, endX, endY];
 *   arrows render it as a smooth curve via stored `tension`, plain lines
 *   render it as an angled polyline (see ShapeRenderer.jsx).
 * - Live preview is an imperative node update during the drag (no state churn,
 *   no Yjs spam); `dragend` commits the plain JSON `points` array once through
 *   `onCommitBend` → `onShapeUpdate`. One gesture = one update, zero Konva
 *   node references cross the serialization boundary.
 * - Press without dragging (click): the node is restored, nothing committed.
 * - Removing the bend ("Straighten" / Straight arrow type) lives in the
 *   property sidebar.
 */
export default function BendHandles({ shape, scale = 1, shapeNodesRef, onCommitBend }) {
  const dragRef = useRef(null); // { shapeId, nodeX, nodeY, wStartX/Y, wEndX/Y, startHX, startHY }

  const isArrowOrLine = shape?.type === 'arrow' || shape?.type === 'line';
  if (
    !shape ||
    !isArrowOrLine ||
    !Array.isArray(shape.points) ||
    shape.points.length < 4
  ) {
    return null;
  }

  const pts = shape.points;
  const n = pts.length;
  const startX = pts[0];
  const startY = pts[1];
  const endX = pts[n - 2];
  const endY = pts[n - 1];
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;

  const node = shapeNodesRef?.current?.get(shape.id);
  // Stored points are node-local by definition (renderer passes them verbatim);
  // world = local + node position (at rest == shape.x/shape.y).
  const nodeX = node ? node.x() : (shape.x ?? 0);
  const nodeY = node ? node.y() : (shape.y ?? 0);

  // Endpoints in world frame; the handle lives in the same Layer (world frame).
  const wStartX = startX + nodeX;
  const wStartY = startY + nodeY;
  const wEndX = endX + nodeX;
  const wEndY = endY + nodeY;

  const toLocal = (world, nx, ny) => world.map((v, i) => v - (i % 2 === 0 ? nx : ny));

  const beginDrag = () => {
    dragRef.current = {
      shapeId: shape.id,
      nodeX,
      nodeY,
      wStartX,
      wStartY,
      wEndX,
      wEndY,
      startHX: midX + nodeX,
      startHY: midY + nodeY,
    };
  };

  const previewDrag = (worldX, worldY) => {
    const drag = dragRef.current;
    if (!drag) return;
    const target = shapeNodesRef?.current?.get(drag.shapeId);
    if (target) {
      target.points(
        toLocal(
          [drag.wStartX, drag.wStartY, worldX, worldY, drag.wEndX, drag.wEndY],
          drag.nodeX,
          drag.nodeY,
        ),
      );
      target.getLayer()?.batchDraw();
    }
  };

  const endDrag = (worldX, worldY) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const target = shapeNodesRef?.current?.get(drag.shapeId);
    const movedPx = Math.hypot(worldX - drag.startHX, worldY - drag.startHY) * scale;
    if (movedPx < CLICK_SLACK_PX) {
      // Click without drag: restore the untouched committed points, commit nothing.
      if (target) {
        target.points(shape.points);
        target.getLayer()?.batchDraw();
      }
      return;
    }
    onCommitBend?.(
      drag.shapeId,
      toLocal(
        [drag.wStartX, drag.wStartY, worldX, worldY, drag.wEndX, drag.wEndY],
        drag.nodeX,
        drag.nodeY,
      ),
    );
  };

  return (
    <Circle
      key={`${shape.id}-bend`}
      x={midX + nodeX}
      y={midY + nodeY}
      radius={6}
      fill="#ffffff"
      stroke={ACCENT}
      strokeWidth={2}
      draggable={true}
      onDragStart={(e) => {
        e.cancelBubble = true;
        beginDrag();
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
        previewDrag(e.target.x(), e.target.y());
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        endDrag(e.target.x(), e.target.y());
      }}
    />
  );
}
