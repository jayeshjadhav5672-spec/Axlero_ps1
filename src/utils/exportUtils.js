/**
 * exportUtils.js — bulletproof direct canvas export (PNG / JPEG).
 *
 * `exportCanvasDirect` is the PRIMARY raster export: it captures the
 * whiteboard straight from the DOM (` .konvajs-content canvas`), so it
 * needs zero props and zero Konva refs — a dead `stageRef` chain or a
 * swallowed click handler can no longer kill a download. The toolbar
 * PNG/JPEG paths call it via `handleExport` in
 * `src/components/canvas/index.jsx`.
 *
 * - Solid white background is baked on an offscreen canvas (transparent
 *   pixels otherwise render as solid black in viewers without alpha
 *   support; Konva's `toDataURL` silently IGNORES any `fill` option —
 *   verified in `konva/lib/Node.js` `_toKonvaCanvas` — so white is
 *   composited explicitly here instead).
 * - Transformer handles are hidden synchronously (`stage.draw()` redraws
 *   immediately, unlike the async `batchDraw()`) before the bitmap is
 *   read, then restored.
 * - Downloads via Blob object URL (never a multi-MB base64 href) to avoid
 *   URL-truncation failures in Safari/Firefox.
 * - `exportCanvas` (ref-based, high-DPI `pixelRatio: 2` capture with the
 *   Konva-registry/DOM fallback chain) is kept for callers that already
 *   hold a live stage ref; JSON export stays on whiteboard state
 *   (`exportJSON` in `src/components/canvas/utils/exportHub.js`).
 */

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('raster decode failed'));
    img.src = dataUrl;
  });
}

/**
 * Composite a transparent PNG data URL over an opaque white base and
 * re-encode to the target mime type. Output keeps the full capture
 * resolution (pixelRatio already baked into the source bitmap).
 */
