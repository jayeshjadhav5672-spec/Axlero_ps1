import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  exportBounds,
  getSelectionBounds,
  resolveExportBounds,
  stageDataURL,
} from '../src/components/canvas/utils/exportHub.js';

const RECT = { id: 'shape-r1', type: 'rectangle', x: 10, y: 20, width: 100, height: 50, strokeWidth: 2 };
const CIRCLE = { id: 'shape-c1', type: 'circle', x: 200, y: 200, radius: 25, strokeWidth: 4 };
const ARROW = { id: 'shape-a1', type: 'arrow', points: [300, 300, 360, 320], strokeWidth: 4 };

// Stub Konva stage: records toDataURL opts, reports configurable pan/zoom.
function stubStage({ scale = 1, x = 0, y = 0 } = {}, seen = {}) {
  return {
    scaleX: () => scale,
    scaleY: () => scale,
    position: () => ({ x, y }),
    toDataURL: (opts) => {
      Object.assign(seen, opts);
      return 'data:image/png;base64,stub';
    },
  };
}

describe('export content bounds', () => {
  it('exportBounds unions all shapes with padding', () => {
    // rectangle bounds are raw (x 10..110, y 20..70); arrows/circles pad
    // by half the stroke width inside getShapeBounds.
    const bounds = exportBounds([RECT], 40);
    assert.equal(bounds.x, 10 - 40);
    assert.equal(bounds.y, 20 - 40);
    assert.equal(bounds.width, (110 - 10) + 80);
    assert.equal(bounds.height, (70 - 20) + 80);
  });

  it('exportBounds spans arrows and circles regardless of viewport', () => {
    const bounds = exportBounds([RECT, CIRCLE, ARROW], 40);
    assert.ok(bounds.x <= 10 - 40);
    // arrow max: 360 + stroke pad 2, plus padding
    assert.ok(bounds.x + bounds.width >= 362 + 40);
    // circle bottom: 200 + 25 + 2 pad, plus padding
    assert.ok(bounds.y + bounds.height >= 227 + 40);
  });

  it('exportBounds excludes frames and falls back when empty', () => {
    const frame = { id: 'frame-1', type: 'frame', x: 0, y: 0, width: 5000, height: 5000 };
    assert.deepEqual(exportBounds([frame], 40), { x: 0, y: 0, width: 1600, height: 900 });
    assert.deepEqual(exportBounds([], 40), { x: 0, y: 0, width: 1600, height: 900 });
  });

  it('getSelectionBounds prefers the selection, resolveExportBounds flags it', () => {
    const sel = getSelectionBounds([CIRCLE], 20);
    assert.ok(sel.x < 200 && sel.x + sel.width > 200);
    assert.equal(getSelectionBounds([], 20), null);
    const res = resolveExportBounds([RECT, CIRCLE], [CIRCLE]);
    assert.equal(res.selectionOnly, true);
    assert.deepEqual(resolveExportBounds([RECT], []).selectionOnly, false);
  });

  it('stageDataURL maps world bounds through pan/zoom (no clipped exports)', () => {
    // World bounds x 0..200 at zoom 0.5, panned by (+100, +50):
    // screen frame must be x 100..200, y 50..150 — NOT the raw world box.
    const seen = {};
    const stage = stubStage({ scale: 0.5, x: 100, y: 50 }, seen);
    stageDataURL(stage, {
      mimeType: 'image/png',
      pixelRatio: 2,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
    });
    assert.equal(seen.x, 100);
    assert.equal(seen.y, 50);
    assert.equal(seen.width, 100);
    assert.equal(seen.height, 100);
    assert.equal(seen.pixelRatio, 2);
  });

  it('stageDataURL is identity at scale 1 with zero pan', () => {
    const seen = {};
    stageDataURL(stubStage({}, seen), {
      mimeType: 'image/png',
      bounds: { x: 10, y: 20, width: 100, height: 50 },
    });
    assert.equal(seen.x, 10);
    assert.equal(seen.y, 20);
    assert.equal(seen.width, 100);
    assert.equal(seen.height, 50);
  });

  it('stageDataURL captures everything without bounds (full viewport)', () => {
    const seen = {};
    stageDataURL(stubStage({ scale: 0.5, x: 100, y: 50 }, seen), { mimeType: 'image/png' });
    assert.equal(seen.x, undefined);
    assert.equal(seen.pixelRatio, 2);
  });

  it('stageDataURL throws readably with no stage', () => {
    assert.throws(() => stageDataURL(null, {}), /Canvas not ready/);
  });

  it('exportBounds skips shapes with non-finite dimensions', () => {
    const bounds = exportBounds([
      RECT,
      { id: 'shape-nan', type: 'rectangle', x: 0, y: 0, width: NaN, height: 50 },
      { id: 'shape-nan2', type: 'rectangle', x: 0, y: 0, width: 10, height: Infinity },
    ]);
    // Only RECT contributes: x 10..110, y 20..70, padding 32.
    assert.equal(bounds.x, 10 - 32);
    assert.equal(bounds.y, 20 - 32);
    assert.equal(bounds.width, 100 + 64);
    assert.equal(bounds.height, 50 + 64);
  });
});

