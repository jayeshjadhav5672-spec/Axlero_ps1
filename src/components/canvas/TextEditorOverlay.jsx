import React, { useEffect, useRef, useState } from 'react';

/**
 * TextEditorOverlay — Sayon
 * Excalidraw-styled HTML textarea overlay for text shapes. Positioned in
 * SCREEN coords (converted from world coords by the hook so zoom/pan stay
 * correct). Hand-drawn typography (Caveat/Virgil stack), violet focus ring.
 * Commit: Enter (no Shift) or blur. Cancel: Escape.
 */
export default function TextEditorOverlay({ editor, color, onCommit, onCancel, onChange }) {
  const [value, setValue] = useState(editor?.value ?? '');
  const areaRef = useRef(null);
  // Mount guard: an instantaneous blur (within 150ms of the overlay
  // appearing) comes from the canvas click gesture that opened it, not
  // from the user leaving the field — ignore it and keep focus.
  const isMountedRef = useRef(false);

  useEffect(() => {
    setValue(editor?.value ?? '');
  }, [editor]);

  useEffect(() => {
    if (editor) {
      areaRef.current?.focus();
      areaRef.current?.select?.();
    }
  }, [editor]);

  useEffect(() => {
    // Reset per editing session (the component itself stays mounted and
    // merely toggles between null/active editors): a fresh 150ms window
    // guards every new placement, not just the first one.
    isMountedRef.current = false;
    const timer = setTimeout(() => {
      isMountedRef.current = true;
    }, 150);
    return () => clearTimeout(timer);
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

  const handleBlur = (event) => {
    // Ignore blur if it fires immediately upon mounting from the canvas
    // click — reclaim focus instead of closing the overlay.
    if (!isMountedRef.current) {
      areaRef.current?.focus();
      return;
    }
    // Only commit on blur if the user typed something; an empty blur
    // cancels instead of committing an empty payload.
    const v = event.currentTarget.value;
    if (v.trim()) onCommit?.(v, areaRef.current?.scrollWidth);
    else onCancel?.();
  };

  // Mirror the shape's alignment while typing so the overlay previews
  // exactly what the canvas will render.
  const overlayAlign = editor.align ?? editor.textAlign ?? 'left';

  return (
    <textarea
      ref={areaRef}
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        // Live typing stream: the shell throttles + broadcasts a text
        // preview so room peers see keystrokes before commit.
        onChange?.(e.target.value);
      }}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
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
