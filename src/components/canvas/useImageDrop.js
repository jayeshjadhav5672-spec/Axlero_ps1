import { useCallback, useEffect } from 'react';
import { createImageShape, createShapeId, isFiniteNum } from './utils/shapes.js';

/**
 * useImageDrop.js — Sayon (Week 2: Media & Assets)
 *
 * Cross-platform image ingestion with zero Socket.io/Yjs deps:
 * - `paste` on window (Cmd+V macOS, Ctrl+V Windows/Linux): extracts image
 *   blobs from `e.clipboardData.items`, reads them as base64 data URLs.
 * - `dragover`/`drop` on the stage container: accepts `e.dataTransfer.files`.
 * - `importFiles(fileList)` shared entry for the toolbar file picker.
 *
 * Accepted image MIME types: image/png, image/jpeg, image/svg+xml,
 * image/webp (plus extension fallback for extension-only file lists).
 *
 * Coordinates resolve through the live Konva stage into canvas world
 * coords taking pan and zoom into account:
 *   const transform = stage.getAbsoluteTransform().copy().invert();
 *   const stageCoords = transform.point({ x: event.clientX, y: event.clientY });
 * Commits flow through `onImageCreate(shape)` (wired to `commitCreate`)
 * with placeholder-first ingestion: a loading skeleton shape is inserted
 * instantly at the drop point, then replaced with the final `type: 'image'`
 * shape via `onImageUpdate(id, changes)` once natural dimensions are known
 * (scaled to fit 800x800 preserving aspect ratio).
 */

export const ACCEPTED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
export const IMAGE_MAX_SIDE = 800;

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

/**
 * Downscale an oversized raster to a `maxSide` bounding box BEFORE it
 * enters shape state. The renderer already displays images capped at
 * 640px, so storing full-resolution bitmaps would only bloat state,
 * serialization, and future Yjs/Mongo payloads (the realtime transport
 * caps messages at 256KB) with pixels nobody ever sees. Returns the
 * downscaled data URL, or null when no downscale applies (already small,
 * SVG vector which scales freely, or any failure — caller keeps the
 * original). PNG output preserves transparency.
 */
function downscaleDataURL(dataUrl, mime, maxSide = 800) {
  return new Promise((resolve) => {
    try {
      if (typeof mime === 'string' && mime.includes('svg')) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.naturalWidth || 0;
          const h = img.naturalHeight || 0;
          if (!w || !h) {
            resolve(null);
            return;
          }
          const s = Math.min(1, maxSide / Math.max(w, h));
          if (s >= 1) {
            resolve(null);
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(w * s));
          canvas.height = Math.max(1, Math.round(h * s));
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    } catch {
      resolve(null);
    }
  });
}

function isImageFile(file) {
  if (!file) return false;
  const mime = (file.type ?? '').toLowerCase();
  if (ACCEPTED_IMAGE_MIMES.includes(mime)) return true;
  // Extension fallback (some drop sources omit MIME types) + legacy
  // acceptance for other common rasters carried over from Week 2.
  if (mime.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name ?? '');
}

/**
 * Project a native screen (clientX/clientY) point into canvas world coords,
 * taking pan and zoom into account via the inverse absolute transform.
 */
export function projectToStageCoords(stage, container, clientX, clientY) {
  try {
    const transform = stage?.getAbsoluteTransform?.()?.copy?.()?.invert?.();
    if (transform && typeof transform.point === 'function' && container) {
      const rect = container.getBoundingClientRect();
      return transform.point({ x: clientX - rect.left, y: clientY - rect.top });
    }
  } catch {
    // fall through to pointer-position fallback
  }
  try {
    const world = stage?.getRelativePointerPosition?.() ?? null;
    if (world && isFiniteNum(world.x) && isFiniteNum(world.y)) return world;
  } catch {
    // ignore
  }
  return null;
}

/** Instant loading placeholder inserted at the drop point (skeleton). */
function createPlaceholderShape(x, y) {
  return {
    id: createShapeId('shape'),
    type: 'image',
    src: null,
    x: isFiniteNum(x) ? x - 80 : 0,
    y: isFiniteNum(y) ? y - 60 : 0,
    width: 160,
    height: 120,
    rotation: 0,
    loading: true,
  };
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

export default function useImageDrop({ stageRef, containerRef, onImageCreate, onImageUpdate, onImageDelete } = {}) {
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
        const at = { x: anchor.x + i * 24, y: anchor.y + i * 24 };
        // Instant placeholder with loading skeleton at the drop point so
        // the user sees feedback before the file finishes decoding.
        let placeholderId = null;
        try {
          const placeholder = createPlaceholderShape(at.x, at.y);
          placeholderId = placeholder.id;
          onImageCreate?.(placeholder);
        } catch {
          placeholderId = null;
        }
        try {
          const dataUrl = await readFileAsDataURL(files[i]);
          if (typeof dataUrl !== 'string') {
            if (placeholderId) onImageDelete?.(placeholderId);
            continue;
          }
          // Store the display-capped bitmap, not the full-resolution
          // original (see downscaleDataURL). Falls back to the original
          // whenever downscaling does not apply.
          const storedUrl = (await downscaleDataURL(dataUrl, files[i]?.type, IMAGE_MAX_SIDE)) ?? dataUrl;
          if (typeof storedUrl !== 'string') {
            if (placeholderId) onImageDelete?.(placeholderId);
            continue;
          }
          const { width, height } = await measureDataURL(storedUrl);
          // Cap absurd dimensions to a max 800px side, keep aspect ratio.
          const maxSide = IMAGE_MAX_SIDE;
          const scaleDown = Math.min(1, maxSide / Math.max(width, height));
          const w = Math.round(width * scaleDown);
          const h = Math.round(height * scaleDown);
          const shape = createImageShape(storedUrl, {
            x: at.x - w / 2,
            y: at.y - h / 2,
            width: w,
            height: h,
          });
          if (!shape) {
            if (placeholderId) onImageDelete?.(placeholderId);
            continue;
          }
          if (placeholderId && onImageUpdate) {
            // Replace the placeholder in place (keeps z-order + selection).
            const { id, ...changes } = shape;
            void id;
            onImageUpdate(placeholderId, { ...changes, loading: false });
            // Re-key selection to the placeholder id (already selected).
          } else {
            if (placeholderId) onImageDelete?.(placeholderId);
            onImageCreate?.(shape);
          }
          created += 1;
        } catch {
          // Skip unreadable files; keep importing the rest.
          if (placeholderId) {
            try {
              onImageDelete?.(placeholderId);
            } catch {
              // ignore
            }
          }
        }
      }
      return created;
    },
    [onImageCreate, onImageDelete, onImageUpdate, stageRef],
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
      // Stage coordinate projection: screen -> world via the inverse
      // absolute transform so pan/zoom never offset the drop point.
      let world = null;
      try {
        const stage = stageRef?.current;
        const container = containerRef?.current;
        world = projectToStageCoords(stage, container, e.clientX, e.clientY);
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
