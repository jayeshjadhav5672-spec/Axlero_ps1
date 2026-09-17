import React, { Component, useCallback, useEffect, useRef, useState } from 'react';
import CanvasStage from './CanvasStage';
import TextEditorOverlay from './TextEditorOverlay';
import Toolbar from './Toolbar';
import MermaidModal from './MermaidModal';
import useImageDrop from './useImageDrop.js';
import PropertySidebar, { shouldShowPropertiesPanel } from './PropertySidebar';
import useCanvasDrawing from './useCanvasDrawing';
import { DEFAULTS, FONT_FAMILIES, duplicateShape, elbowPoints, morphShape } from './utils/shapes.js';
import {
  exportAVIF,
  exportJSON,
  exportPDF,
  exportSVG,
  prepareStageForExport,
} from './utils/exportHub.js';
import { exportCanvasDirect } from '../../utils/exportUtils.js';

/**
 * PopoverErrorBoundary — last-resort guard around the 3-dot customization
 * popover. A render fault inside the panel must degrade to a small inline
 * fallback, never to a full-viewport whiteout (an uncaught error would
 * unmount the entire React tree since there is no root boundary).
 */
class PopoverErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Customize popover failed to render:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <p className="font-semibold">Customization unavailable</p>
          <p className="mt-1 text-rose-600">Close the panel and try again.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Whiteboard — Sayon, Interactive Whiteboard / Konva.js Engineer
 * Excalidraw-styled shell: top-center floating tool island, top-left
 * contextual property sidebar, bottom zoom/status pill, cream canvas.
 *
 * CANONICAL export of the SyncSpace whiteboard subsystem.
 * `Canvas` remains as a backwards-compatible alias (existing `main.jsx`
 * and Avantee shell imports keep working unchanged).
 *
 * Collaboration-ready boundary: shapes are plain serializable JSON with
 * stable `shape-<uuid>` ids. No Socket.io / Yjs imports here.
 *
 * Props (all optional for standalone use; wired by Avantee/Shree):
 * - shapes: controlled shape array (external/Yjs state). Omit for local state.
 * - selectedShapeId: controlled selection. Omit for local selection.
 * - tool, color, strokeWidth, fill/backgroundColor, strokeStyle, opacity,
 *   roughness, roundness, startArrowhead, endArrowhead, fontFamily,
 *   fontSize, textAlign: optionally controlled.
 * - onToolChange, onColorChange, onStrokeWidthChange, onFillChange,
 *   onStrokeStyleChange, onOpacityChange, onRoughnessChange,
 *   onRoundnessChange, onStartArrowheadChange, onEndArrowheadChange,
 *   onFontFamilyChange, onFontSizeChange, onTextAlignChange:
 *   fire in both modes.
 * - onShapeCreate(shape), onShapeUpdate(shapeId, changes),
 *   onShapeDelete(shapeId), onCanvasClear(), onSelectionChange(shapeId),
 *   onShapesReorder(nextShapes)
 */
