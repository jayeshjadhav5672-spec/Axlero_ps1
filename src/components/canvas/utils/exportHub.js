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
export function exportBounds(shapes) {
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
  const pad = 24;
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
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
 */
async function whitePngDataURL({ stage, domCanvas }, pixelRatio = 2) {
  if (stage) {
    const transparent = stageDataURL(stage, { mimeType: 'image/png', pixelRatio });
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

function assertExportable(resolved) {
  if (!resolved.stage && !resolved.domCanvas) {
    throw new Error('Canvas not ready');
  }
  return resolved;
}

/**
 * PNG: white-composited capture from a React ref, a raw Konva Stage, the
 * stage registries, or the DOM canvas — in that order. Async (decodes the
 * capture bitmap to composite the white background).
 */
export async function exportPNG(stageOrRef, filename = 'syncspace-board.png') {
  const resolved = assertExportable(resolveStageOrCanvas(stageOrRef));
  const url = await whitePngDataURL(resolved, 2);
  downloadDataUrl(url, filename, 'image/png');
  return url;
}

/**
 * JPEG: white-composited capture, re-encoded as JPEG. Accepts the same
 * ref/stage/nothing inputs as `exportPNG`.
 */
export async function exportJPEG(stageOrRef, filename = 'syncspace-board.jpg') {
  const resolved = assertExportable(resolveStageOrCanvas(stageOrRef));
  const whitePng = await whitePngDataURL(resolved, 2);
  const url = await flattenOverBackground(whitePng, '#ffffff', 'image/jpeg', 0.92);
  downloadDataUrl(url, filename, 'image/jpeg');
  return url;
}

/**
 * AVIF: native capture, white-PNG fallback when the browser rejects it
 * (or when only a DOM canvas is reachable).
 */
export async function exportAVIF(stageOrRef, filename = 'syncspace-board.avif') {
  const resolved = resolveStageOrCanvas(stageOrRef);
  if (resolved.stage) {
    try {
      const url = stageDataURL(resolved.stage, { mimeType: 'image/avif', pixelRatio: 2 });
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
  const url = await whitePngDataURL(assertExportable(resolved), 2);
  downloadDataUrl(url, 'syncspace-board.png', 'image/png');
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
    }
  }
  parts.push('</svg>');
  downloadText(parts.join('\n'), filename, 'image/svg+xml');
  return parts.join('\n');
}

/**
 * PDF: render the viewport to a white-composited PNG, embed at full
 * canvas bounds via jspdf. jspdf loads lazily so the main bundle stays
 * lean; throws a readable error when the dependency is missing.
 */
export async function exportPDF(stageOrRef, shapes, filename = 'syncspace-board.pdf') {
  let jsPDFCtor;
  try {
    const mod = await import('jspdf');
    jsPDFCtor = mod.jsPDF ?? mod.default?.jsPDF ?? mod.default;
  } catch {
    throw new Error('PDF export needs the `jspdf` package — run `npm i jspdf`.');
  }
  if (typeof jsPDFCtor !== 'function') throw new Error('jspdf module did not expose jsPDF.');
  const resolved = assertExportable(resolveStageOrCanvas(stageOrRef));
  const bounds = exportBounds(serializeShapes(shapes));
  const png = await whitePngDataURL(resolved, 2);
  const landscape = bounds.width >= bounds.height;
  const pdf = new jsPDFCtor({ unit: 'px', format: [bounds.width, bounds.height], orientation: landscape ? 'landscape' : 'portrait', hotfixes: ['px_scaling'] });
  pdf.addImage(png, 'PNG', 0, 0, bounds.width, bounds.height);
  pdf.save(filename);
  return true;
}
