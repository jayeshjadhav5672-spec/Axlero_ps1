import React, { useEffect, useMemo, useState } from 'react';
import { Arrow, Circle, Ellipse, Group, Image as KonvaImage, Line, Rect, Text } from 'react-konva';
import {
  circleRadii,
  dashForStyle,
  DEFAULTS,
  diamondCornerRadius,
  diamondPoints,
  displayPointsForArrow,
  estimateTextWidth,
  isFiniteNum,
  konvaOpacity,
  resolveFontFamily,
  roundedDiamondPoints,
  sanitizePoints,
  tensionForArrowType,
} from './utils/shapes.js';

/** Render-time fallbacks so Konva never receives NaN attrs. */
const safeX = (v) => (isFiniteNum(v) ? v : 0);
const safeCoord = (v) => (isFiniteNum(v) ? v : 0);
const safeSize = (v) => (isFiniteNum(v) ? Math.max(1, v) : 1);

/**
 * ImageShape — renders `type: 'image'` via an HTML Image() instance.
 * Hooks live here (not in the map loop) so src swaps reload cleanly.
 */
function ImageShape({ shape, common }) {
  const [img, setImg] = useState(null);
  useEffect(() => {
    if (!shape.src || typeof shape.src !== 'string') {
      setImg(null);
      return undefined;
    }
    let cancelled = false;
    const htmlImg = new window.Image();
    // CORS: request remote image bytes with CORS so the canvas never
    // becomes tainted (tainted canvas makes stage.toDataURL() throw a
    // security DOMException on export). No-op for data:/blob: URLs —
    // local paste/drop ingestion already stores base64 data URLs.
    htmlImg.crossOrigin = 'anonymous';
    htmlImg.onload = () => {
      if (!cancelled) setImg(htmlImg);
    };
    htmlImg.onerror = () => {
      if (!cancelled) setImg(null);
    };
    htmlImg.src = shape.src;
    return () => {
      cancelled = true;
    };
  }, [shape.src]);
  // Loading placeholder / skeleton while the dropped file decodes:
  // dashed rounded rect at the drop point (non-blocking, selectable).
  if (!img) {
    if (shape.loading || !shape.src) {
      return (
        <Group key={shape.id} {...common} x={safeX(shape.x)} y={safeX(shape.y)}>
          <Rect
            width={safeSize(shape.width)}
            height={safeSize(shape.height)}
            fill="rgba(241, 245, 249, 0.6)"
            stroke="#94a3b8"
            strokeWidth={1.5}
            dash={[8, 5]}
            cornerRadius={8}
            listening={false}
          />
          <Text
            x={0}
            y={safeSize(shape.height) / 2 - 10}
            width={safeSize(shape.width)}
            align="center"
            text="Loading…"
            fontSize={14}
            fontFamily="sans-serif"
            fill="#64748b"
            listening={false}
          />
        </Group>
      );
    }
    return null;
  }
  return (
    <KonvaImage
      key={shape.id}
      {...common}
      image={img}
      x={safeX(shape.x)}
      y={safeX(shape.y)}
      width={safeSize(shape.width)}
      height={safeSize(shape.height)}
    />
  );
}

/**
 * FrameShape — slide-container Group: dashed bounds + title label pinned
 * above the top-left edge. The Group owns drag/transform (registered under
 * shape.id); children are sibling shapes moved by translation delta.
 */
function FrameShape({ shape, common }) {
  const w = safeSize(shape.width);
  const h = safeSize(shape.height);
  return (
    <Group key={shape.id} {...common} x={safeX(shape.x)} y={safeX(shape.y)}>
      <Rect
        width={w}
        height={h}
        fill={shape.fill ?? 'rgba(241, 245, 249, 0.35)'}
        stroke={shape.stroke ?? '#94a3b8'}
        strokeWidth={isFiniteNum(shape.strokeWidth) ? shape.strokeWidth : 2}
        dash={shape.dash ?? [6, 6]}
        cornerRadius={6}
        listening
      />
      <Text
        x={8}
        y={-24}
        text={shape.title ?? 'Frame'}
        fontSize={14}
        fontFamily="sans-serif"
        fontStyle="600"
        fill="#64748b"
        listening={false}
      />
    </Group>
  );
}

