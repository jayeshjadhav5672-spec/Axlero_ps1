import React, { useRef, useState } from 'react';
import { Circle } from 'react-konva';
import { findSnapAnchor, isFiniteNum, moveArrowEndpoint } from './utils/shapes.js';

// Keep in sync with EXCALIDRAW_ACCENT in CanvasStage.jsx (imported directly
// here would create a CanvasStage <-> BendHandles module cycle).
const ACCENT = '#6965db';

const CLICK_SLACK_PX = 4; // screen px; a press+release inside this radius = click (no bend committed)

/**
 * BendHandles — Sayon (Whiteboard / Konva.js Engineer)
 *
 * Draggable anchors for the selected arrow OR line. Renders whenever an
 * arrow/line shape is selected, regardless of the active tool (selection
 * mode AND arrow/line tool + inspector mode).
 *
 * - Midpoint bend handle (arrows AND lines): chord midpoint between
 *   endpoints; dragging rewrites the shape as
 *   [startX, startY, newMidX, newMidY, endX, endY] (see ShapeRenderer.jsx).
 * - Endpoint handles (ARROWS only): draggable tail + tip anchors. Dragging
 *   moves one endpoint in real time and magnetically snaps onto nearby
 *   shape anchors (rectangle/diamond/ellipse edge midpoints + center,
 *   see getShapeAnchors/findSnapAnchor in utils/shapes.js). Middle bend
 *   points ride along untouched; curvature re-derives from the endpoints
 *   via the stored tension/arrowType at render time.
 * - Live preview is an imperative node update during the drag (no state
 *   churn, no Yjs spam); `dragend` commits once through `onCommitBend`
 *   (bend) or `onCommitEndpoints` (tip/tail: plain JSON `points` + endpoint
 *   bindings). One gesture = one update, zero Konva node references cross
 *   the serialization boundary.
 * - Press without dragging (click): the node is restored, nothing committed.
 * - Removing the bend ("Straighten" / Straight arrow type) lives in the
 *   property sidebar.
 */
