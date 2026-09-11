import React, { useEffect, useRef, useState } from 'react';

/**
 * TextEditorOverlay — Sayon
 * Excalidraw-styled HTML textarea overlay for text shapes. Positioned in
 * SCREEN coords (converted from world coords by the hook so zoom/pan stay
 * correct). Hand-drawn typography (Caveat/Virgil stack), violet focus ring.
 * Commit: Enter (no Shift) or blur. Cancel: Escape.
 */
export default function TextEditorOverlay({ editor, color, onCommit, onCancel }) {
  const [value, setValue] = useState(editor?.value ?? '');
  const areaRef = useRef(null);

  useEffect(() => {
    setValue(editor?.value ?? '');
  }, [editor]);

  useEffect(() => {
    if (editor) {
      areaRef.current?.focus();
      areaRef.current?.select?.();
    }
  }, [editor]);

  if (!editor) return null;

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel?.();
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      onCommit?.(value, areaRef.current?.scrollWidth);
    }
  };

  // Mirror the shape's alignment while typing so the overlay previews
  // exactly what the canvas will render.
  const overlayAlign = editor.align ?? editor.textAlign ?? 'left';

  return (
    <textarea
      ref={areaRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit?.(value, areaRef.current?.scrollWidth)}
      onKeyDown={handleKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
      placeholder="Type text, Enter to commit"
      aria-label="Text shape editor"
      rows={2}
      style={{
        position: 'absolute',
        left: editor.screenX,
        top: editor.screenY,
        minWidth: 180,
        maxWidth: 340,
        zIndex: 20,
        padding: '6px 10px',
        fontSize: 22,
        lineHeight: 1.35,
        fontFamily: '"Caveat", "Segoe Print", "Bradley Hand", "Virgil", Inter, sans-serif',
        fontWeight: 500,
        textAlign: overlayAlign,
        color: editor.mode === 'edit' ? undefined : color,
        border: '1.5px solid #6965db',
        borderRadius: 8,
        outline: 'none',
        background: 'white',
        boxShadow: '0 4px 16px rgba(105,101,219,0.18)',
        resize: 'both',
      }}
    />
  );
}