/**
 * GroupShape — composite group: Konva Group owns drag/transform under the
 * group id; children render statically (listening=false) relative to the
 * group origin. Children carry positions relative to (group.x, group.y).
 */
function GroupShape({ shape, common }) {
  const kids = Array.isArray(shape.children) ? shape.children : [];
  return (
    <Group key={shape.id} {...common} x={safeX(shape.x)} y={safeX(shape.y)}>
      {kids.map((k, idx) => {
        if (!k || typeof k !== 'object') return null;
        const kDash = k.dash ?? dashForStyle(k.strokeStyle, k.strokeWidth);
        const kOpacity = konvaOpacity(k.opacity);
        const kSw = isFiniteNum(k.strokeWidth) ? k.strokeWidth : DEFAULTS.strokeWidth;
        const key = k.id ?? `group-child-${idx}`;
        if (k.type === 'rectangle') {
          return (
            <Rect
              key={key}
              x={safeX(k.x)}
              y={safeX(k.y)}
              width={safeSize(k.width)}
              height={safeSize(k.height)}
              stroke={k.stroke}
              strokeWidth={kSw}
              dash={kDash}
              fill={k.fill ?? 'transparent'}
              opacity={kOpacity}
              listening={false}
              cornerRadius={k.roundness === 'round' ? 8 : 2}
            />
          );
        }
        if (k.type === 'circle') {
          const { rx, ry } = circleRadii(k);
          return (
            <Circle
              key={key}
              x={safeX(k.x)}
              y={safeX(k.y)}
              radius={Math.max(0.1, Math.max(rx, ry))}
              stroke={k.stroke}
              strokeWidth={kSw}
              dash={kDash}
              fill={k.fill ?? 'transparent'}
              opacity={kOpacity}
              listening={false}
            />
          );
        }
        if (k.type === 'diamond') {
          const w = safeSize(k.width);
          const h = safeSize(k.height);
          return (
            <Line
              key={key}
              x={safeX(k.x)}
              y={safeX(k.y)}
              points={diamondPoints(0, 0, w, h)}
              stroke={k.stroke}
              strokeWidth={kSw}
              dash={kDash}
              fill={k.fill ?? 'transparent'}
              closed
              opacity={kOpacity}
              listening={false}
            />
          );
        }
        if (k.type === 'freehand' || k.type === 'pen' || k.type === 'line' || k.type === 'arrow') {
          const clean = sanitizePoints(k.points);
          if (clean.length < 4) return null;
          return (
            <Line
              key={key}
              x={0}
              y={0}
              points={clean}
              stroke={k.stroke}
              strokeWidth={kSw}
              dash={kDash}
              lineCap="round"
              lineJoin="round"
              opacity={kOpacity}
              listening={false}
            />
          );
        }
        if (k.type === 'text') {
          return (
            <Text
              key={key}
              x={safeX(k.x)}
              y={safeX(k.y)}
              text={k.text}
              fontSize={isFiniteNum(k.fontSize) ? k.fontSize : DEFAULTS.fontSize}
              fontFamily={resolveFontFamily(k.fontFamily)}
              fill={k.fill ?? '#1e1e1e'}
              opacity={kOpacity}
              listening={false}
            />
          );
        }
        if (k.type === 'image') {
          return null;
        }
        return null;
      })}
    </Group>
  );
}

