import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Konva from 'konva';
import { Layer, Line, Rect, Stage, Transformer } from 'react-konva';
import BendHandles from './BendHandles';
import ShapeRenderer from './ShapeRenderer';
import { getShapeBounds } from './utils/shapes.js';
import { isValidSelection } from './utils/liveSync.js';

export const EXCALIDRAW_ACCENT = '#6965db';

/**
 * RemoteSelectionOverlay — imperative peer-selection overlay with ZERO
 * React re-renders. A memoized shell renders one empty Konva Layer exactly
 * once; `collab:selection` packets drive raw Konva nodes (Rect outlines +
 * name badges) directly: old peer group destroyed, new group built from
 * descriptor bounds (no node.getClientRect() matrix math in render —
 * getShapeBounds is pure arithmetic), layer.batchDraw() once per packet.
 * Shapes resolve through a ref mirror (no state subscription), quiet peers
 * expire on an interval, and everything is listening={false} so local
 * gestures never interact with it.
 */
const RemoteSelectionOverlay = React.memo(function RemoteSelectionOverlay({
  socket,
  roomId,
  selfUserId,
  shapesRef,
}) {
  const layerRef = useRef(null);
  const peersRef = useRef(new Map()); // peerKey -> { group, lastSeen }
  const roomRef = useRef(roomId);
  roomRef.current = roomId;
  const selfRef = useRef(selfUserId);
  selfRef.current = selfUserId;

  const dropPeer = useCallback((key) => {
    const entry = peersRef.current.get(key);
    if (!entry) return false;
    try {
      entry.group.destroy();
    } catch {
      // ignore teardown failures
    }
    peersRef.current.delete(key);
    return true;
  }, []);

  const paintPeer = useCallback(
    (key, sel) => {
      const layer = layerRef.current;
      if (!layer) return;
      dropPeer(key);
      const shapes = shapesRef.current ?? [];
      const color = sel.color;
      const group = new Konva.Group({ listening: false });
      let labeled = false;
      for (const id of sel.shapeIds) {
        const shape = shapes.find((s) => s?.id === id);
        const b = shape ? getShapeBounds(shape) : null;
        if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
        const bx = b.x - 4;
        const by = b.y - 4;
        const bw = Math.max(1, b.width + 8);
        const bh = Math.max(1, b.height + 8);
        group.add(
          new Konva.Rect({
            x: bx,
            y: by,
            width: bw,
            height: bh,
            fill: 'transparent',
            stroke: color,
            strokeWidth: 1.5,
            dash: [7, 5],
            cornerRadius: 4,
            listening: false,
          }),
        );
        if (!labeled) {
          const name = sel.userName;
          group.add(
            new Konva.Rect({
              x: bx,
              y: by - 20,
              width: name.length * 7 + 12,
              height: 18,
              fill: color,
              cornerRadius: 6,
              listening: false,
            }),
          );
          group.add(
            new Konva.Text({
              x: bx + 6,
              y: by - 18,
              text: name,
              fontSize: 12,
              fontFamily: 'sans-serif',
              fill: '#ffffff',
              listening: false,
            }),
          );
          labeled = true;
        }
      }
      layer.add(group);
      peersRef.current.set(key, { group, lastSeen: Date.now() });
      layer.batchDraw();
    },
    [dropPeer, shapesRef],
  );

  useEffect(() => {
    if (!socket || typeof socket.on !== 'function') return undefined;
    const onSelection = (payload) => {
      if (!payload || payload.roomId !== roomRef.current) return;
      const data = payload.data;
      if (!isValidSelection(data)) return;
      const key = data.userId || payload.socketId || 'unknown';
      if (key === selfRef.current) return; // never paint our own highlight
      paintPeer(key, {
        color: data.color ?? '#4f46e5',
        userName: data.userName ?? 'Guest',
        shapeIds: [...new Set(data.shapeIds)],
      });
    };
    socket.on('collab:selection', onSelection);
    const timer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [key, entry] of peersRef.current) {
        if (now - (entry?.lastSeen ?? 0) > 30000) {
          dropPeer(key);
          changed = true;
        }
      }
      if (changed) {
        try {
          layerRef.current?.batchDraw();
        } catch {
          // ignore
        }
      }
    }, 10000);
    return () => {
      clearInterval(timer);
      try {
        socket.off?.('collab:selection', onSelection);
      } catch {
        // ignore teardown failures
      }
    };
  }, [socket, paintPeer]);

  return <Layer ref={layerRef} id="remote-selection-layer" listening={false} />;
});

