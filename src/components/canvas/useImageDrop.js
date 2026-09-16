import { useCallback, useEffect } from 'react';
import { createImageShape, isFiniteNum } from './utils/shapes.js';

/**
 * useImageDrop.js — Sayon (Week 2: Media & Assets)
 *
 * Cross-platform image ingestion with zero Socket.io/Yjs deps:
 * - `paste` on window (Cmd+V macOS, Ctrl+V Windows/Linux): extracts image
 *   blobs from `e.clipboardData.items`, reads them as base64 data URLs.
 * - `dragover`/`drop` on the stage container: accepts `e.dataTransfer.files`.
 * - `importFiles(fileList)` shared entry for the toolbar file picker.
 *
 * Coordinates resolve through the live Konva stage
 * (`getRelativePointerPosition()` for drops, viewport-center for pastes)
 * so split-pane resizing (Avantee's container) stays correct.
 * Commits flow through the single `onImageCreate(shape)` boundary —
 * callers wire it to `commitCreate`.
 */

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function measureDataURL(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 320, height: img.naturalHeight || 240 });
    img.onerror = () => resolve({ width: 320, height: 240 });
    img.src = dataUrl;
  });
}

function isImageFile(file) {
  return !!file && (file.type?.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name ?? ''));
}

/** Viewport-center in world coords (for paste: no pointer position). */
function worldCenterOfStage(stage) {
  if (!stage) return { x: 100, y: 100 };
  const scale = stage.scaleX() || 1;
  const pos = stage.position();
  return {
    x: (stage.width() / 2 - pos.x) / scale,
    y: (stage.height() / 2 - pos.y) / scale,
  };
}

export default function useImageDrop({ stageRef, containerRef, onImageCreate } = {}) {
  const importFiles = useCallback(
    async (fileList, targetWorld) => {
      const files = Array.from(fileList ?? []).filter(isImageFile);
      if (files.length === 0) return 0;
      const stage = stageRef?.current ?? null;
      let anchor = targetWorld;
      if (!anchor || !isFiniteNum(anchor.x) || !isFiniteNum(anchor.y)) {
        try {
          anchor = stage?.getRelativePointerPosition?.() ?? worldCenterOfStage(stage);
        } catch {
          anchor = worldCenterOfStage(stage);
        }
        if (!isFiniteNum(anchor?.x) || !isFiniteNum(anchor?.y)) anchor = { x: 100, y: 100 };
      }
      let created = 0;
      for (let i = 0; i < files.length; i += 1) {
        try {
          const dataUrl = await readFileAsDataURL(files[i]);
          if (typeof dataUrl !== 'string') continue;
          const { width, height } = await measureDataURL(dataUrl);
          // Cap absurd dimensions to a max 640px side, keep aspect.
          const maxSide = 640;
          const scaleDown = Math.min(1, maxSide / Math.max(width, height));
          const shape = createImageShape(dataUrl, {
            x: anchor.x + i * 24 - (width * scaleDown) / 2,
            y: anchor.y + i * 24 - (height * scaleDown) / 2,
            width: Math.round(width * scaleDown),
            height: Math.round(height * scaleDown),
          });
          if (!shape) continue;
          onImageCreate?.(shape);
          created += 1;
        } catch {
          // Skip unreadable files; keep importing the rest.
        }
      }
      return created;
    },
    [onImageCreate, stageRef],
  );

  // Cross-platform clipboard paste (Cmd+V / Ctrl+V).
  useEffect(() => {
    const onPaste = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      const imageItems = Array.from(items).filter((it) => it.type?.startsWith('image/'));
      if (imageItems.length === 0) return;
      e.preventDefault();
      const files = imageItems.map((it) => it.getAsFile()).filter(Boolean);
      importFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [importFiles]);

  // Drag & drop onto the stage container.
  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return undefined;
    const onDragOver = (e) => {
      if ([... (e.dataTransfer?.types ?? [])].includes('Files')) e.preventDefault();
    };
    const onDrop = (e) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      if (!Array.from(files).some(isImageFile)) return;
      e.preventDefault();
      let world = null;
      try {
        const stage = stageRef?.current;
        // Pointer-based world coords via the inverse absolute transform:
        // getRelativePointerPosition() already inverts scale + pan.
        world = stage?.getRelativePointerPosition?.() ?? null;
        if (!world) {
          const rect = container.getBoundingClientRect();
          const abs = stage?.getAbsoluteTransform?.()?.copy?.()?.invert?.();
          if (abs && typeof abs.point === 'function') {
            world = abs.point({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          }
        }
      } catch {
        world = null;
      }
      importFiles(files, world);
    };
    container.addEventListener('dragover', onDragOver);
    container.addEventListener('drop', onDrop);
    return () => {
      container.removeEventListener('dragover', onDragOver);
      container.removeEventListener('drop', onDrop);
    };
  }, [containerRef, importFiles, stageRef]);

  return { importFiles };
}
