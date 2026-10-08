/**
 * canvas-hotkeys.test.mjs — keyboard shortcut contract (no DOM).
 *
 * The hook itself needs window listeners, so the pure pieces are exported
 * and verified directly: the bare-key → tool mapping (TOOL_SHORTCUTS),
 * the editable/Monaco event guard (isEditableTarget), and the key-decision
 * resolver (resolveCanvasHotkey) that the window handler and the canvas
 * drawing handlers share. No browser test harness in this repo, so fake
 * event/target objects stand in for DOM nodes.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TOOL_SHORTCUTS,
  isEditableTarget,
  resolveCanvasHotkey,
} from '../src/components/canvas/hooks/useCanvasHotkeys.js';

// Minimal fake DOM node: only the fields the guard inspects.
const el = (tagName, props = {}) => ({ tagName, ...props });
// Fake Monaco inputarea textarea (tag + closest() into .monaco-editor).
const monacoInputarea = () => ({
  tagName: 'TEXTAREA',
  className: 'inputarea monaco-mouse-cursor-text',
  closest: (sel) => (sel === '.monaco-editor' ? { tagName: 'DIV' } : null),
});
const keyEvent = (key, target, extra = {}) => ({ key, target, ...extra });

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

describe('isEditableTarget', () => {
  it('recognizes standard editable controls', () => {
    assert.equal(isEditableTarget(keyEvent('c', el('INPUT'))), true);
    assert.equal(isEditableTarget(keyEvent('c', el('TEXTAREA'))), true);
    assert.equal(isEditableTarget(keyEvent('c', el('SELECT'))), true);
    assert.equal(isEditableTarget(keyEvent('c', el('input'))), true); // case-insensitive tags
    assert.equal(isEditableTarget(keyEvent('c', el('DIV', { isContentEditable: true }))), true);
    assert.equal(isEditableTarget(keyEvent('c', el('DIV'))), false);
  });

  it('recognizes Monaco surfaces even when the target is not the textarea', () => {
    // Direct typing target: the inputarea textarea inside .monaco-editor.
    assert.equal(isEditableTarget(keyEvent('c', monacoInputarea())), true);
    // Focus on the editor container itself (focus transitions, widgets).
    assert.equal(isEditableTarget(keyEvent('c', el('DIV', { className: 'monaco-editor vs-dark' }))), true);
    // Nested widget node: target is a plain span, path crosses the editor.
    const nested = keyEvent('c', el('SPAN'), {
      composedPath: () => [el('SPAN'), el('DIV', { className: 'monaco-editor' }), el('DIV')],
    });
    assert.equal(isEditableTarget(nested), true);
    // Null target with a Monaco-bearing composed path (retargeted events).
    assert.equal(
      isEditableTarget({ key: 'l', target: null, composedPath: () => [el('DIV', { className: 'monaco-editor' })] }),
      true,
    );
    // SVG-class edge: className object with baseVal.
    assert.equal(
      isEditableTarget(keyEvent('c', el('rect', { className: { baseVal: 'monaco-editor' } }))),
      true,
    );
  });

  it('lets whiteboard/canvas surfaces through', () => {
    assert.equal(isEditableTarget(keyEvent('c', el('CANVAS'))), false);
    assert.equal(isEditableTarget(keyEvent('c', el('DIV'))), false);
    assert.equal(isEditableTarget(keyEvent('c', el('BODY'))), false);
    assert.equal(isEditableTarget(keyEvent('c', null)), false);
    assert.equal(isEditableTarget(null), false);
    assert.equal(isEditableTarget(undefined), false);
  });
});

describe('resolveCanvasHotkey', () => {
  it('never fires for Monaco typing (letters stay text)', () => {
    for (const key of ['c', 'l', 'p', 'r', 't', 'f', 'a', 'e', 'h', 'd', 'v', '1', '2', '3', '4']) {
      assert.equal(resolveCanvasHotkey(keyEvent(key, monacoInputarea())), null, `key ${key}`);
    }
  });

  it('never fires Monaco modifier shortcuts (Monaco keeps Ctrl/Cmd+D/G)', () => {
    const monaco = monacoInputarea();
    assert.equal(resolveCanvasHotkey(keyEvent('d', monaco, { ctrlKey: true })), null);
    assert.equal(resolveCanvasHotkey(keyEvent('d', monaco, { metaKey: true })), null);
    assert.equal(resolveCanvasHotkey(keyEvent('g', monaco, { ctrlKey: true })), null);
    assert.equal(resolveCanvasHotkey(keyEvent('g', monaco, { metaKey: true, shiftKey: true })), null);
  });

  it('never fires inside standard editables (search/rename inputs)', () => {
    assert.equal(resolveCanvasHotkey(keyEvent('c', el('INPUT'))), null);
    assert.equal(resolveCanvasHotkey(keyEvent('c', el('TEXTAREA'))), null);
    assert.equal(resolveCanvasHotkey(keyEvent('r', el('DIV', { isContentEditable: true }))), null);
  });

  it('still fires tool shortcuts on the whiteboard surface', () => {
    const board = el('DIV');
    assert.deepEqual(resolveCanvasHotkey(keyEvent('c', board)), { type: 'tool', tool: 'circle' });
    assert.deepEqual(resolveCanvasHotkey(keyEvent('l', board)), { type: 'tool', tool: 'line' });
    assert.deepEqual(resolveCanvasHotkey(keyEvent('p', board)), { type: 'tool', tool: 'freehand' });
    assert.deepEqual(resolveCanvasHotkey(keyEvent('r', board)), { type: 'tool', tool: 'rectangle' });
    assert.deepEqual(resolveCanvasHotkey(keyEvent('t', board)), { type: 'tool', tool: 'text' });
    assert.deepEqual(resolveCanvasHotkey(keyEvent('1', board)), { type: 'tool', tool: 'select' });
    assert.deepEqual(resolveCanvasHotkey(keyEvent('2', board)), { type: 'tool', tool: 'rectangle' });
    assert.deepEqual(resolveCanvasHotkey(keyEvent('3', board)), { type: 'tool', tool: 'circle' });
    assert.deepEqual(resolveCanvasHotkey(keyEvent('4', board)), { type: 'tool', tool: 'diamond' });
  });

  it('still fires operation shortcuts outside editors', () => {
    const board = el('CANVAS');
    assert.deepEqual(resolveCanvasHotkey(keyEvent('d', board, { ctrlKey: true })), { type: 'duplicate' });
    assert.deepEqual(resolveCanvasHotkey(keyEvent('d', board, { metaKey: true })), { type: 'duplicate' });
    assert.deepEqual(resolveCanvasHotkey(keyEvent('g', board, { ctrlKey: true })), {
      type: 'group',
      ungroup: false,
    });
    assert.deepEqual(resolveCanvasHotkey(keyEvent('g', board, { ctrlKey: true, shiftKey: true })), {
      type: 'group',
      ungroup: true,
    });
  });

  it('ignores unbound keys, alt combos, and the text overlay', () => {
    const board = el('DIV');
    assert.equal(resolveCanvasHotkey(keyEvent('q', board)), null);
    assert.equal(resolveCanvasHotkey(keyEvent('g', board, { altKey: true })), null);
    assert.equal(resolveCanvasHotkey(keyEvent('x', board, { ctrlKey: true })), null);
    assert.equal(resolveCanvasHotkey(keyEvent('c', board), { textEditor: {} }), null);
    assert.equal(resolveCanvasHotkey(keyEvent('c', board), { textEditor: null }).tool, 'circle');
  });
});
