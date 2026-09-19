import { getShapeBounds, serializeShapes } from './shapes.js';

/**
 * exportHub.js — Sayon (Week 2: Universal Export Hub)
 *
 * Canvas export into JSON, PNG, JPEG, AVIF, SVG, and PDF.
 * Pure helpers + thin Konva-stage capture. No Socket.io / Yjs deps.
 * Callers MUST deselect + hide the Transformer before raster capture
 * (see `prepareStageForExport`) so selection outlines never bake in.
 */

export const EXPORT_FORMATS = ['json', 'png', 'jpeg', 'avif', 'svg', 'pdf'];

function dataUrlToBlobUrl(dataUrl, mimeType) {
  // Blob object URL instead of a multi-MB base64 href: long data URLs get
  // truncated (silently broken downloads) in Safari/Firefox.
  const byteString = atob(dataUrl.split(',')[1]);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i += 1) {
    ia[i] = byteString.charCodeAt(i);
  }
  return URL.createObjectURL(new Blob([ab], { type: mimeType }));
}

function downloadDataUrl(dataUrl, filename, mimeType) {
  const a = document.createElement('a');
  a.download = filename;
  let url = dataUrl;
  let revoke = null;
  if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
    url = dataUrlToBlobUrl(dataUrl, mimeType ?? 'application/octet-stream');
    revoke = url;
  }
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 1000);
}

function downloadText(text, filename, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Resolve whatever the caller passed (raw Konva Stage, React ref, or
 * nothing) into an exportable source. Never throws — returns
 * `{ stage: null, domCanvas: null }` when nothing is exportable, so
 * callers can raise a readable error instead of crashing on
 * `undefined.toDataURL`.
 */
export function resolveStageOrCanvas(target) {
  // Check if target is a React ref
  let stage = target?.current ?? target;

  // Fallback: Check window.Konva registry
  if ((!stage || typeof stage.toDataURL !== 'function') && typeof window !== 'undefined') {
    if (window.Konva && Array.isArray(window.Konva.stages) && window.Konva.stages.length > 0) {
      stage = window.Konva.stages[0];
    }
    // ESM-bundled Konva never populates window.Konva — CanvasStage
    // publishes its live stage to this registry on mount.
    if (
      (!stage || typeof stage.toDataURL !== 'function') &&
      Array.isArray(window.__syncspaceStages) &&
      window.__syncspaceStages.length > 0
    ) {
      stage = window.__syncspaceStages[window.__syncspaceStages.length - 1];
    }
  }

  // If Konva stage is resolved, return it
  if (stage && typeof stage.toDataURL === 'function') {
    return { stage, domCanvas: null };
  }

  // Final Fallback: Query direct DOM canvas
  if (typeof document !== 'undefined') {
    const domCanvas = document.querySelector('.konvajs-content canvas') || document.querySelector('canvas');
    if (domCanvas) {
      return { stage: null, domCanvas };
    }
  }

  return { stage: null, domCanvas: null };
}

/**
 * Deselect + detach the Transformer and redraw, so exports are clean.
 * Safe no-op when refs are absent.
 */export function prepareStageForExport({ stageRef, transformerRef, selectShape } = {}) {
  try {
    selectShape?.(null);
  } catch {
    // selection reset is best-effort; capture proceeds regardless
  }
  try {
    const tr = transformerRef?.current;
    if (tr) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
    }
    stageRef?.current?.batchDraw?.();
  } catch {
    // transformer teardown is best-effort
  }
}

/**
 * Deprecated alias — use `exportCanvas` / `exportCanvasDirect` from
 * `src/utils/exportUtils.js`. Kept so older callers keep working.
 */
export const exportCanvas = async (stageRef, format = 'png', fileName = 'syncspace-board') => {
  const { exportCanvas: canonical } = await import('../../../utils/exportUtils.js');
  const ref = stageRef?.current ?? stageRef;
  return canonical({ current: ref ?? null }, format, fileName);
};