/**
 * ShapeRenderer — Sayon (Whiteboard / Konva.js Engineer)
 * Excalidraw-styled renderer: violet selection accents live on the
 * Transformer (see CanvasStage); here we honor the extended schema:
 * `strokeStyle` (solid/dashed/dotted -> dash or explicit `dash`),
 * `opacity` (0-1 canonical; 0-100 slider values normalized via
 * konvaOpacity), `fill`, `roundness` (sharp/round ->
 * cornerRadius/lineJoin), `roughness` (stored for Excalidraw parity;
 * Konva renders clean vectors), arrowheads (`startArrowhead`/
 * `endArrowhead` -> Konva `pointerAtBeginning`/`pointerAtEnding`),
 * arrow path shape (`arrowType` straight/curved/elbow -> display points +
 * `tension`), and text `align`/`fontFamily`/`fontSize` (`fill` mapped
 * from the stroke/text color).
 * Back-compat: legacy `{ type: 'line', points: [...] }` with more than
 * 4 points is rendered as a tensioned freehand stroke.
 *
 * Nested-drag isolation: every handler sets `e.cancelBubble = true` so
 * pointer/drag events on an inner shape never reach an enclosing
 * rectangle; transparent fills disable fill hit-testing so interior
 * clicks pass through to nested shapes.
 *
 * ShapeNode (below) is the memoized per-shape renderer. Its bail-out
 * compare keys on shape object IDENTITY (commit paths preserve untouched
 * shape refs) plus the selection/tool flags that genuinely alter
 * rendering. Handler props are stable useCallbacks from the hook, so
 * high-frequency preview traffic (which only swaps the preview/draft
 * objects) reconciles the tiny overlay list while every committed node
 * below skips re-render entirely — no full-tree reconciliation per tick,
 * no Konva invalidation storm.
 */