/**
 * CanvasStage — Sayon (Whiteboard / Konva.js Engineer)
 * Plain solid-white canvas with violet transformer accents (#6965db)
 * and rounded anchor dots. No dot-grid, no background pattern.
 * - Responsive sizing via ResizeObserver (preserved foundation).
 * - Viewport = Stage scale/position; shape data stays in world coords.
 * - Wheel = zoom to pointer; stage draggable = pan (pan tool).
 * - Single Konva.Transformer attached to the selected shape.
 */
export default function CanvasStage({
  shapes,
  draftShape,
  selectedId: selectedShapeId,
  selectedIds,
  tool,
  scale,
  stagePos,
  stageRef,
  shapeNodesRef,
  transformerRef,
  guidelines = [],
  selectBox = null,
  // Peer selection transport for the imperative overlay below. Tools and
  // local selection stay strictly per-client; this only feeds the
  // non-listening highlight layer (zero React re-renders on receipt).
  syncSocket = null,
  syncRoomId = null,
  syncUserId = null,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  onDragStageEnd,
  // Continuous pan streaming: mirrors the drag in real time on peers
  // (settled position still commits on drag end). Attached only in pan
  // mode, mirroring the onDragEnd gate below.
  onDragStageMove,
  onShapeClick,
  onShapeSelect,
  onShapeDragEnd,
  onShapeDragStart,
  onShapeDragMove,
  onTransformEnd,
  onTextDoubleClick,
  onBendCommit,
  // Arrow tip/tail endpoint commit (drag with snap-to-anchor):
  // (shapeId, localPoints, { startBinding, endBinding }).
  onEndpointCommit,
  // Committed shapes used as snap-anchor targets for arrow endpoints.
  anchorShapes = null,
}) {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Instant imperative selection attachment (0ms visual feedback): attach
  // the Transformer to the clicked node synchronously inside the pointer
  // event instead of waiting for the selectedId round-trip (React state →
  // re-render → effect). The node resolves from the registered map (robust
  // for Group shapes where e.target may be a child sub-node), with a
  // findOne fallback; parent state is notified in the background and the
  // lifecycle effect below no-ops on the identical set. Never detaches
  // here on lookup miss — the effect reconciles those cases.
  const handleShapeSelectDirect = useCallback(
    (shapeId) => {
      try {
        const tr = transformerRef?.current;
        if (tr && shapeId) {
          const node =
            shapeNodesRef?.current?.get(shapeId) ??
            stageRef?.current?.findOne?.(`#${shapeId}`) ??
            null;
          if (node && typeof node.getStage === 'function') {
            tr.nodes([node]);
            tr.getLayer()?.batchDraw();
          }
        }
      } catch {
        // imperative bridge is best-effort; the effect reconciles
      }
      onShapeSelect?.(shapeId);
    },
    [onShapeSelect, shapeNodesRef, stageRef, transformerRef],
  );

  // Instant deselect on blank-stage click (select tool only — draw/text
  // tools own their pointer gestures). Idempotent with the existing
  // marquee-up deselect; the outbound selection broadcast dedupes.
  const handleStageClick = useCallback(
    (e) => {
      if (tool !== 'select' && tool !== 'selection') return;
      const stage = stageRef?.current;
      if (!stage || e.target !== stage) return;
      try {
        const tr = transformerRef?.current;
        if (tr && tr.nodes().length > 0) {
          tr.nodes([]);
          tr.getLayer()?.batchDraw();
        }
      } catch {
        // ignore teardown failures
      }
      onShapeSelect?.(null);
    },
    [onShapeSelect, stageRef, tool, transformerRef],
  );

  // Live mirror of the shapes array for the imperative overlay (plain ref
  // write during render — no subscription, no re-render trigger).
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;

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
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      setSize({ width: newWidth, height: newHeight });
      // Keep the Konva stage in sync with its container during local
      // split-pane resizes: imperative width sync + batchDraw avoids
      // canvas clipping / rendering artifacts mid-drag.
      try {
        const stage = stageRef?.current;
        if (stage && Number.isFinite(newWidth) && Number.isFinite(newHeight)) {
          stage.width(newWidth);
          stage.height(newHeight);
          stage.batchDraw();
        }
      } catch {
        // best-effort; React width/height props reconcile next render
      }
    };
    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [stageRef]);

  // Transformer lifecycle: attach to the selected node(s), detach otherwise.
  // Every branch explicitly releases with nodes([]) + batchDraw() so the
  // transformer never holds a detached node after a delete — the stale
  // hook that broke all subsequent selections/deletions.
  // Selection is available in every tool except text (the text tool owns
  // all pointer events), so the transformer hides while placing text.
  // Multi-selection (marquee): when `selectedIds` carries several ids, all
  // matching nodes attach to the single Transformer.
  // No-op guard: when the resolved node set is identical to the attached
  // set, skip nodes()+batchDraw() — preview traffic re-runs this effect
  // (shapes identity changes) and redundant Konva redraws per tick would
  // reintroduce the invalidation storm the overlay split just removed.
  useEffect(() => {
    const tr = transformerRef?.current;
    if (!tr) return;
    const syncNodes = (nodes) => {
      const prev = tr.nodes();
      if (
        prev.length === nodes.length &&
        prev.every((n, i) => n === nodes[i])
      ) {
        return;
      }
      tr.nodes(nodes);
      tr.getLayer()?.batchDraw();
    };
    if (!selectedShapeId || tool === 'text') {
      // Marquee multi-select can exist without a primary single id:
      // attach all nodes when selectedIds is non-empty even if the
      // primary selectedShapeId is null.
      const multi = Array.isArray(selectedIds) ? selectedIds : [];
      if (multi.length > 1 || (!selectedShapeId && multi.length > 0)) {
        const nodes = multi
          .map(
            (id) =>
              shapeNodesRef?.current?.get(id) ??
              stageRef?.current?.findOne?.(`#${id}`) ??
              null,
          )
          .filter(Boolean);
        syncNodes(nodes);
        return;
      }
      if (!selectedShapeId) {
        syncNodes([]);
        return;
      }
      syncNodes([]);
      return;
    }
    const ids =
      Array.isArray(selectedIds) && selectedIds.length > 1
        ? selectedIds
        : [selectedShapeId];
    const nodes = ids
      .map(
        (id) =>
          shapeNodesRef?.current?.get(id) ??
          stageRef?.current?.findOne?.(`#${id}`) ??
          null,
      )
      .filter(Boolean);
    if (nodes.length > 0) {
      syncNodes(nodes);
    } else {
      syncNodes([]);
    }
  }, [selectedShapeId, selectedIds, shapes, draftShape, tool, shapeNodesRef, stageRef, transformerRef, size]);

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

  // In-flight overlay separation: committed shapes render in the main
  // layer below; the local draft + remote peer previews render in a
  // dedicated lightweight layer above. Preview traffic therefore
  // reconciles ONLY the tiny overlay list (memoized per-shape nodes bail
  // out below) instead of re-rendering the committed tree per tick —
  // eliminating the React↔Konva double-invalidation storm. Paint order
  // matches the old merged array: draft beneath remote previews.
  const committedShapes = useMemo(
    () => (shapes ?? []).filter((s) => s && !s.remotePreview && (!draftShape || s.id !== draftShape.id)),
    [shapes, draftShape],
  );
  const inflightShapes = useMemo(() => {
    const list = [];
    if (draftShape) list.push(draftShape);
    for (const s of shapes ?? []) {
      if (s && s.remotePreview && (!draftShape || s.id !== draftShape.id)) list.push(s);
    }
    return list;
  }, [shapes, draftShape]);

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
      className="h-full min-h-0 w-full flex-1 touch-none overflow-hidden bg-white"
      style={{
        cursor: cursorForTool(),
        backgroundColor: '#ffffff',
        backgroundImage: 'none',
      }}
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
          onDragMove={tool === 'pan' ? onDragStageMove : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onClick={handleStageClick}
          onWheel={onWheel}
        >
          <Layer>
            <ShapeRenderer
              shapes={committedShapes}
              selectedId={selectedShapeId}
              tool={tool}
              shapeNodesRef={shapeNodesRef}
              onShapeClick={onShapeClick}
              onSelect={handleShapeSelectDirect}
              onDragEnd={onShapeDragEnd}
              onDragStart={onShapeDragStart}
              onDragMove={onShapeDragMove}
              onTransformEnd={onTransformEnd}
              onTextDoubleClick={onTextDoubleClick}
            />
            {showBendHandles && (
              <BendHandles
                shape={selectedShape}
                scale={scale}
                shapeNodesRef={shapeNodesRef}
                onCommitBend={onBendCommit}
                shapes={anchorShapes ?? committedShapes}
                onCommitEndpoints={onEndpointCommit}
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
          {/* In-flight overlay: local draft + remote peer previews. Isolated
          from the committed tree above so per-tick preview traffic skips
          main-layer reconciliation (memoized nodes bail out regardless).
          Draft interactivity matches legacy behavior (same handlers); peer
          previews self-disable via their remotePreview flag. */}
          {inflightShapes.length > 0 && (
            <Layer id="inflight-layer" listening={false}>
              <ShapeRenderer
                shapes={inflightShapes}
                selectedId={selectedShapeId}
                tool={tool}
                shapeNodesRef={shapeNodesRef}
                onShapeClick={onShapeClick}
                onSelect={handleShapeSelectDirect}
                onDragEnd={onShapeDragEnd}
                onDragStart={onShapeDragStart}
                onDragMove={onShapeDragMove}
                onTransformEnd={onTransformEnd}
                onTextDoubleClick={onTextDoubleClick}
              />
            </Layer>
          )}
          {/* Marquee selection box: semi-transparent blue rect with dashed border */}
          {selectBox && (
            <Layer listening={false}>
              <Rect
                x={Math.min(selectBox.x, selectBox.x + selectBox.width)}
                y={Math.min(selectBox.y, selectBox.y + selectBox.height)}
                width={Math.abs(selectBox.width)}
                height={Math.abs(selectBox.height)}
                fill="rgba(59, 130, 246, 0.15)"
                stroke="#3b82f6"
                strokeWidth={1}
                dash={[6, 4]}
                listening={false}
              />
            </Layer>
          )}
          {/* Smart-alignment guidelines: dedicated non-listening layer above
          content. Snappy 1px dotted lines across the viewport for each
          active snap descriptor. */}
          <Layer id="guidelines-layer" listening={false}>
            {(guidelines ?? []).map((g, i) =>
              g?.orientation === 'vertical' ? (
                <Line
                  key={`v-${i}-${g.position}`}
                  points={[g.position, -5000, g.position, 5000]}
                  stroke="#ec4899"
                  strokeWidth={1}
                  dash={[6, 4]}
                  listening={false}
                />
              ) : (
                <Line
                  key={`h-${i}-${g.position}`}
                  points={[-5000, g.position, 5000, g.position]}
                  stroke="#3b82f6"
                  strokeWidth={1}
                  dash={[6, 4]}
                  listening={false}
                />
              ),
            )}
          </Layer>
          {/* Peer selection presence: imperative overlay (zero React
          re-renders on receipt — nodes mutate directly). Dashed
          peer-colored outlines + one name badge per peer; pure overlay so
          local gestures pass through to the Stage/shapes beneath. */}
          <RemoteSelectionOverlay
            socket={syncSocket}
            roomId={syncRoomId}
            selfUserId={syncUserId}
            shapesRef={shapesRef}
          />
        </Stage>
      )}
    </div>
  );
}