async function flattenDataUrlOverWhite(pngDataUrl, mimeType) {
  const img = await loadImage(pngDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL(mimeType, 0.92);
}

/**
 * Hide the Transformer on every reachable stage SYNCHRONOUSLY and return
 * a restore callback. `stage.draw()` (not `batchDraw()`) is used so the
 * bitmap is repainted before the caller reads pixels in the same frame.
 */
function hideTransformersSync() {
  const stages = [];
  if (window.Konva && window.Konva.stages?.length > 0) stages.push(...window.Konva.stages);
  if (window.__syncspaceStages?.length > 0) {
    for (const s of window.__syncspaceStages) {
      if (s && !stages.includes(s)) stages.push(s);
    }
  }
  const hidden = [];
  for (const stage of stages) {
    try {
      const tr = stage.findOne?.('Transformer');
      if (tr && tr.visible?.()) {
        tr.visible(false);
        hidden.push(tr);
      }
      stage.draw?.();
    } catch {
      // best-effort: a detached stage must never block the download
    }
  }
  return () => {
    for (const tr of hidden) {
      try {
        tr.visible(true);
      } catch {
        // ignore
      }
    }
    for (const stage of stages) {
      try {
        stage.draw?.();
      } catch {
        // ignore
      }
    }
  };
}

export const exportCanvasDirect = (format = 'png', fileName = 'syncspace-whiteboard') => {
  // 1. Locate the Konva canvas directly from the DOM
  const canvas = document.querySelector('.konvajs-content canvas') || document.querySelector('canvas');
  if (!canvas) {
    console.error('[Export Error] No canvas found in the document.');
    alert('Canvas element not found. Please ensure the whiteboard is loaded.');
    return;
  }

  // 2. Hide any active selection / transformer handles synchronously so
  // they never bake into the bitmap. Covers both the global Konva
  // registry and the whiteboard's own registry (ESM-bundled Konva never
  // populates `window.Konva`, so `CanvasStage` publishes its live stage
  // to `window.__syncspaceStages` on mount).
  const restoreTransformers = hideTransformersSync();

  try {
    // 3. Create an off-screen canvas to bake a solid white background (prevents black image bug)
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const ctx = exportCanvas.getContext('2d');

    // Paint solid white
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // Composite the whiteboard drawing over the white fill
    ctx.drawImage(canvas, 0, 0);

    // 4. Determine MIME type
    const isJpeg = format === 'jpeg' || format === 'jpg';
    const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
    const dataUrl = exportCanvas.toDataURL(mimeType, 0.95);

    if (!dataUrl || dataUrl === 'data:,') {
      throw new Error('Canvas produced an empty image. Check for tainted (CORS-blocked) pixels.');
    }

    // 5. Convert to Blob and trigger download
    const byteString = atob(dataUrl.split(',')[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.download = `${fileName}.${isJpeg ? 'jpg' : format}`;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (err) {
    console.error('[Export Error] Failed during canvas compilation:', err);
    alert('Export failed: ' + err.message);
  } finally {
    restoreTransformers();
  }
};

export const exportCanvas = async (stageRef, format = 'png', fileName = 'syncspace-whiteboard') => {
  // 1. Resolve Stage (with DOM fallback)
  let stage = stageRef?.current;

  // Accept a raw stage instance too (callers that already unwrapped the ref).
  if (!stage && stageRef && typeof stageRef.getLayers === 'function') {
    stage = stageRef;
  }

  // Fallback: If ref is missing/disconnected, grab the first registered Konva Stage instance
  if (!stage && window.Konva && window.Konva.stages?.length > 0) {
    stage = window.Konva.stages[0];
  }

  // Second fallback: the whiteboard's own registry. The ESM-bundled Konva
  // never populates `window.Konva`, so `CanvasStage` publishes its live
  // stage here on mount (see `CanvasStage.jsx`).
  if (!stage && window.__syncspaceStages?.length > 0) {
    stage = window.__syncspaceStages[window.__syncspaceStages.length - 1];
  }

  // Direct DOM Canvas fallback if Konva stage instance is detached
  const konvaCanvas = document.querySelector('.konvajs-content canvas') || document.querySelector('canvas');
  if (!stage && !konvaCanvas) {
    console.error('[Export Error] No canvas element or Konva stage detected.');
    alert('Export error: Canvas stage is not ready.');
    return;
  }
  if (format === 'json') {
    // Direct JSON export of shape data
    console.warn('Use exportJSON from whiteboard state for JSON format.');
    return;
  }

  const mimeType = format === 'jpeg' || format === 'jpg' ? 'image/jpeg' : 'image/png';

  // 2. Hide selection Transformers
  const transformer = stage?.findOne('Transformer');
  const wasTransformerVisible = transformer ? transformer.visible() : false;
  const layers = stage ? stage.getLayers() : [];
  if (transformer) {
    transformer.visible(false);
    layers.forEach((layer) => layer.batchDraw());
  }

  try {
    let dataUrl = '';

    if (stage) {
      // Option A: capture the Konva stage, then composite over solid white.
      // NOTE: `fill` is NOT passed to `toDataURL` — Konva ignores it, so a
      // transparent capture would export with a black background in viewers
      // that render alpha as dark fill. White is painted explicitly below.
      const transparent = stage.toDataURL({
        pixelRatio: 2,
        mimeType: 'image/png',
      });
      if (!transparent || transparent === 'data:,') {
        throw new Error('toDataURL returned an empty string or empty canvas.');
      }
      dataUrl = await flattenDataUrlOverWhite(transparent, mimeType);
    } else {
      // Option B: Fallback using temporary offscreen canvas with white fill
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = konvaCanvas.width;
      tempCanvas.height = konvaCanvas.height;
      const ctx = tempCanvas.getContext('2d');

      // Fill white base
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

      // Draw active canvas content on top
      ctx.drawImage(konvaCanvas, 0, 0);
      dataUrl = tempCanvas.toDataURL(mimeType, 1.0);
    }

    if (!dataUrl || dataUrl === 'data:,') {
      throw new Error('toDataURL returned an empty string or empty canvas.');
    }

    // 3. Trigger Download via Blob
    const byteString = atob(dataUrl.split(',')[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.download = `${fileName}.${format === 'jpeg' ? 'jpg' : format}`;
    link.href = blobUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (error) {
    console.error('[Export Error] Failed to export canvas:', error);
    alert(`Export failed: ${error.message}`);
  } finally {
    // 4. Restore selection Transformer
    if (transformer && wasTransformerVisible) {
      transformer.visible(true);
      layers.forEach((layer) => layer.batchDraw());
    }
  }
};