const ShapeNode = React.memo(
  function ShapeNode({
    shape,
    selectedId,
    textMode,
    selectMode,
    shapeNodesRef,
    onShapeClick,
    onSelect,
    onDragEnd,
    onDragStart,
    onDragMove,
    onTransformEnd,
    onTextDoubleClick,
  }) {
    const setNodeRef = useMemo(() => {
      if (!shapeNodesRef || shape.remotePreview) return undefined;
      const shapeId = shape.id;
      return (node) => {
        if (node) shapeNodesRef.current.set(shapeId, node);
        else shapeNodesRef.current.delete(shapeId);
      };
    }, [shapeNodesRef, shape.id, shape.remotePreview]);

    // NOTE (React 19): `key` must be passed directly as a JSX prop.
    // It is intentionally NOT part of this spread object.
    // `id` IS spread: Konva needs it for findOne(`#id`) lookups
    // (transformer attach/teardown fallback in CanvasStage).
    const dash = shape.dash ?? dashForStyle(shape.strokeStyle, shape.strokeWidth);
    // Transparent / empty fills on closed shapes must NOT intercept clicks
    // in their interior: with fill hit-testing disabled, only the stroke
    // border is clickable, so clicks pass through to smaller nested shapes
    // inside the bounding box. Non-transparent fills keep normal hit area.
    const isTransparentFill =
      shape.fill === undefined ||
      shape.fill === null ||
      shape.fill === '' ||
      shape.fill === 'transparent';
    // NaN-safe stroke width: Konva warns on non-finite attrs.
    const safeStrokeWidth = isFiniteNum(shape.strokeWidth)
      ? shape.strokeWidth
      : DEFAULTS.strokeWidth;
    const common = {
      id: shape.id,
      // Remote in-progress stroke previews render only: never register
      // their nodes (keeps the Transformer and drag ownership local-only).
      ref: setNodeRef,
      // All shapes are draggable in select mode so a press-and-drag on an
      // unselected nested shape starts moving it in the SAME gesture
      // (previously only the already-selected shape was draggable, so the
      // outer rectangle won the drag). Ownership is resolved in
      // onDragStart via e.target + cancelBubble.
      // Remote previews are display-only: not draggable, not listening,
      // so local gestures pass through them to the Stage/shapes beneath.
      draggable: shape.remotePreview ? false : selectMode,
      listening: shape.remotePreview ? false : !textMode,
      rotation: isFiniteNum(shape.rotation) ? shape.rotation : 0,
      opacity: konvaOpacity(shape.opacity),
      onPointerDown: (e) => {
        // Selection gestures only: while a creation tool (pen/rect/...)
        // is active the event must bubble to the Stage so a draw gesture
        // starting on top of an existing shape still begins a draft.
        if (!selectMode) return;
        e.cancelBubble = true;
        if (shape.id !== selectedId) onSelect?.(shape.id);
        onShapeClick?.(e, shape.id);
      },
      onMouseDown: (e) => {
        if (!selectMode) return;
        e.cancelBubble = true;
        if (shape.id !== selectedId) onSelect?.(shape.id);
      },
      onClick: (e) => {
        e.cancelBubble = true;
        onShapeClick?.(e, shape.id);
      },
      onTap: (e) => {
        e.cancelBubble = true;
        onShapeClick?.(e, shape.id);
      },
      onDragStart: (e) => {
        // Only the node the pointer actually grabbed owns the drag —
        // stop bubbling so an enclosing rectangle underneath never moves.
        e.cancelBubble = true;
        if (e.target !== e.currentTarget) e.cancelBubble = true;
        if (shape.id !== selectedId) onSelect?.(shape.id);
        onDragStart?.(shape.id, e);
      },
      onDragMove: (e) => {
        // Prevent stage panning / parent containers from hijacking the
        // shape translation mid-gesture.
        e.cancelBubble = true;
        const node = e.target;
        if (node && typeof node.x === 'function') {
          onDragMove?.(shape.id, node.x(), node.y(), e);
        }
      },
      onDragEnd: (e) => {
        // Read the exact absolute position directly from the dragged node
        // and commit ONLY the new position. NEVER add deltas or offsets
        // to shape.x/shape.y here — Konva already moved the node, and
        // re-adding would double the displacement (teleport bug).
        e.cancelBubble = true;
        const node = e.target;
        const newX = node.x();
        const newY = node.y();
        onDragEnd?.(shape.id, newX, newY);
      },
      onTransformEnd: () => onTransformEnd?.(shape.id),
    };

    // Legacy freehand blobs stored as type 'line' with long points arrays.
    // 'pen' is an alias of 'freehand' (legacy callers).
    // Coordinate convention: points are ABSOLUTE world coordinates, so the
    // node is ALWAYS pinned at (0, 0) — even if a stale shape.x/shape.y
    // lingers in the store. Reading shape.x here would double-apply the
    // origin and teleport the stroke; drag offsets are baked into a fresh
    // points array on drag end instead (see bakeDragEnd).
    if (shape.type === 'freehand' || shape.type === 'pen' || (shape.type === 'line' && shape.points?.length > 4)) {
      const clean = sanitizePoints(shape.points);
      if (clean.length < 2) return null;
      if (clean.length < 4) {
        // Single-point stroke (exactly one [x, y] pair): a <Line /> paints
        // nothing for a zero-length path, so the very first in-flight
        // remote preview (seed point only) would be invisible until the
        // second point lands. Render a round dot at the tip instead, sized
        // to the stroke width, so remote clients see the stroke from its
        // first flushed point. `common` already carries the preview's
        // non-interactive flags when remote.
        const dotR = Math.max(1, safeStrokeWidth / 2);
        return (
          <Circle
            key={shape.id}
            {...common}
            x={safeCoord(clean[0])}
            y={safeCoord(clean[1])}
            radius={dotR}
            fill={shape.stroke ?? '#1e1e1e'}
            strokeEnabled={false}
            hitStrokeWidth={0}
          />
        );
      }
      return (
        <Line
          key={shape.id}
          {...common}
          x={0}
          y={0}
          points={clean}
          stroke={shape.stroke}
          strokeWidth={safeStrokeWidth}
          dash={dash}
          lineCap="round"
          lineJoin="round"
          tension={0.5}
          shadowForStrokeEnabled={false}
          // Wide stroke hit area so thin pen strokes select on single click.
          hitStrokeWidth={Math.max(12, safeStrokeWidth + 8)}
        />
      );
    }

    if (shape.type === 'rectangle') {
      const round = shape.roundness === 'round';
      const safeWidth = safeSize(shape.width);
      const safeHeight = safeSize(shape.height);
      return (
        <Rect
          key={shape.id}
          {...common}
          x={safeX(shape.x)}
          y={safeX(shape.y)}
          width={safeWidth}
          height={safeHeight}
          stroke={shape.stroke}
          strokeWidth={safeStrokeWidth}
          dash={dash}
          fill={shape.fill ?? 'transparent'}
          fillEnabled={!isTransparentFill}
          // Wide stroke hit area keeps the (transparent-interior) border
          // easy to grab; interior clicks pass through to nested shapes.
          hitStrokeWidth={Math.max(12, safeStrokeWidth + 8)}
          cornerRadius={
            round
              ? Math.max(2, Math.min(16, Math.min(safeWidth, safeHeight) / 4))
              : 2
          }
        />
      );
    }

    if (shape.type === 'diamond') {
      const round = shape.roundness === 'round';
      const safeWidth = safeSize(shape.width);
      const safeHeight = safeSize(shape.height);
      const dx = safeX(shape.x);
      const dy = safeX(shape.y);
      // Points are relative to origin (0, 0) — the node position (dx, dy)
      // owns the world placement. Drag commits ONLY x/y and never mutates
      // this array, so there is no double transform on drag end.
      const points = round
        ? roundedDiamondPoints(0, 0, safeWidth, safeHeight, diamondCornerRadius(safeWidth, safeHeight))
        : diamondPoints(0, 0, safeWidth, safeHeight);
      return (
        <Line
          key={shape.id}
          {...common}
          x={dx}
          y={dy}
          points={points}
          stroke={shape.stroke}
          strokeWidth={safeStrokeWidth}
          dash={dash}
          fill={shape.fill ?? 'transparent'}
          fillEnabled={!isTransparentFill}
          closed
          lineJoin={round ? 'round' : 'miter'}
          lineCap="round"
          // Stroke hit area for transparent interiors; fill hit-testing
          // off so clicks inside the diamond reach nested shapes.
          hitStrokeWidth={Math.max(12, safeStrokeWidth + 8)}
        />
      );
    }

    if (shape.type === 'circle') {
      // Ellipse-aware: non-uniform radiusX/radiusY (from side-handle
      // scaling) render as <Ellipse/>; uniform radii stay <Circle/> so
      // legacy docs and node lookups keep working.
      const { rx, ry } = circleRadii(shape);
      const isEllipse = Math.abs(rx - ry) / Math.max(rx, ry, 1e-9) >= 0.02;
      if (isEllipse) {
        return (
          <Ellipse
            key={shape.id}
            {...common}
            x={safeX(shape.x)}
            y={safeX(shape.y)}
            radiusX={Math.max(0.1, rx)}
            radiusY={Math.max(0.1, ry)}
            stroke={shape.stroke}
            strokeWidth={safeStrokeWidth}
            dash={dash}
            fill={shape.fill ?? 'transparent'}
            fillEnabled={!isTransparentFill}
            hitStrokeWidth={Math.max(12, safeStrokeWidth + 8)}
          />
        );
      }
      return (
        <Circle
          key={shape.id}
          {...common}
          x={safeX(shape.x)}
          y={safeX(shape.y)}
          radius={Math.max(0.1, Math.max(rx, ry))}
          stroke={shape.stroke}
          strokeWidth={safeStrokeWidth}
          dash={dash}
          fill={shape.fill ?? 'transparent'}
          fillEnabled={!isTransparentFill}
          hitStrokeWidth={Math.max(12, safeStrokeWidth + 8)}
        />
      );
    }

    if (shape.type === 'line') {
      const startHead = shape.startArrowhead ?? 'none';
      const endHead = shape.endArrowhead ?? 'none';
      const clean = sanitizePoints(shape.points);
      if (clean.length < 4) return null;
      // Excalidraw parity: lines can carry arrowheads; render with the
      // Arrow node whenever either end is active so heads are visible.
      if (startHead !== 'none' || endHead !== 'none') {
        return (
          <Arrow
            key={shape.id}
            {...common}
            // Absolute points convention (see freehand branch): pin at origin.
            x={0}
            y={0}
            points={clean}
            stroke={shape.stroke}
            fill={shape.stroke}
            strokeWidth={safeStrokeWidth}
            dash={dash}
            lineCap="round"
            lineJoin="round"
            // Stored tension wins (sidebar curvature); otherwise sharp.
            tension={isFiniteNum(shape.tension) ? shape.tension : 0}
            pointerAtBeginning={startHead !== 'none'}
            pointerAtEnding={endHead !== 'none'}
            pointerLength={startHead === 'dot' || endHead === 'dot' ? 6 : 12}
            pointerWidth={startHead === 'dot' || endHead === 'dot' ? 6 : 10}
            hitStrokeWidth={Math.max(12, safeStrokeWidth + 8)}
          />
        );
      }
      return (
        <Line
          key={shape.id}
          {...common}
          // Absolute points convention (see freehand branch): pin at origin.
          x={0}
          y={0}
          points={clean}
          stroke={shape.stroke}
          strokeWidth={safeStrokeWidth}
          dash={dash}
          lineCap="round"
          // Stored tension wins (bend-handle curves); plain lines stay sharp.
          tension={isFiniteNum(shape.tension) ? shape.tension : 0}
          hitStrokeWidth={Math.max(12, safeStrokeWidth + 8)}
        />
      );
    }

    if (shape.type === 'arrow') {
      const startHead = shape.startArrowhead ?? 'none';
      const endHead = shape.endArrowhead ?? 'arrow';
      const arrowType = shape.arrowType ?? 'straight';
      const displayPoints = sanitizePoints(displayPointsForArrow(shape));
      if (displayPoints.length < 4) return null;
      return (
        <Arrow
          key={shape.id}
          {...common}
          // Absolute points convention (see freehand branch): pin at origin.
          x={0}
          y={0}
          points={displayPoints}
          stroke={shape.stroke}
          fill={shape.fill ?? shape.stroke}
          strokeWidth={safeStrokeWidth}
          dash={dash}
          lineCap="round"
          lineJoin="round"
          // Path shape -> Konva geometry: straight = sharp vector
          // (tension 0), curved = smooth Bezier (tension 0.35), elbow =
          // orthogonal right-angle (tension 0 + orthogonal points).
          // Stored tension (sidebar curvature) wins; otherwise derive from
          // arrowType so bent arrows keep a slight curve. The 6-coordinate
          // [startX, startY, midX, midY, endX, endY] array passes cleanly
          // to the Konva node in both cases.
          tension={
            isFiniteNum(shape.tension)
              ? shape.tension
              : tensionForArrowType(arrowType, displayPoints.length)
          }
          pointerAtBeginning={startHead !== 'none'}
          pointerAtEnding={endHead !== 'none'}
          pointerLength={startHead === 'dot' || endHead === 'dot' ? 6 : 12}
          pointerWidth={startHead === 'dot' || endHead === 'dot' ? 6 : 10}
          hitStrokeWidth={Math.max(12, safeStrokeWidth + 8)}
        />
      );
    }

    if (shape.type === 'text') {
      // `fontFamily` is the canonical CSS string; resolve legacy picker
      // keys (hand/normal/code/serif) and legacy stacks for back-compat.
      const rawFont = shape.fontFamily ?? DEFAULTS.fontFamily;
      const resolvedFont = resolveFontFamily(rawFont);
      const safeFontSize = isFiniteNum(shape.fontSize)
        ? Math.max(1, shape.fontSize)
        : DEFAULTS.fontSize;
      // Konva needs an explicit width for align (left/center/right) to
      // position multi-line runs: without it the node shrink-wraps each
      // line and alignment is imperceptible. Prefer the stored
      // alignment-box width; estimate deterministically for legacy shapes.
      const alignWidth =
        isFiniteNum(shape.width) && shape.width >= 1
          ? shape.width
          : estimateTextWidth(shape.text, safeFontSize);
      return (
        <Text
          key={shape.id}
          {...common}
          x={safeX(shape.x)}
          y={safeX(shape.y)}
          text={shape.text}
          fontSize={safeFontSize}
          fontFamily={resolvedFont}
          align={shape.align ?? shape.textAlign ?? 'left'}
          width={alignWidth}
          fontStyle="500"
          fill={shape.fill ?? shape.stroke ?? '#1e1e1e'}
          // Remote live-typing ghosts are display-only: double-click must
          // never open the local text editor for a peer's in-flight text.
          onDblClick={() => {
            if (!shape.remotePreview) onTextDoubleClick?.(shape);
          }}
          onDblTap={() => {
            if (!shape.remotePreview) onTextDoubleClick?.(shape);
          }}
        />
      );
    }

    if (shape.type === 'image') {
      return <ImageShape key={shape.id} shape={shape} common={common} />;
    }

    if (shape.type === 'frame') {
      return <FrameShape key={shape.id} shape={shape} common={common} />;
    }

    if (shape.type === 'group') {
      return <GroupShape key={shape.id} shape={shape} common={common} />;
    }

    return null;
  },
  (prev, next) =>
    prev.shape === next.shape &&
    prev.selectedId === next.selectedId &&
    prev.textMode === next.textMode &&
    prev.selectMode === next.selectMode &&
    prev.shapeNodesRef === next.shapeNodesRef &&
    prev.onShapeClick === next.onShapeClick &&
    prev.onSelect === next.onSelect &&
    prev.onDragEnd === next.onDragEnd &&
    prev.onDragStart === next.onDragStart &&
    prev.onDragMove === next.onDragMove &&
    prev.onTransformEnd === next.onTransformEnd &&
    prev.onTextDoubleClick === next.onTextDoubleClick,
);