/** Union bounds of all shapes in world coords (fallback: 1600x900). */
export function exportBounds(shapes, padding = 32) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes ?? []) {
    const b = getShapeBounds(s);
    if (!b) continue;
    // Frames are layout guides, not content — exclude them from the
    // exported bounds so empty frames don't inflate the document.
    if (s?.type === 'frame') continue;
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) {
    return { x: 0, y: 0, width: 1600, height: 900 };
  }
  const pad = Number.isFinite(padding) ? padding : 32;
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

/**
 * Union bounds of only the selected shapes (selection-only export).
 * Falls back to the auto-cropped full canvas when the selection is empty.
 */
export function getSelectionBounds(selectedShapes, padding = 20) {
  const list = Array.isArray(selectedShapes) ? selectedShapes.filter(Boolean) : [];
  if (list.length === 0) return null;
  return exportBounds(list, padding);
}

/** Resolve export bounds for a raster capture: selection wins, else full board. */
export function resolveExportBounds(shapes, selectedShapes) {
  const sel = getSelectionBounds(selectedShapes, 20);
  if (sel) return { bounds: sel, selectionOnly: true };
  return { bounds: exportBounds(shapes, 32), selectionOnly: false };
}

/** JSON: clean serializable shapes array -> syncspace-board.json */
export function exportJSON(shapes, filename = 'syncspace-board.json') {
  const clean = serializeShapes(shapes);
  downloadText(JSON.stringify(clean, null, 2), filename);
  return clean.length;
}

function stageDataURL(stage, { mimeType, pixelRatio = 2, bounds } = {}) {
  if (!stage || typeof stage.toDataURL !== 'function') {
    throw new Error('Canvas not ready');
  }
  const opts = { pixelRatio, mimeType };
  if (bounds && Number.isFinite(bounds.x)) {
    opts.x = bounds.x;
    opts.y = bounds.y;
    opts.width = Math.max(1, Math.ceil(bounds.width));
    opts.height = Math.max(1, Math.ceil(bounds.height));
  }
  let url;
  try {
    url = stage.toDataURL(opts);
  } catch (err) {
    // Tainted canvas (CORS-blocked image pixels) makes Konva throw a
    // security DOMException here — surface it readably so the shell toast
    // can tell the user what happened instead of failing silently.
    throw new Error(
      'Export failed: canvas is tainted by a CORS-blocked image. Re-insert images via file picker, paste, or drag & drop.',
      { cause: err },
    );
  }
  if (!url || url === 'data:,') {
    throw new Error('toDataURL returned an empty string. Check for tainted canvas or empty stage.');
  }
  return url;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('raster decode failed'));
    img.src = dataUrl;
  });
}

/** Composite a transparent PNG data URL over an opaque background. */
async function flattenOverBackground(pngDataUrl, background = '#ffffff', mime = 'image/jpeg', quality = 0.92) {
  const img = await loadImage(pngDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL(mime, quality);
}

/**
 * Capture a WHITE-background PNG data URL from either a Konva stage
 * (high-DPI via pixelRatio) or a raw DOM canvas bitmap. White is
 * composited explicitly: Konva's `toDataURL` ignores any `fill` option
 * and raw canvas pixels default to transparent, which many image
 * viewers render as solid black.
 *
 * When `bounds` (world coords) is provided, the stage capture is cropped
 * via `stage.toDataURL({ x, y, width, height, pixelRatio: 2 })` so the
 * export is auto-cropped to content instead of the raw infinite viewport.
 */
async function whitePngDataURL({ stage, domCanvas }, pixelRatio = 2, bounds = null) {
  if (stage) {
    const transparent = stageDataURL(stage, { mimeType: 'image/png', pixelRatio, bounds });
    return flattenOverBackground(transparent, '#ffffff', 'image/png', 1.0);
  }
  const temp = document.createElement('canvas');
  temp.width = domCanvas.width;
  temp.height = domCanvas.height;
  const ctx = temp.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, temp.width, temp.height);
  ctx.drawImage(domCanvas, 0, 0);
  const url = temp.toDataURL('image/png');
  if (!url || url === 'data:,') {
    throw new Error('toDataURL returned an empty string or empty canvas.');
  }
  return url;
}

