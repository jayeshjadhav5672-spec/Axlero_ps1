/**
 * canvas-hotkeys.test.mjs — keyboard shortcut contract (no DOM).
 *
 * The hook itself needs window listeners, so the pure bare-key → tool
 * mapping is exported as TOOL_SHORTCUTS and verified directly: tool
 * switching must exist for letters + legacy number aliases, while
 * operation shortcuts (duplicate/group/ungroup, undo/redo, delete, pan)
 * live in the mod-gated / useCanvasDrawing paths and are covered by
 * manual verification (no browser test harness in this repo).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TOOL_SHORTCUTS } from '../src/components/canvas/hooks/useCanvasHotkeys.js';

describe('TOOL_SHORTCUTS', () => {
  it('maps letter keys to tools', () => {
    assert.deepEqual(
      Object.fromEntries(
        ['v', 'p', 'r', 'c', 't', 'f', 'a', 'l', 'e', 'h', 'd'].map((k) => [k, TOOL_SHORTCUTS[k]]),
      ),
      {
        v: 'select',
        p: 'freehand',
        r: 'rectangle',
        c: 'circle',
        t: 'text',
        f: 'frame',
        a: 'arrow',
        l: 'line',
        e: 'eraser',
        h: 'pan',
        d: 'diamond',
      },
    );
  });

  it('keeps legacy number-row aliases', () => {
    assert.equal(TOOL_SHORTCUTS[1], 'select');
    assert.equal(TOOL_SHORTCUTS[2], 'rectangle');
    assert.equal(TOOL_SHORTCUTS[3], 'circle');
    assert.equal(TOOL_SHORTCUTS[4], 'diamond');
  });

  it('every mapped value is a known tool id', () => {
    const known = new Set([
      'select',
      'freehand',
      'rectangle',
      'circle',
      'diamond',
      'arrow',
      'line',
      'text',
      'frame',
      'eraser',
      'pan',
    ]);
    for (const [key, tool] of Object.entries(TOOL_SHORTCUTS)) {
      assert.ok(known.has(tool), `unexpected tool ${tool} for key ${key}`);
    }
  });

  it('has no modifier-only or multi-character bindings', () => {
    for (const key of Object.keys(TOOL_SHORTCUTS)) {
      assert.equal(typeof key, 'string');
      assert.equal(key.length, 1);
    }
  });
});