export default function ShapeRenderer({
  shapes,
  selectedId,
  tool,
  shapeNodesRef,
  onShapeClick,
  onSelect,
  onDragEnd,
  onDragStart,
  onDragMove,
  onTransformEnd,
  onTextDoubleClick,
}) {
  // Text-tool priority: while the text tool is active, existing shapes
  // neither intercept clicks (listening off → events reach the Stage,
  // which spawns the text overlay) nor initiate drags.
  // In select/selection mode ALL shapes are draggable so a press-and-drag
  // on any nested shape grabs that exact node (drag ownership is resolved
  // synchronously in onDragStart via e.target + cancelBubble).
  // Eraser mode keeps shapes listening so clicks can delete.
  const textMode = tool === 'text';
  // 'selection' is accepted as an alias of 'select' (spec + legacy callers).
  const selectMode = tool === 'select' || tool === 'selection';

  return shapes.map((shape) => (
    <ShapeNode
      key={shape.id}
      shape={shape}
      selectedId={selectedId}
      textMode={textMode}
      selectMode={selectMode}
      shapeNodesRef={shapeNodesRef}
      onShapeClick={onShapeClick}
      onSelect={onSelect}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onTransformEnd={onTransformEnd}
      onTextDoubleClick={onTextDoubleClick}
    />
  ));
}