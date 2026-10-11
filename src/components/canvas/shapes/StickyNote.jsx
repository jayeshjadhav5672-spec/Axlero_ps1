import React, { forwardRef } from 'react';
import { Group, Rect, Text } from 'react-konva';
import { isFiniteNum, resolveFontFamily } from '../utils/shapes.js';

/** Render-time fallbacks so Konva never receives NaN attrs. */
const safeX = (v) => (isFiniteNum(v) ? v : 0);
const safeSize = (v) => (isFiniteNum(v) ? Math.max(1, v) : 1);

/**
 * StickyNote — Day 4: Dedicated Sticky Note Component (react-konva).
 *
 * Renders the canonical `type: 'sticky'` shape per the spec:
 * { id, type, x, y, width, height, fill, text, fontSize, fontFamily, rotation }
 *
 * Look: filled rounded rect with a soft drop shadow + a slightly darker
 * header strip (the folded "tape" edge), wrapped body text with ellipsis.
 * Double-click (or double-tap) opens the shared text editor overlay via
 * `onTextDoubleClick`. Drag + Transformer resize flow through the same
 * node registration (`shapeNodesRef`) as every other selectable shape, so
 * undo/redo, live sync, export, and collab need no new channels.
 */
const StickyNote = forwardRef(function StickyNote(
  {
    shape,
    draggable = false,
    listening = true,
    opacity,
    onSelect,
    onShapeClick,
    onDragEnd,
    onDragStart,
    onDragMove,
    onTransformEnd,
    onTextDoubleClick,
  },
  ref,
) {
  if (!shape || shape.type !== 'sticky') return null;
  const w = safeSize(shape.width);
  const h = safeSize(shape.height);
  const fill = typeof shape.fill === 'string' && shape.fill ? shape.fill : '#FEF08A';
  const text = typeof shape.text === 'string' ? shape.text : 'Type your note here...';
  const fontSize = isFiniteNum(shape.fontSize) ? Math.max(8, shape.fontSize) : 16;
  const fontFamily = resolveFontFamily(shape.fontFamily ?? 'Inter, sans-serif');

  return (
    <Group
      ref={ref}
      id={shape.id}
      name="shape-node"
      x={safeX(shape.x)}
      y={safeX(shape.y)}
      rotation={isFiniteNum(shape.rotation) ? shape.rotation : 0}
      opacity={opacity}
      draggable={draggable}
      listening={listening}
      onClick={onShapeClick}
      onTap={onShapeClick}
      onMouseDown={onSelect}
      onTouchStart={onSelect}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
      onDblClick={onTextDoubleClick}
      onDblTap={onTextDoubleClick}
    >
      {/* Soft drop shadow (separate rect so the fill stays flat). */}
      <Rect
        x={2}
        y={4}
        width={w}
        height={h}
        fill="#000000"
        opacity={0.12}
        cornerRadius={6}
        listening={false}
      />
      {/* Note body. */}
      <Rect
        width={w}
        height={h}
        fill={fill}
        stroke="rgba(0,0,0,0.12)"
        strokeWidth={1}
        cornerRadius={6}
        shadowBlur={0}
        listening
      />
      {/* Folded top strip — a touch darker than the body fill. */}
      <Rect
        width={w}
        height={Math.min(26, h)}
        fill="#000000"
        opacity={0.06}
        cornerRadius={[6, 6, 0, 0]}
        listening={false}
      />
      {/* Body text. */}
      <Text
        x={10}
        y={Math.min(26, h) + 8}
        width={Math.max(1, w - 20)}
        height={Math.max(1, h - Math.min(26, h) - 16)}
        text={text}
        fontSize={fontSize}
        fontFamily={fontFamily}
        fill="#1e293b"
        align={shape.align ?? shape.textAlign ?? 'left'}
        verticalAlign="top"
        wrap="word"
        ellipsis
        lineHeight={1.35}
        listening={false}
      />
    </Group>
  );
});

export default StickyNote;