/**
 * Crop a full-viewport capture bitmap to content `bounds` (world coords).
 * Done in plain 2D-canvas math from the stage's own scale/position instead
 * of Konva's toDataURL crop options, whose x/y frame is easy to misread
 * under zoom/pan. Returns a PNG data URL sized to the bounds box.
 */
async function cropPngToBounds(pngDataUrl, stage, bounds, pixelRatio = 2) {
  const img = await loadImage(pngDataUrl);
  const scale = (stage && Number.isFinite(stage.scaleX()) && stage.scaleX()) || 1;
  const pos = (stage && stage.position()) || { x: 0, y: 0 };
  const px = Number.isFinite(pos.x) ? pos.x : 0;
  const py = Number.isFinite(pos.y) ? pos.y : 0;
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  const sx = (bounds.x * scale + px) * pixelRatio;
  const sy = (bounds.y * scale + py) * pixelRatio;
  const sw = bounds.width * scale * pixelRatio;
  const sh = bounds.height * scale * pixelRatio;
  // Clamp the crop rect into the bitmap; abort loudly on empty overlap
  // instead of embedding a blank/degenerate page.
  const cx = Math.max(0, sx);
  const cy = Math.max(0, sy);
  const cw = Math.min(natW - cx, sw - (cx - sx));
  const ch = Math.min(natH - cy, sh - (cy - sy));
  if (!(cw >= 1 && ch >= 1)) {
    throw new Error('Export failed: content bounds fall outside the captured canvas.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cw));
  canvas.height = Math.max(1, Math.round(ch));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

function assertExportable(resolved) {
  if (!resolved.stage && !resolved.domCanvas) {
    throw new Error('Canvas not ready');
  }
  return resolved;
}

/**
 * PNG: white-composited, auto-cropped capture from a React ref, a raw
 * Konva Stage, the stage registries, or the DOM canvas — in that order.
 * Content bounds come from `exportBounds(shapes)` with a 32px padding
 * margin and are passed into
 * `stage.toDataURL({ x, y, width, height, pixelRatio: 2 })`.
 * Pass `selectedShapes` to export only the current selection
 * (`getSelectionBounds(selectedShapes, 20)`); falls back to the full
 * auto-cropped board when the selection is empty. Async (decodes the
 * capture bitmap to composite the white background).
 */
export async function exportPNG(stageOrRef, filename = 'syncspace-board.png', shapes = null, selectedShapes = null) {
  const resolved = assertExportable(resolveStageOrCanvas(stageOrRef));
  const bounds = Array.isArray(shapes)
    ? (getSelectionBounds(selectedShapes, 20) ?? exportBounds(shapes, 32))
    : null;
  const url = await whitePngDataURL(resolved, 2, bounds);
  downloadDataUrl(url, filename, 'image/png');
  return url;
}

/**
 * JPEG: white-composited, auto-cropped capture, re-encoded as JPEG.
 * Accepts the same ref/stage/nothing + shapes/selection inputs as `exportPNG`.
 */
export async function exportJPEG(stageOrRef, filename = 'syncspace-board.jpg', shapes = null, selectedShapes = null) {
  const resolved = assertExportable(resolveStageOrCanvas(stageOrRef));
  const bounds = Array.isArray(shapes)
    ? (getSelectionBounds(selectedShapes, 20) ?? exportBounds(shapes, 32))
    : null;
  const whitePng = await whitePngDataURL(resolved, 2, bounds);
  const url = await flattenOverBackground(whitePng, '#ffffff', 'image/jpeg', 0.92);
  downloadDataUrl(url, filename, 'image/jpeg');
  return url;
}

/**
 * Selection-only PNG export. When `selectedShapes` is non-empty the union
 * bounds of only those shapes (20px padding) are captured; otherwise the
 * caller should disable the UI option or fall back to `exportPNG`.
 */
export async function exportSelectedPNG(stageOrRef, selectedShapes, filename = 'syncspace-board-selection.png') {
  const bounds = getSelectionBounds(selectedShapes, 20);
  if (!bounds) throw new Error('No shape selected — select shapes to export, or export the full board.');
  const resolved = assertExportable(resolveStageOrCanvas(stageOrRef));
  const url = await whitePngDataURL(resolved, 2, bounds);
  downloadDataUrl(url, filename, 'image/png');
  return url;
}

/**
 * Selection-only JPEG export (same bounds contract as `exportSelectedPNG`).
 */
export async function exportSelectedJPEG(stageOrRef, selectedShapes, filename = 'syncspace-board-selection.jpg') {
  const bounds = getSelectionBounds(selectedShapes, 20);
  if (!bounds) throw new Error('No shape selected — select shapes to export, or export the full board.');
  const resolved = assertExportable(resolveStageOrCanvas(stageOrRef));
  const whitePng = await whitePngDataURL(resolved, 2, bounds);
  const url = await flattenOverBackground(whitePng, '#ffffff', 'image/jpeg', 0.92);
  downloadDataUrl(url, filename, 'image/jpeg');
  return url;
}

/**
 * AVIF: native auto-cropped capture, white-PNG fallback when the browser
 * rejects it (or when only a DOM canvas is reachable).
 */
export async function exportAVIF(stageOrRef, filename = 'syncspace-board.avif', shapes = null, selectedShapes = null) {
  const resolved = resolveStageOrCanvas(stageOrRef);
  const bounds = Array.isArray(shapes)
    ? (getSelectionBounds(selectedShapes, 20) ?? exportBounds(shapes, 32))
    : null;
  if (resolved.stage) {
    try {
      const url = stageDataURL(resolved.stage, { mimeType: 'image/avif', pixelRatio: 2, bounds });
      // Chrome returns a PNG data URL silently when AVIF encode fails —
      // verify the prefix before trusting the extension.
      if (typeof url === 'string' && url.startsWith('data:image/avif')) {
        downloadDataUrl(url, filename, 'image/avif');
        return { url, fallback: false };
      }
    } catch {
      // fall through to the PNG fallback below
    }
  }
  const url = await whitePngDataURL(assertExportable(resolved), 2, bounds);
  const pngName =
    typeof filename === 'string' && filename.toLowerCase().endsWith('.avif')
      ? `${filename.slice(0, -5)}.png`
      : 'syncspace-board.png';
  downloadDataUrl(url, pngName, 'image/png');
  return { url, fallback: true };
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function dashAttr(shape) {
  const d = shape.dash ?? (shape.strokeStyle === 'dashed' ? [8, 5] : shape.strokeStyle === 'dotted' ? [2, 5] : null);
  return Array.isArray(d) && d.length > 0 ? ` stroke-dasharray="${d.join(' ')}"` : '';
}

function opacityAttr(shape) {
  const o = shape.opacity;
  return typeof o === 'number' && o < 1 ? ` opacity="${Math.max(0, Math.min(1, o))}"` : '';
}

/** SVG: vector markup generated from shape descriptors. */
export function exportSVG(shapes, filename = 'syncspace-board.svg') {
  const clean = serializeShapes(shapes);
  const bounds = exportBounds(clean);
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" width="${Math.ceil(bounds.width)}" height="${Math.ceil(bounds.height)}">`,
  );
  parts.push('<defs><marker id="sync-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="context-fill" /></marker></defs>');
  parts.push('<rect x="' + bounds.x + '" y="' + bounds.y + '" width="' + bounds.width + '" height="' + bounds.height + '" fill="#ffffff"/>');
  for (const s of clean) {
    const sw = s.strokeWidth ?? 2;
    const stroke = s.stroke ?? '#1e1e1e';
    const fill = s.fill && s.fill !== 'transparent' ? s.fill : 'none';
    if (s.type === 'rectangle' || s.type === 'frame') {
      const dash = s.type === 'frame' ? ` stroke-dasharray="${(s.dash ?? [6, 6]).join(' ')}"` : dashAttr(s);
      const rx = s.roundness === 'round' ? 8 : 2;
      parts.push(
        `<rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" rx="${rx}" fill="${s.type === 'frame' ? (s.fill ?? 'rgba(241,245,249,0.35)') : fill}" stroke="${s.type === 'frame' ? (s.stroke ?? '#94a3b8') : stroke}" stroke-width="${s.type === 'frame' ? 2 : sw}"${dash}${opacityAttr(s)}/>`,
      );
      if (s.type === 'frame' && s.title) {
        parts.push(`<text x="${s.x + 8}" y="${s.y - 8}" font-size="14" font-family="sans-serif" fill="#64748b">${esc(s.title)}</text>`);
      }
    } else if (s.type === 'circle') {
      const rx = s.radiusX ?? s.radius ?? 10;
      const ry = s.radiusY ?? s.radius ?? 10;
      parts.push(
        `<ellipse cx="${s.x}" cy="${s.y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dashAttr(s)}${opacityAttr(s)}/>`,
      );
    } else if (s.type === 'diamond') {
      const cx = s.x + s.width / 2;
      const cy = s.y + s.height / 2;
      parts.push(
        `<polygon points="${cx},${s.y} ${s.x + s.width},${cy} ${cx},${s.y + s.height} ${s.x},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dashAttr(s)}${opacityAttr(s)}/>`,
      );
    } else if (s.type === 'freehand' || s.type === 'pen' || s.type === 'line') {
      const pts = Array.isArray(s.points) ? s.points : [];
      const pairs = [];
      for (let i = 0; i + 1 < pts.length; i += 2) pairs.push(`${pts[i]},${pts[i + 1]}`);
      if (pairs.length === 0) continue;
      parts.push(
        `<polyline points="${pairs.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dashAttr(s)}${opacityAttr(s)}/>`,
      );
    } else if (s.type === 'arrow') {
      const pts = Array.isArray(s.points) ? s.points : [];
      const pairs = [];
      for (let i = 0; i + 1 < pts.length; i += 2) pairs.push(`${pts[i]},${pts[i + 1]}`);
      if (pairs.length === 0) continue;
      const endHead = (s.endArrowhead ?? 'arrow') !== 'none';
      parts.push(
        `<polyline points="${pairs.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dashAttr(s)}${opacityAttr(s)}${endHead ? ' marker-end="url(#sync-arrow)"' : ''}/>`,
      );
    } else if (s.type === 'text') {
      const anchor = s.align === 'center' || s.textAlign === 'center' ? 'middle' : s.align === 'right' || s.textAlign === 'right' ? 'end' : 'start';
      const lines = String(s.text ?? '').split('\n');
      const fs = s.fontSize ?? 20;
      lines.forEach((line, i) => {
        parts.push(
          `<text x="${s.x}" y="${s.y + fs * (i + 1)}" font-size="${fs}" font-family="${esc(s.fontFamily ?? 'sans-serif')}" text-anchor="${anchor}" fill="${esc(s.fill ?? '#1e1e1e')}"${opacityAttr(s)}>${esc(line)}</text>`,
        );
      });
    } else if (s.type === 'image' && typeof s.src === 'string') {
      parts.push(
        `<image x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" xlink:href="${s.src}"${opacityAttr(s)}/>`,
      );
    } else if (s.type === 'group' && Array.isArray(s.children)) {
      const ox = Number.isFinite(s.x) ? s.x : 0;
      const oy = Number.isFinite(s.y) ? s.y : 0;
      parts.push(`<g transform="translate(${ox} ${oy})">`);
      for (const k of s.children) {
        if (!k) continue;
        const ksw = k.strokeWidth ?? 2;
        const kstroke = k.stroke ?? '#1e1e1e';
        const kfill = k.fill && k.fill !== 'transparent' ? k.fill : 'none';
        if (k.type === 'rectangle') {
          parts.push(`<rect x="${k.x}" y="${k.y}" width="${k.width}" height="${k.height}" fill="${kfill}" stroke="${kstroke}" stroke-width="${ksw}"/>`);
        } else if (k.type === 'circle') {
          const krx = k.radiusX ?? k.radius ?? 10;
          const kry = k.radiusY ?? k.radius ?? 10;
          parts.push(`<ellipse cx="${k.x}" cy="${k.y}" rx="${krx}" ry="${kry}" fill="${kfill}" stroke="${kstroke}" stroke-width="${ksw}"/>`);
        } else if (k.type === 'text') {
          parts.push(`<text x="${k.x}" y="${k.y}" font-size="${k.fontSize ?? 20}" fill="${k.fill ?? '#1e1e1e'}">${esc(k.text ?? '')}</text>`);
        }
      }
      parts.push('</g>');
    }
  }
  parts.push('</svg>');
  downloadText(parts.join('\n'), filename, 'image/svg+xml');
  return parts.join('\n');
}

/**
 * PDF: white-composited PNG embedded at content bounds via jspdf.
 * Geometry contract: the page is sized to `exportBounds(shapes, 32)` (or
 * the selection bounds when `selectedShapes` is provided) and the
 * embedded bitmap is captured at exactly those bounds
 * (`stage.toDataURL({ x, y, width, height, pixelRatio: 2 })`), so the
 * page and the image always agree. The DOM-canvas fallback has no viewport
 * metadata, so it embeds the full bitmap on a bitmap-sized page instead of
 * stretching it into a bounds-sized one. jspdf loads lazily so the main
 * bundle stays lean; throws a readable error when missing.
 */
export async function exportPDF(stageOrRef, shapes, filename = 'syncspace-board.pdf', selectedShapes = null) {
  let jsPDFCtor;
  try {
    const mod = await import('jspdf');
    jsPDFCtor = mod.jsPDF ?? mod.default?.jsPDF ?? mod.default;
  } catch {
    throw new Error('PDF export needs the `jspdf` package — run `npm i jspdf`.');
  }
  if (typeof jsPDFCtor !== 'function') throw new Error('jspdf module did not expose jsPDF.');
  const resolved = assertExportable(resolveStageOrCanvas(stageOrRef));
  let png;
  let pageW;
  let pageH;
  if (resolved.stage) {
    const clean = serializeShapes(shapes);
    const bounds = getSelectionBounds(
      Array.isArray(selectedShapes) ? serializeShapes(selectedShapes) : null,
      20,
    ) ?? exportBounds(clean, 32);
    // Auto-cropped capture: bounds flow directly into
    // stage.toDataURL({ x, y, width, height, pixelRatio: 2 }) via
    // whitePngDataURL — no full-viewport capture + manual crop.
    png = await whitePngDataURL(resolved, 2, bounds);
    pageW = bounds.width;
    pageH = bounds.height;
  } else {
    // DOM fallback: no viewport metadata, so measure the bitmap and size
    // the page to it (never stretch a full-canvas capture into a
    // content-bounds page).
    png = await whitePngDataURL(resolved, 2);
    const img = await loadImage(png);
    pageW = img.naturalWidth || img.width || 1600;
    pageH = img.naturalHeight || img.height || 900;
  }
  const landscape = pageW >= pageH;
  const pdf = new jsPDFCtor({ unit: 'px', format: [pageW, pageH], orientation: landscape ? 'landscape' : 'portrait', hotfixes: ['px_scaling'] });
  pdf.addImage(png, 'PNG', 0, 0, pageW, pageH);
  pdf.save(filename);
  return true;
}
