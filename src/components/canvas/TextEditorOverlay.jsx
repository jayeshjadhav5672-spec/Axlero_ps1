import { useEffect, useRef, useState } from 'react';

/**
 * TextEditorOverlay — Sayon
 * HTML textarea overlay for text shapes. Positioned in SCREEN coords
 * (converted from world coords by the hook so zoom/pan stay correct).
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
      onCommit?.(value);
    }
  };

  return (
    <textarea
      ref={areaRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit?.(value)}
      onKeyDown={handleKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
      placeholder="Type text, Enter to commit"
      aria-label="Text shape editor"
      rows={2}
      style={{
        position: 'absolute',
        left: editor.screenX,
        top: editor.screenY,
        minWidth: 160,
        maxWidth: 320,
        zIndex: 20,
        padding: '6px 8px',
        fontSize: 20,
        fontFamily: 'Inter, sans-serif',
        color: editor.mode === 'edit' ? undefined : color,
        border: '1px solid #0f766e',
        borderRadius: 6,
        outline: 'none',
        background: 'white',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        resize: 'both',
      }}
    />
  );
}