describe('rotated export bounds (visible-geometry-wins)', () => {
  const approx = (actual, expected, label) => {
    assert.ok(
      Math.abs(actual - expected) < 1e-6,
      `${label}: expected ${expected}, got ${actual}`,
    );
  };

  it('90° rectangle: bounds match the visible box, not the at-rest box', () => {
    // (100,100,100x50) rotated 90° clockwise about top-left (100,100):
    // corners -> (100,100),(100,200),(50,200),(50,100): AABB x50..100, y100..200.
    const bounds = exportBounds(
      [{ id: 'shape-rr', type: 'rectangle', x: 100, y: 100, width: 100, height: 50, rotation: 90 }],
      0,
    );
    approx(bounds.x, 50, 'x');
    approx(bounds.y, 100, 'y');
    approx(bounds.width, 50, 'width');
    approx(bounds.height, 100, 'height');
    // Visible extents strictly exceed the unrotated box (x100..200, y100..150).
    assert.ok(bounds.x < 100, 'minX exceeds unrotated left');
    assert.ok(bounds.y + bounds.height > 150, 'maxY exceeds unrotated bottom');
  });

  it('45° rectangle/diamond/image extents exceed the unrotated box', () => {
    const mk = (type) => ({ id: `shape-${type}`, type, x: 0, y: 0, width: 100, height: 50, rotation: 45 });
    for (const type of ['rectangle', 'diamond', 'image']) {
      const b = exportBounds([mk(type)], 0);
      // Rotated corners: minX = -50*sin45 ≈ -35.36 < 0;
      // maxY = 100*sin45 + 50*cos45 ≈ 106.07 > 50.
      assert.ok(b.x < 0, `${type} minX exceeds unrotated left`);
      assert.ok(b.y + b.height > 50, `${type} maxY exceeds unrotated bottom`);
    }
    // Exact rotated AABB of the 45° rectangle (unrotated box: x0..100, y0..50).
    const b = exportBounds([mk('rectangle')], 0);
    approx(b.x, -50 * Math.SQRT1_2, 'minX');
    approx(b.x + b.width, 100 * Math.SQRT1_2, 'maxX');
    approx(b.y, 0, 'minY');
    approx(b.y + b.height, 150 * Math.SQRT1_2, 'maxY');
  });

  it('rotated selection exports the visible box (selection-only preserved)', () => {
    const rot = { id: 'shape-rs', type: 'rectangle', x: 100, y: 100, width: 100, height: 50, rotation: 90 };
    const sel = getSelectionBounds([rot], 0);
    approx(sel.x, 50, 'sel x');
    approx(sel.y, 100, 'sel y');
    approx(sel.width, 50, 'sel width');
    approx(sel.height, 100, 'sel height');
    const res = resolveExportBounds([RECT, rot], [rot]);
    assert.equal(res.selectionOnly, true);
    approx(res.bounds.x, 50 - 20, 'selection padding applies to rotated bounds');
  });

  it('stageDataURL maps rotated bounds through pan/zoom (two viewports)', () => {
    const bounds = exportBounds(
      [{ id: 'shape-rr', type: 'rectangle', x: 100, y: 100, width: 100, height: 50, rotation: 90 }],
      0,
    );
    // Viewport 1: identity scale/pan — screen frame equals world bounds.
    const seen1 = {};
    stageDataURL(stubStage({}, seen1), { mimeType: 'image/png', pixelRatio: 2, bounds });
    approx(seen1.x, 50, 'identity x');
    approx(seen1.y, 100, 'identity y');
    // Viewport 2: zoom 2 + pan (-20,+30): screen = world*2 + pan.
    const seen2 = {};
    stageDataURL(stubStage({ scale: 2, x: -20, y: 30 }, seen2), {
      mimeType: 'image/png',
      pixelRatio: 2,
      bounds,
    });
    approx(seen2.x, 50 * 2 - 20, 'zoomed x');
    approx(seen2.y, 100 * 2 + 30, 'zoomed y');
    // Width/height go through Math.ceil (float dust tolerated): ≈100x200.
    assert.ok(Math.abs(seen2.width - 100) <= 1, `zoomed width ≈ 100, got ${seen2.width}`);
    assert.ok(Math.abs(seen2.height - 200) <= 1, `zoomed height ≈ 200, got ${seen2.height}`);
  });

  it('non-finite rotated shapes are still skipped (guard intact)', () => {
    const rot = { id: 'shape-rr', type: 'rectangle', x: 100, y: 100, width: 100, height: 50, rotation: 90 };
    const clean = exportBounds([rot], 0);
    const withBad = exportBounds(
      [
        rot,
        { id: 'shape-nan', type: 'rectangle', x: 0, y: 0, width: NaN, height: 50, rotation: 45 },
        { id: 'shape-inf', type: 'image', x: 0, y: 0, width: 10, height: Infinity, rotation: 30 },
      ],
      0,
    );
    assert.deepEqual(withBad, clean);
  });

  it('frames stay excluded when rotated content is present', () => {
    const rot = { id: 'shape-rr', type: 'rectangle', x: 100, y: 100, width: 100, height: 50, rotation: 90 };
    const frame = { id: 'frame-1', type: 'frame', x: 0, y: 0, width: 5000, height: 5000 };
    assert.deepEqual(exportBounds([frame, rot], 0), exportBounds([rot], 0));
  });
});