export function Whiteboard({
  shapes: controlledShapes,
  selectedShapeId: controlledSelection,
  tool: controlledTool,
  color: controlledColor,
  strokeWidth: controlledWidth,
  fill: controlledFill,
  backgroundColor: controlledBackground,
  strokeStyle: controlledStrokeStyle,
  opacity: controlledOpacity,
  roughness: controlledRoughness,
  roundness: controlledRoundness,
  startArrowhead: controlledStartArrowhead,
  endArrowhead: controlledEndArrowhead,
  arrowType: controlledArrowType,
  fontFamily: controlledFontFamily,
  fontFamilyKey: controlledFontFamilyKey,
  fontSize: controlledFontSize,
  textAlign: controlledTextAlign,
  align: controlledAlign,
  onToolChange,
  onColorChange,
  onStrokeWidthChange,
  onFillChange,
  onBackgroundChange,
  onStrokeStyleChange,
  onOpacityChange,
  onRoughnessChange,
  onRoundnessChange,
  onStartArrowheadChange,
  onEndArrowheadChange,
  onArrowTypeChange,
  onFontFamilyChange,
  onFontSizeChange,
  onTextAlignChange,
  onAlignChange,
  onShapeCreate,
  onShapeUpdate,
  onShapeDelete,
  onCanvasClear,
  onShapesReorder,
  onSelectionChange,
} = {}) {
  const [internalTool, setInternalTool] = useState('select');
  const [internalColor, setInternalColor] = useState('#1e1e1e');
  const [internalWidth, setInternalWidth] = useState(4);
  const [internalFill, setInternalFill] = useState('transparent');
  const [internalStrokeStyle, setInternalStrokeStyle] = useState('solid');
  const [internalOpacity, setInternalOpacity] = useState(1);
  const [internalRoughness, setInternalRoughness] = useState(DEFAULTS.roughness);
  const [internalRoundness, setInternalRoundness] = useState(DEFAULTS.roundness);
  const [internalStartArrowhead, setInternalStartArrowhead] = useState(DEFAULTS.startArrowhead);
  const [internalEndArrowhead, setInternalEndArrowhead] = useState(DEFAULTS.endArrowhead);
  const [internalArrowType, setInternalArrowType] = useState(DEFAULTS.arrowType);
  const [internalFontFamilyKey, setInternalFontFamilyKey] = useState(DEFAULTS.fontFamilyKey);
  const [internalFontSize, setInternalFontSize] = useState(DEFAULTS.fontSize);
  const [internalTextAlign, setInternalTextAlign] = useState(DEFAULTS.textAlign);
  // 3-dot customization popover (anchored under the toolbar's 3-dot end).
  // The panel stays mounted while open so pickers/sliders never lose focus
  // mid-gesture; it closes via the backdrop, the X button, Escape, or when
  // the current tool/selection offers nothing to customize.
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  // Week-2 productivity toolset: auto-detect toggle, mermaid modal,
  // hidden image file input, export status toast.
  const [autoDetect, setAutoDetect] = useState(false);
  const [isMermaidOpen, setIsMermaidOpen] = useState(false);
  const [exportNote, setExportNote] = useState('');
  const fileInputRef = useRef(null);
  const canvasWrapRef = useRef(null);

  const tool = controlledTool ?? internalTool;
  const color = controlledColor ?? internalColor;
  const strokeWidth = controlledWidth ?? internalWidth;
  const fill = controlledFill ?? controlledBackground ?? internalFill;
  const strokeStyle = controlledStrokeStyle ?? internalStrokeStyle;
  const opacity = controlledOpacity ?? internalOpacity;
  const roughness = controlledRoughness ?? internalRoughness;
  const roundness = controlledRoundness ?? internalRoundness;
  const startArrowhead = controlledStartArrowhead ?? internalStartArrowhead;
  const endArrowhead = controlledEndArrowhead ?? internalEndArrowhead;
  const arrowType = controlledArrowType ?? internalArrowType;
  const fontFamilyKey = controlledFontFamilyKey ?? internalFontFamilyKey;
  const fontFamily = controlledFontFamily ?? FONT_FAMILIES[fontFamilyKey] ?? FONT_FAMILIES.hand;
  const fontSize = controlledFontSize ?? internalFontSize;
  const textAlign = controlledTextAlign ?? controlledAlign ?? internalTextAlign;

  const handleToolChange = useCallback(
    (next) => {
      if (controlledTool === undefined) setInternalTool(next);
      onToolChange?.(next);
    },
    [controlledTool, onToolChange],
  );
  const handleColorChange = useCallback(
    (next) => {
      if (controlledColor === undefined) setInternalColor(next);
      onColorChange?.(next);
    },
    [controlledColor, onColorChange],
  );
  const handleWidthChange = useCallback(
    (next) => {
      if (controlledWidth === undefined) setInternalWidth(next);
      onStrokeWidthChange?.(next);
    },
    [controlledWidth, onStrokeWidthChange],
  );
  const handleFillChange = useCallback(
    (next) => {
      if (controlledFill === undefined && controlledBackground === undefined) {
        setInternalFill(next);
      }
      onFillChange?.(next);
      onBackgroundChange?.(next);
    },
    [controlledBackground, controlledFill, onBackgroundChange, onFillChange],
  );
  const handleStrokeStyleChange = useCallback(
    (next) => {
      if (controlledStrokeStyle === undefined) setInternalStrokeStyle(next);
      onStrokeStyleChange?.(next);
    },
    [controlledStrokeStyle, onStrokeStyleChange],
  );
  const handleOpacityChange = useCallback(
    (next) => {
      if (controlledOpacity === undefined) setInternalOpacity(next);
      onOpacityChange?.(next);
    },
    [controlledOpacity, onOpacityChange],
  );
  const handleRoughnessChange = useCallback(
    (next) => {
      if (controlledRoughness === undefined) setInternalRoughness(next);
      onRoughnessChange?.(next);
    },
    [controlledRoughness, onRoughnessChange],
  );
  const handleRoundnessChange = useCallback(
    (next) => {
      if (controlledRoundness === undefined) setInternalRoundness(next);
      onRoundnessChange?.(next);
    },
    [controlledRoundness, onRoundnessChange],
  );
  const handleStartArrowheadChange = useCallback(
    (next) => {
      if (controlledStartArrowhead === undefined) setInternalStartArrowhead(next);
      onStartArrowheadChange?.(next);
    },
    [controlledStartArrowhead, onStartArrowheadChange],
  );
  const handleEndArrowheadChange = useCallback(
    (next) => {
      if (controlledEndArrowhead === undefined) setInternalEndArrowhead(next);
      onEndArrowheadChange?.(next);
    },
    [controlledEndArrowhead, onEndArrowheadChange],
  );
  const handleArrowTypeChange = useCallback(
    (next) => {
      if (controlledArrowType === undefined) setInternalArrowType(next);
      onArrowTypeChange?.(next);
    },
    [controlledArrowType, onArrowTypeChange],
  );
  const handleFontFamilyChange = useCallback(
    (nextKey) => {
      if (controlledFontFamilyKey === undefined) setInternalFontFamilyKey(nextKey);
      onFontFamilyChange?.(nextKey, FONT_FAMILIES[nextKey]);
    },
    [controlledFontFamilyKey, onFontFamilyChange],
  );
  const handleFontSizeChange = useCallback(
    (next) => {
      if (controlledFontSize === undefined) setInternalFontSize(next);
      onFontSizeChange?.(next);
    },
    [controlledFontSize, onFontSizeChange],
  );
  const handleTextAlignChange = useCallback(
    (next) => {
      if (controlledTextAlign === undefined && controlledAlign === undefined) {
        setInternalTextAlign(next);
      }
      onTextAlignChange?.(next);
      onAlignChange?.(next);
    },
    [controlledAlign, controlledTextAlign, onAlignChange, onTextAlignChange],
  );

  // The active tool persists after every commit — including the text
  // tool, which stays on 'text' after each placed block so users can
  // keep clicking to add more text without re-picking T. Tool changes
  // happen only via explicit user action (toolbar, shortcuts).
  // Kept as a stable no-op callback to preserve the `onDrawingCommitted`
  // integration boundary with useCanvasDrawing.
  const handleDrawingCommitted = useCallback(
    (committedTool) => {
      // Do not auto-switch to select; let the active tool persist
    },
    [],
  );

  const {
    visibleShapes,
    selectedId,
    textEditor,
    scale,
    stagePos,
    stageRef,
    shapeNodesRef,
    transformerRef,
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
    handleWheel,
    handleDragStageEnd,
    handleZoomChange,
    handleShapeClick,
    handleShapeSelect,
    handleShapeDragStart,
    handleShapeDragEnd,
    handleTransformEnd,
    openTextEditorForShape,
    commitTextEditor,
    cancelTextEditor,
    deleteSelected,
    clearCanvas,
    selectShape,
    commitCreate,
    commitUpdate,
    sendToBack,
    bringToFront,
    sendBackward,
    bringForward,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useCanvasDrawing({
    tool,
    color,
    strokeWidth,
    fill,
    strokeStyle,
    opacity,
    roughness,
    roundness,
    startArrowhead,
    endArrowhead,
    arrowType,
    fontFamily,
    fontFamilyKey,
    fontSize,
    textAlign,
    shapes: controlledShapes,
    selectedShapeId: controlledSelection,
    onShapeCreate,
    onShapeUpdate,
    onShapeDelete,
    onCanvasClear,
    onShapesReorder,
    onSelectionChange,
    onDrawingCommitted: handleDrawingCommitted,
    autoDetect,
  });

  const selectedShape = visibleShapes.find((s) => s.id === selectedId) ?? null;

  // 3-dot popover availability mirrors the sidebar's own visibility gate.
  // The toggle only appears when there is something to customize.
  const panelAvailable = shouldShowPropertiesPanel({
    activeTool: tool,
    selectedShape,
    hasSelection: Boolean(selectedId),
  });
  const toggleCustomize = useCallback(() => setIsCustomizeOpen((v) => !v), []);
  // Auto-close when the panel has nothing to show (e.g. switched to hand
  // or cleared the selection in select mode).
  useEffect(() => {
    if (!panelAvailable) setIsCustomizeOpen(false);
  }, [panelAvailable]);
  // Escape closes the popover (selection/deselect shortcuts keep working).
  useEffect(() => {
    if (!isCustomizeOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setIsCustomizeOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCustomizeOpen]);

  // Inspector values: reflect the live selection when present (Excalidraw
  // parity), otherwise fall back to the next-shape tool defaults.
  const inspectorColor = selectedShape
    ? (selectedShape.type === 'text' ? (selectedShape.fill ?? color) : (selectedShape.stroke ?? color))
    : color;
  const inspectorFill = selectedShape ? (selectedShape.fill ?? fill) : fill;
  const inspectorWidth = selectedShape?.strokeWidth ?? strokeWidth;
  const inspectorStyle = selectedShape?.strokeStyle ?? strokeStyle;
  const inspectorOpacity = selectedShape?.opacity ?? opacity;
  const inspectorRoughness = selectedShape?.roughness ?? roughness;
  const inspectorRoundness = selectedShape?.roundness ?? roundness;
  const inspectorStartArrowhead = selectedShape?.startArrowhead ?? startArrowhead;
  const inspectorEndArrowhead =
    selectedShape?.endArrowhead ?? (selectedShape?.type === 'arrow' ? 'arrow' : endArrowhead);
  const inspectorArrowType = selectedShape?.arrowType ?? arrowType ?? DEFAULTS.arrowType;
  const inspectorFontKey = selectedShape?.fontFamilyKey ?? fontFamilyKey;
  const inspectorFontSize = selectedShape?.fontSize ?? fontSize;
  const inspectorAlign = selectedShape?.textAlign ?? selectedShape?.align ?? textAlign;

  // Excalidraw-style: style picks apply to the current selection too.
  const stylizeSelection = useCallback(
    (changes) => {
      if (selectedId) commitUpdate(selectedId, changes);
    },
    [commitUpdate, selectedId],
  );

  const handleSidebarColor = useCallback(
    (next) => {
      handleColorChange(next);
      if (!selectedId || !selectedShape) return;
      if (selectedShape.type === 'text') stylizeSelection({ fill: next });
      else if (selectedShape.type === 'arrow') {
        stylizeSelection({ stroke: next, fill: next });
      } else stylizeSelection({ stroke: next });
    },
    [handleColorChange, selectedId, selectedShape, stylizeSelection],
  );
  const handleSidebarFill = useCallback(
    (next) => {
      handleFillChange(next);
      if (selectedId) stylizeSelection({ fill: next });
    },
    [handleFillChange, selectedId, stylizeSelection],
  );
  const handleSidebarWidth = useCallback(
    (next) => {
      handleWidthChange(next);
      if (selectedId) stylizeSelection({ strokeWidth: next });
    },
    [handleWidthChange, selectedId, stylizeSelection],
  );
  const handleSidebarStyle = useCallback(
    (next) => {
      handleStrokeStyleChange(next);
      if (selectedId) stylizeSelection({ strokeStyle: next });
    },
    [handleStrokeStyleChange, selectedId, stylizeSelection],
  );
  const handleSidebarOpacity = useCallback(
    (next) => {
      handleOpacityChange(next);
      if (selectedId) stylizeSelection({ opacity: next });
    },
    [handleOpacityChange, selectedId, stylizeSelection],
  );
  const handleSidebarRoughness = useCallback(
    (next) => {
      handleRoughnessChange(next);
      if (selectedId) stylizeSelection({ roughness: next });
    },
    [handleRoughnessChange, selectedId, stylizeSelection],
  );
  const handleSidebarRoundness = useCallback(
    (next) => {
      handleRoundnessChange(next);
      if (selectedId) stylizeSelection({ roundness: next });
    },
    [handleRoundnessChange, selectedId, stylizeSelection],
  );
  const handleSidebarStartArrowhead = useCallback(
    (next) => {
      handleStartArrowheadChange(next);
      if (selectedId) stylizeSelection({ startArrowhead: next });
    },
    [handleStartArrowheadChange, selectedId, stylizeSelection],
  );
  const handleSidebarEndArrowhead = useCallback(
    (next) => {
      handleEndArrowheadChange(next);
      if (selectedId) stylizeSelection({ endArrowhead: next });
    },
    [handleEndArrowheadChange, selectedId, stylizeSelection],
  );
  // Arrow-type picker: connects the sidebar buttons directly to canvas
  // curvature. Switching type rewrites the selected arrow's points so the
  // change is visible immediately (a 2-point arrow has no midpoint for
  // Konva tension to smooth, so Curved injects a perpendicular-offset
  // midpoint; Straight collapses bends back to endpoints; Elbow
  // materializes the orthogonal corner). Commits flow through the single
  // onShapeUpdate JSON boundary. With no arrow selected, only the tool
  // default is updated.
  const handleSidebarArrowType = useCallback(
    (next) => {
      handleArrowTypeChange(next);
      if (!selectedId || !selectedShape || selectedShape.type !== 'arrow') return;
      const pts = Array.isArray(selectedShape.points)
        ? selectedShape.points.filter((v) => typeof v === 'number' && Number.isFinite(v))
        : [];
      if (pts.length < 4) {
        stylizeSelection({ arrowType: next });
        return;
      }
      if (next === 'curved') {
        if (pts.length === 4) {
          const midX = (pts[0] + pts[2]) / 2 - (pts[3] - pts[1]) * 0.2;
          const midY = (pts[1] + pts[3]) / 2 + (pts[2] - pts[0]) * 0.2;
          if (Number.isFinite(midX) && Number.isFinite(midY)) {
            stylizeSelection({
              arrowType: 'curved',
              tension: 0.35,
              points: [pts[0], pts[1], midX, midY, pts[2], pts[3]],
            });
            return;
          }
        }
        stylizeSelection({ arrowType: 'curved', tension: 0.35 });
      } else if (next === 'straight') {
        stylizeSelection({
          arrowType: 'straight',
          tension: 0,
          points: [pts[0], pts[1], pts[pts.length - 2], pts[pts.length - 1]],
        });
      } else if (next === 'elbow') {
        stylizeSelection({
          arrowType: 'elbow',
          tension: 0,
          points: pts.length === 4 ? elbowPoints(pts) : pts,
        });
      } else {
        stylizeSelection({ arrowType: next });
      }
    },
    [handleArrowTypeChange, selectedId, selectedShape, stylizeSelection],
  );
  const handleSidebarFontFamily = useCallback(
    (nextKey) => {
      handleFontFamilyChange(nextKey);
      if (selectedId) {
        stylizeSelection({
          fontFamilyKey: nextKey,
          fontFamily: FONT_FAMILIES[nextKey] ?? FONT_FAMILIES.hand,
        });
      }
    },
    [handleFontFamilyChange, selectedId, stylizeSelection],
  );
  const handleSidebarFontSize = useCallback(
    (next) => {
      handleFontSizeChange(next);
      if (selectedId) stylizeSelection({ fontSize: next });
    },
    [handleFontSizeChange, selectedId, stylizeSelection],
  );
  const handleSidebarTextAlign = useCallback(
    (next) => {
      handleTextAlignChange(next);
      if (selectedId) stylizeSelection({ textAlign: next, align: next });
    },
    [handleTextAlignChange, selectedId, stylizeSelection],
  );

  const handleDuplicate = useCallback(() => {    if (!selectedShape) return;
    // Clone beside the original with a small (+15px x/y) offset, then
    // select the copy. commitCreate/selectShape fire the Yjs/CRDT
    // onShapeCreate + onSelectionChange triggers as usual.
    const clone = duplicateShape(selectedShape, 15);
    if (!clone) return;
    commitCreate(clone);
    selectShape(clone.id);
  }, [commitCreate, selectShape, selectedShape]);

  // ---- shape morph: rectangle <-> circle <-> diamond in place ----
  // Geometry is rebuilt from the visual bounding box (rects use top-left
  // origin + w/h; circles use center + radius), so the shape never
  // collapses or teleports. Commits flow through the single onShapeUpdate
  // JSON boundary; morphShape builds the target fresh (no stale keys),
  // and normalizeShape strips any ghost geometry on merge.
  const handleConvertShape = useCallback(
    (targetType) => {
      if (!selectedShape || !selectedId) return;
      if (
        selectedShape.type !== 'rectangle' &&
        selectedShape.type !== 'circle' &&
        selectedShape.type !== 'diamond'
      ) {
        return;
      }
      const converted = morphShape(selectedShape, targetType);
      // morphShape returns the input ref when nothing changes (same type,
      // degenerate geometry, unsupported target) — no update to dispatch.
      if (!converted || converted === selectedShape) return;
      const { id, ...changes } = converted;
      void id;
      commitUpdate(selectedId, changes);
    },
    [commitUpdate, selectedId, selectedShape],
  );

  // ---- Week-2 productivity: image import (picker + paste + drop) ----
  const handleImageCreate = useCallback(
    (shape) => {
      commitCreate(shape);
      selectShape(shape.id);
    },
    [commitCreate, selectShape],
  );
  const { importFiles } = useImageDrop({
    stageRef,
    containerRef: canvasWrapRef,
    onImageCreate: handleImageCreate,
  });
  const handleInsertImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  const handleFileInputChange = useCallback(
    (event) => {
      const files = event.target.files;
      if (files && files.length > 0) importFiles(files);
      // Reset so picking the same file twice still fires change.
      event.target.value = '';
    },
    [importFiles],
  );

  // ---- auto-detect is locked to the Pen tool: enabling it from any
  // other tool first switches to Pen; recognition itself is additionally
  // guarded in useCanvasDrawing (tool === pen/freehand && autoDetect). ----
  const handleToggleAutoDetect = useCallback(() => {
    setAutoDetect((v) => {
      if (!v && tool !== 'pen' && tool !== 'freehand') handleToolChange('freehand');
      return !v;
    });
  }, [handleToolChange, tool]);
  // ---- Week-2 productivity: Mermaid compile -> append native shapes ----
  const handleMermaidCompile = useCallback(
    (newShapes) => {
      if (!Array.isArray(newShapes) || newShapes.length === 0) return;
      let lastId = null;
      for (const s of newShapes) {
        commitCreate(s);
        lastId = s.id;
      }
      if (lastId) selectShape(lastId);
    },
    [commitCreate, selectShape],
  );

  // ---- Week-2 productivity: universal export hub ----
  const flashExportNote = useCallback((text) => {
    setExportNote(text);
    window.setTimeout(() => {
      setExportNote((cur) => (cur === text ? '' : cur));
    }, 3200);
  }, []);
  const handleExport = useCallback(
    async (format) => {
      // Deselect + hide Transformer BEFORE capture so selection outlines
      // never bake into the exported image.
      prepareStageForExport({ stageRef, transformerRef, selectShape });
      // Let the detach render flush before reading pixels.
      await new Promise((r) => setTimeout(r, 30));
      const stage = stageRef.current;
      try {
        switch (format) {
          case 'json':
            exportJSON(visibleShapes, 'syncspace-board.json');
            flashExportNote('Exported JSON');
            break;
          case 'png':
            // Bulletproof direct-DOM raster path: zero props, zero Konva
            // refs (survives a dead stageRef chain); hides/restores the
            // Transformer itself and bakes a white background.
            exportCanvasDirect('png', 'syncspace-board');
            flashExportNote('Exported PNG');
            break;
          case 'jpeg':
            exportCanvasDirect('jpeg', 'syncspace-board');
            flashExportNote('Exported JPEG');
            break;
          case 'avif': {
            if (!stage) throw new Error('Canvas not ready');
            const { fallback } = await exportAVIF(stage, 'syncspace-board.avif');
            flashExportNote(fallback ? 'AVIF unsupported — exported PNG instead' : 'Exported AVIF');
            break;
          }
          case 'svg':
            exportSVG(visibleShapes, 'syncspace-board.svg');
            flashExportNote('Exported SVG');
            break;
          case 'pdf':
            if (!stage) throw new Error('Canvas not ready');
            await exportPDF(stage, visibleShapes, 'syncspace-board.pdf');
            flashExportNote('Exported PDF');
            break;
          default:
            break;
        }
      } catch (err) {
        flashExportNote(err?.message ?? 'Export failed');
      }
    },
    [flashExportNote, selectShape, stageRef, transformerRef, visibleShapes],
  );

  // ---- bent arrows: one committed `{ points }` update per bend gesture ----
  const handleBendCommit = useCallback(
    (shapeId, points) => {
      commitUpdate(shapeId, { points });
    },
    [commitUpdate],
  );
  const handleStraighten = useCallback(() => {
    if (!selectedShape || selectedShape.type !== 'arrow') return;
    const p = selectedShape.points ?? [];
    if (p.length <= 4) return;
    commitUpdate(selectedShape.id, { points: [p[0], p[1], p[p.length - 2], p[p.length - 1]] });
  }, [commitUpdate, selectedShape]);

  // ---- z-order actions (sidebar buttons + [ ] shortcuts below) ----
  const handleBringToFront = useCallback(() => {
    if (selectedId) bringToFront(selectedId);
  }, [bringToFront, selectedId]);
  const handleSendToBack = useCallback(() => {
    if (selectedId) sendToBack(selectedId);
  }, [selectedId, sendToBack]);
  const handleBringForward = useCallback(() => {
    if (selectedId) bringForward(selectedId);
  }, [bringForward, selectedId]);
  const handleSendBackward = useCallback(() => {
    if (selectedId) sendBackward(selectedId);
  }, [selectedId, sendBackward]);

  // ---- keyboard shortcuts (ignored while typing / editing text) ----
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (textEditor) return;
      const k = event.key.toLowerCase();
      const map = {
        1: 'select',
        v: 'select',
        2: 'rectangle',
        r: 'rectangle',
        3: 'circle',
        c: 'circle',
        4: 'diamond',
        d: 'diamond',
        a: 'arrow',
        l: 'line',
        p: 'freehand',
        f: 'frame',
        t: 'text',
        e: 'eraser',
        h: 'pan',
      };
      const next = map[k];
      if (next) {
        event.preventDefault();
        handleToolChange(next);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleToolChange, textEditor]);

  return (
    <div className="flex h-full min-h-[520px] min-w-0 w-full flex-1 flex-col">
      {/* Header row: full-width toolbar bar. The header sits above
      the popover backdrop (relative z-50) so tools and the 3-dot toggle
      stay interactive while the panel is open. */}
      <div className="relative z-50 w-full shrink-0">
        <div className="relative w-full min-w-0">
            <Toolbar
              tool={tool}
              onToolChange={handleToolChange}
              zoom={scale}
              shapes={visibleShapes}
              onZoomChange={handleZoomChange}
              onUndo={undo}
              onRedo={redo}
              canUndo={canUndo}
              canRedo={canRedo}
              onClear={clearCanvas}
              showPropertiesToggle={panelAvailable}
              isPropertiesOpen={isCustomizeOpen}
              onToggleProperties={toggleCustomize}
              onInsertImage={handleInsertImage}
              autoDetect={autoDetect}
              onToggleAutoDetect={handleToggleAutoDetect}
              onOpenMermaid={() => setIsMermaidOpen(true)}
              onExport={handleExport}
            />
            {isCustomizeOpen && panelAvailable && (
              <>
                {/* Invisible click-outside backdrop */}
                <div
                  className="fixed inset-0 z-40 bg-transparent"
                  onClick={() => setIsCustomizeOpen(false)}
                />
                {/* Floating customize panel: compact card pinned under the
                3-dot end of the toolbar (NOT fullscreen — a positioning
                fault here must never obscure the viewport). Render faults
                degrade to the boundary fallback, never a whiteout. */}
                <div
                  role="dialog"
                  aria-label="Customize shape properties"
                  className="absolute right-0 top-full mt-2 z-50 w-72 max-h-[75vh] overflow-y-auto bg-white rounded-2xl border border-gray-200 shadow-2xl p-4"
                >
                  <div className="flex items-center justify-between pb-2 mb-3 border-b border-gray-100">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Properties
                    </span>
                    <button
                      onClick={() => setIsCustomizeOpen(false)}
                      title="Close customization panel (Esc)"
                      aria-label="Close customization panel"
                      className="text-gray-400 hover:text-gray-700 text-sm font-bold px-1"
                    >
                      ✕
                    </button>
                  </div>
                  <PopoverErrorBoundary key={`${tool}-${selectedId ?? 'none'}`}>
                  <PropertySidebar
                  color={inspectorColor}
                  fill={inspectorFill}
                  strokeWidth={inspectorWidth}
                  strokeStyle={inspectorStyle}
                  opacity={inspectorOpacity}
                  roughness={inspectorRoughness}
                  roundness={inspectorRoundness}
                  startArrowhead={inspectorStartArrowhead}
                  endArrowhead={inspectorEndArrowhead}
                  arrowType={inspectorArrowType}
                  fontFamilyKey={inspectorFontKey}
                  fontSize={inspectorFontSize}
                  textAlign={inspectorAlign}
                  align={inspectorAlign}
                  activeTool={tool}
                  tool={tool}
                  hasSelection={Boolean(selectedId)}
                  selectedShape={selectedShape}
                  onColorChange={handleSidebarColor}
                  onFillChange={handleSidebarFill}
                  onStrokeWidthChange={handleSidebarWidth}
                  onStrokeStyleChange={handleSidebarStyle}
                  onOpacityChange={handleSidebarOpacity}
                  onRoughnessChange={handleSidebarRoughness}
                  onRoundnessChange={handleSidebarRoundness}
                  onStartArrowheadChange={handleSidebarStartArrowhead}
                  onEndArrowheadChange={handleSidebarEndArrowhead}
                  onArrowTypeChange={handleSidebarArrowType}
                  onFontFamilyChange={handleSidebarFontFamily}
                  onFontSizeChange={handleSidebarFontSize}
                  onTextAlignChange={handleSidebarTextAlign}
                  onAlignChange={handleSidebarTextAlign}
                  onDuplicate={handleDuplicate}
                  onDelete={deleteSelected}
                  onClear={clearCanvas}
                  onConvertShape={handleConvertShape}
                  onStraighten={handleStraighten}
                  onBringToFront={handleBringToFront}
                  onSendToBack={handleSendToBack}
                  onBringForward={handleBringForward}
                  onSendBackward={handleSendBackward}
                  />
                  </PopoverErrorBoundary>
                </div>
              </>
            )}
          </div>
      </div>
      {/* Expanded canvas boundary: fills all remaining height/width. */}
      <section className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-[#f8f9fa] shadow-sm">
      <div className="relative min-h-0 flex-1" ref={canvasWrapRef}>
        <div className="relative h-full min-h-[420px] overflow-hidden">
          <CanvasStage
            shapes={visibleShapes}
            selectedId={selectedId}
            tool={tool}
            scale={scale}
            stagePos={stagePos}
            stageRef={stageRef}
            shapeNodesRef={shapeNodesRef}
            transformerRef={transformerRef}
            onPointerDown={handleStageMouseDown}
            onPointerMove={handleStageMouseMove}
            onPointerUp={handleStageMouseUp}
            onWheel={handleWheel}
            onDragStageEnd={handleDragStageEnd}
            onShapeClick={handleShapeClick}
            onShapeSelect={handleShapeSelect}
            onShapeDragEnd={handleShapeDragEnd}
            onShapeDragStart={handleShapeDragStart}
            onTransformEnd={handleTransformEnd}
            onTextDoubleClick={openTextEditorForShape}
            onBendCommit={handleBendCommit}
          />
          <TextEditorOverlay
            editor={textEditor}
            color={color}
            onCommit={commitTextEditor}
            onCancel={cancelTextEditor}
          />
          {exportNote && (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none absolute bottom-4 left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900 px-4 py-1.5 text-xs font-medium text-white shadow-lg"
            >
              {exportNote}
            </div>
          )}
        </div>
      </div>
      </section>
      {/* Hidden file picker for Insert Image (also: drag & drop, Ctrl/⌘+V). */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        aria-hidden="true"
        tabIndex={-1}
        className="hidden"
        onChange={handleFileInputChange}
      />
      <MermaidModal
        open={isMermaidOpen}
        onClose={() => setIsMermaidOpen(false)}
        onCompile={handleMermaidCompile}
        styleDefaults={{ color, strokeWidth, fontSize, fontFamily, fontFamilyKey }}
      />
    </div>
  );
}

// P0 integration contract: Whiteboard is canonical;
// Canvas stays as a backwards-compatible alias.
export { Whiteboard as Canvas, Whiteboard as default };
