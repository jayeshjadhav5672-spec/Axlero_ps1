/**
 * splitLayout.js — pure helpers for WorkspaceSplitLayout (no React, no DOM).
 * Imported by the component and by node --test so the layout math is
 * verified in one place.
 */

export const SPLIT_MIN_PCT = 20;
export const SPLIT_MAX_PCT = 80;
export const SPLIT_DEFAULT_PCT = 50;

/** Clamp a split percentage into the draggable range (rejects garbage). */
export function clampSplitPercent(value, fallback = SPLIT_DEFAULT_PCT) {
  const n = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(SPLIT_MIN_PCT, Math.min(SPLIT_MAX_PCT, n));
}

/**
 * Effective per-pane minimum width: the 200px design minimum, reduced
 * proportionally when the container itself is narrower than two minimum
 * panes + divider (otherwise flex + min-widths overflow the
 * `overflow-hidden` parent and the right pane + divider become
 * unreachable). At 0/unknown width the 200px design minimum applies.
 */
export function minPaneWidth(containerWidth) {
  const w = Number.isFinite(containerWidth) ? containerWidth : 0;
  if (w <= 0) return 200;
  return Math.max(0, Math.min(200, (w - 12) / 2));
}