export default function BendHandles({
  shape,
  scale = 1,
  shapeNodesRef,
  onCommitBend,
  // Anchor targets for tip/tail snapping (committed shapes; ghosts excluded
  // inside findSnapAnchor). Endpoint commit callback:
  // (shapeId, localPoints, { startBinding, endBinding }) — bindings are
  // { shapeId, anchor } or null (clears).
  shapes = [],
  onCommitEndpoints,
}) {
  const dragRef = useRef(null); // bend drag: { shapeId, nodeX, nodeY, wStartX/Y, wEndX/Y, startHX, startHY }
  const endDragRef = useRef(null); // endpoint drag: { shapeId, end, nodeX, nodeY, localPoints, fixedWX, fixedWY, startWX, startWY }
  const [snapMark, setSnapMark] = useState(null); // world { x, y } of the live snap target, or null

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
  // world = local + node position (at rest == shape.x/shape.y, usually 0,0).
  const nodeX = node ? node.x() : (shape.x ?? 0);
  const nodeY = node ? node.y() : (shape.y ?? 0);

  // Endpoints in world frame; the handles live in the same Layer (world frame).
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
    // Non-finite drop point (lost pointer capture): restore, commit nothing.
    if (!isFiniteNum(worldX) || !isFiniteNum(worldY)) {
      if (target) {
        target.points(shape.points);
        target.getLayer()?.batchDraw();
      }
      return;
    }
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

  // ---- arrow endpoint (tip/tail) dragging with snap-to-anchor ----
  const beginEndpointDrag = (end) => {
    const liveNode = shapeNodesRef?.current?.get(shape.id);
    const nx = liveNode ? liveNode.x() : nodeX;
    const ny = liveNode ? liveNode.y() : nodeY;
    const [fx, fy, sx, sy] =
      end === 'start'
        ? [wEndX, wEndY, wStartX, wStartY]
        : [wStartX, wStartY, wEndX, wEndY];
    endDragRef.current = {
      shapeId: shape.id,
      end,
      nodeX: nx,
      nodeY: ny,
      fixedWX: fx,
      fixedWY: fy,
      startWX: sx,
      startWY: sy,
    };
  };

  const previewEndpointDrag = (worldX, worldY) => {
    const drag = endDragRef.current;
    if (!drag) return;
    if (!isFiniteNum(worldX) || !isFiniteNum(worldY)) return;
    const snap = findSnapAnchor(worldX, worldY, shapes, { excludeId: drag.shapeId });
    const effX = snap ? snap.x : worldX;
    const effY = snap ? snap.y : worldY;
    setSnapMark(snap ? { x: snap.x, y: snap.y } : null);
    const target = shapeNodesRef?.current?.get(drag.shapeId);
    if (target) {
      const world =
        drag.end === 'start'
          ? [effX, effY, ...shape.points.slice(2)]
          : [...shape.points.slice(0, -2), effX, effY];
      // World -> local through the drag-time node offset (fixed end keeps
      // its committed world position; middles ride along untouched).
      const local = world.map((v, i) => v - (i % 2 === 0 ? drag.nodeX : drag.nodeY));
      target.points(local);
      target.getLayer()?.batchDraw();
    }
  };

  const endEndpointDrag = (worldX, worldY) => {
    const drag = endDragRef.current;
    endDragRef.current = null;
    setSnapMark(null);
    restoreCursor();
    if (!drag) return;
    const target = shapeNodesRef?.current?.get(drag.shapeId);
    if (!isFiniteNum(worldX) || !isFiniteNum(worldY)) {
      if (target) {
        target.points(shape.points);
        target.getLayer()?.batchDraw();
      }
      return;
    }
    const movedPx = Math.hypot(worldX - drag.startWX, worldY - drag.startWY) * scale;
    if (movedPx < CLICK_SLACK_PX) {
      if (target) {
        target.points(shape.points);
        target.getLayer()?.batchDraw();
      }
      return;
    }
    const snap = findSnapAnchor(worldX, worldY, shapes, { excludeId: drag.shapeId });
    const effX = snap ? snap.x : worldX;
    const effY = snap ? snap.y : worldY;
    const nextLocal = moveArrowEndpoint(
      shape.points,
      drag.end,
      effX - drag.nodeX,
      effY - drag.nodeY,
    );
    if (!nextLocal) {
      if (target) {
        target.points(shape.points);
        target.getLayer()?.batchDraw();
      }
      return;
    }
    const binding = snap ? { shapeId: snap.shapeId, anchor: snap.anchor } : null;
    onCommitEndpoints?.(drag.shapeId, nextLocal, {
      startBinding: drag.end === 'start' ? binding : (shape.startBinding ?? null),
      endBinding: drag.end === 'end' ? binding : (shape.endBinding ?? null),
    });
  };

  const setHoverCursor = (cursor) => {
    try {
      const stage = shapeNodesRef?.current?.get(shape.id)?.getStage?.();
      const container = stage?.container?.();
      if (container) container.style.cursor = cursor;
    } catch {
      // best-effort cursor hint only
    }
  };
  const restoreCursor = () => setHoverCursor('');

  const endpointProps = (end) => ({
    draggable: true,
    onDragStart: (e) => {
      e.cancelBubble = true;
      beginEndpointDrag(end);
    },
    onDragMove: (e) => {
      e.cancelBubble = true;
      previewEndpointDrag(e.target.x(), e.target.y());
    },
    onDragEnd: (e) => {
      e.cancelBubble = true;
      endEndpointDrag(e.target.x(), e.target.y());
    },
    onMouseEnter: (e) => {
      e.cancelBubble = true;
      setHoverCursor('move');
    },
    onMouseLeave: () => restoreCursor(),
  });

  // Screen-constant handle size: the Layer is zoom-scaled, so counter-
  // divide world units by the stage scale (at 25% zoom an unscaled 6px
  // handle would shrink to 1.5 screen px and become ungrabbable).
  const safeScale = typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
  const isArrow = shape.type === 'arrow';
  return (
    <>
      <Circle
        key={`${shape.id}-bend`}
        x={midX + nodeX}
        y={midY + nodeY}
        radius={6 / safeScale}
        fill="#ffffff"
        stroke={ACCENT}
        strokeWidth={2 / safeScale}
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
      {isArrow && (
        <Circle
          key={`${shape.id}-endpoint-start`}
          x={wStartX}
          y={wStartY}
          radius={6 / safeScale}
          fill="#ffffff"
          stroke={ACCENT}
          strokeWidth={2 / safeScale}
          {...endpointProps('start')}
        />
      )}
      {isArrow && (
        <Circle
          key={`${shape.id}-endpoint-end`}
          x={wEndX}
          y={wEndY}
          radius={6 / safeScale}
          fill="#ffffff"
          stroke={ACCENT}
          strokeWidth={2 / safeScale}
          {...endpointProps('end')}
        />
      )}
      {isArrow && snapMark && (
        <Circle
          key={`${shape.id}-snap-mark`}
          x={snapMark.x}
          y={snapMark.y}
          radius={10 / safeScale}
          fill="transparent"
          stroke={ACCENT}
          strokeWidth={2 / safeScale}
          dash={[4 / safeScale, 3 / safeScale]}
          listening={false}
        />
      )}
    </>
  );
}
