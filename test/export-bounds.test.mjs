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
