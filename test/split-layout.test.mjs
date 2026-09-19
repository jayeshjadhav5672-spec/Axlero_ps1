/**
 * split-layout.test.mjs — WorkspaceSplitLayout math (no DOM, no React).
 * Covers the pure helpers in src/components/layout/splitLayout.js that the
 * component depends on: stored-width clamping and narrow-viewport minimums.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPLIT_DEFAULT_PCT, SPLIT_MAX_PCT, SPLIT_MIN_PCT, clampSplitPercent, minPaneWidth } from '../src/components/layout/splitLayout.js';

test('clampSplitPercent keeps the draggable 20-80 range and rejects garbage', () => {
  assert.equal(clampSplitPercent(50), 50);
  assert.equal(clampSplitPercent(20), 20);
  assert.equal(clampSplitPercent(80), 80);
  assert.equal(clampSplitPercent(5), SPLIT_MIN_PCT);
  assert.equal(clampSplitPercent(95), SPLIT_MAX_PCT);
  assert.equal(clampSplitPercent(-30), SPLIT_MIN_PCT);
  assert.equal(clampSplitPercent('45'), 45);
  assert.equal(clampSplitPercent(NaN), SPLIT_DEFAULT_PCT);
  assert.equal(clampSplitPercent(undefined), SPLIT_DEFAULT_PCT);
  assert.equal(clampSplitPercent('wide'), SPLIT_DEFAULT_PCT);
  assert.equal(clampSplitPercent(null), SPLIT_DEFAULT_PCT);
  assert.equal(clampSplitPercent({}, 33), 33);
});

test('minPaneWidth keeps the 200px design minimum on wide containers', () => {
  assert.equal(minPaneWidth(1600), 200);
  assert.equal(minPaneWidth(1000), 200);
  assert.equal(minPaneWidth(412), 200);
  assert.equal(minPaneWidth(undefined), 200);
  assert.equal(minPaneWidth(0), 200);
  assert.equal(minPaneWidth(NaN), 200);
});

test('minPaneWidth shrinks proportionally on narrow viewports so both panes + divider fit', () => {
  // 360px phone: (360 - 12) / 2 = 174 per pane; 174 + 174 + 12 = 360.
  assert.equal(minPaneWidth(360), 174);
  const check = (w) => {
    const m = minPaneWidth(w);
    assert.ok(m >= 0 && m <= 200, `min ${m} within [0, 200] for width ${w}`);
    assert.ok(m * 2 + 12 <= w + 1e-9, `panes + divider fit in ${w}`);
  };
  for (const w of [320, 360, 375, 411, 412, 500, 768]) check(w);
});
