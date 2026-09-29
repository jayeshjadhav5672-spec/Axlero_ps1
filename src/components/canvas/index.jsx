import React, { Component, useCallback, useEffect, useRef, useState } from 'react';
import CanvasStage from './CanvasStage';
import TextEditorOverlay from './TextEditorOverlay';
import Toolbar from './Toolbar';
import MermaidModal from './MermaidModal';
import useImageDrop from './useImageDrop.js';
import PropertySidebar, { shouldShowPropertiesPanel } from './PropertySidebar';
import useCanvasDrawing from './useCanvasDrawing';
import useCanvasHotkeys from './hooks/useCanvasHotkeys.js';
import { PresenceCursors, usePresenceCursors } from './presence/index.js';
import useRemoteSelection from './presence/useRemoteSelection.js';
import { getSocket } from '../../lib/socket.js';
import { colorForId, getOrCreateIdentity, getRoomIdFromUrl } from '../../lib/room.js';
import { DEFAULTS, FONT_FAMILIES, duplicateShape, elbowPoints, morphShape } from './utils/shapes.js';
import {
  exportAVIF,
  exportJPEG,
  exportJSON,
  exportPDF,
  exportPNG,
  exportSelectedJPEG,
  exportSelectedPNG,
  exportSVG,
  prepareStageForExport,
} from './utils/exportHub.js';

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
 * - roomId, socket: realtime transport identity for pen-stroke streaming
 *   and presence. When omitted, roomId falls back to `?room=` at mount and
 *   socket to the shared singleton — pass the shell's live `roomId` so a
 *   room switch without remount can never leave streaming on a stale room.
 */
export function Whiteboard({
  shapes: controlledShapes,
  selectedShapeId: controlledSelection,
  roomId: roomIdProp,
  socket: socketProp,
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

  // Room-scoped realtime transports (streaming + presence + tool/viewport
  // sync) share one socket/room pair, declared up here so every handler
  // below can close over them (dep arrays evaluate eagerly — declaring
  // these below first use would TDZ-crash the board). Explicit props win
  // (the shell's live roomId tracks room switches without a remount);
  // otherwise fall back to `?room=` at mount and the shared singleton —
  // standalone boards simply stay local-only.
  const urlRoomId = React.useMemo(() => {
    try {
      return getRoomIdFromUrl();
    } catch {
      return null;
    }
  }, []);
  const fallbackSocket = React.useMemo(() => {
    try {
      return getSocket();
    } catch {
      return null;
    }
  }, []);
  const streamRoomId = roomIdProp ?? urlRoomId;
  const streamSocket = socketProp ?? fallbackSocket;

  const handleToolChange = useCallback(
    (next, opts = {}) => {
      if (controlledTool === undefined) setInternalTool(next);
      onToolChange?.(next);
      // Shared toolbar: broadcast local tool switches so room peers mirror
      // the active tool. Remote applies pass { fromRemote: true } and never
      // re-emit (loop-free). No socket/room → local-only as before.
      if (!opts.fromRemote && typeof next === 'string') {
        try {
          if (streamSocket && typeof streamSocket.emit === 'function' && streamRoomId && streamSocket.connected !== false) {
            streamSocket.emit('collab:tool-sync', { roomId: streamRoomId, data: { tool: next } });
          }
        } catch {
          // best-effort; never break tool switching
        }
      }
    },
    [controlledTool, onToolChange, streamSocket, streamRoomId],
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

  // (Shared socket/room memos live above, next to the tool state, so
  // every handler can close over them without TDZ hazards.)

  const {
    visibleShapes,
    renderShapes,
    draftShape,
    selectedId,
    selectedIds,
    selectShapes,
    guidelines,
    selectBox,
    duplicateSelected,
    groupSelected,
    ungroupSelected,
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
    handleDragStageMove,
    handleZoomChange,
    handleShapeClick,
    handleShapeSelect,
    handleShapeDragStart,
    handleShapeDragMove,
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
    commitDelete,
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
    // Live pen-stroke streaming over the room socket (no-op standalone).
    socket: streamSocket,
    roomId: streamRoomId,
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
  const handleImageUpdate = useCallback(
    (id, changes) => {
      commitUpdate(id, changes);
    },
    [commitUpdate],
  );
  const handleImageDelete = useCallback(
    (id) => {
      if (id) commitDelete(id);
    },
    [commitDelete],
  );
  const { importFiles } = useImageDrop({
    stageRef,
    containerRef: canvasWrapRef,
    onImageCreate: handleImageCreate,
    onImageUpdate: handleImageUpdate,
    onImageDelete: handleImageDelete,
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

  // ---- live multiplayer cursors: room-scoped cursor:update transport ----
  // Identity is stable per browser (localStorage); the shared socket
  // connects only when the collab shell owns it — standalone boards simply
  // render zero peers. Stage pointer tracking lives in the hook
  // (throttled 40ms, canvas-space coords so zoom/pan align for peers).
  const presenceIdentity = React.useMemo(() => {
    try {
      return getOrCreateIdentity();
    } catch {
      return { userId: 'user-local', displayName: 'Guest' };
    }
  }, []);
  // Reuses the shared stream socket/room memos declared above.
  const presenceRoomId = streamRoomId;
  const presenceSocket = streamSocket;
  const { peers: presencePeers } = usePresenceCursors({
    socket: presenceSocket,
    roomId: presenceRoomId,
    stageRef,
    containerRef: canvasWrapRef,
    userId: presenceIdentity.userId,
    userName: presenceIdentity.displayName,
    color: colorForId(presenceIdentity.userId),
    enabled: true,
  });

  // ---- peer selection presence: tools/selection stay local per client;
  // only a non-intrusive highlight broadcasts (discrete emit per change).
  // Reception renders imperatively (RemoteSelectionOverlay) with zero
  // React re-renders, so this hook is emit-only by design.
  const { emitSelection } = useRemoteSelection({
    socket: presenceSocket,
    roomId: presenceRoomId,
    userId: presenceIdentity.userId,
    userName: presenceIdentity.displayName,
    color: colorForId(presenceIdentity.userId),
  });
  // Deduplicated outbound selection: pointerdown + click fire for a single
  // tap and reselects rebuild arrays — broadcast only when the sorted id
  // set actually changes, so one tap never emits twice (and never renders
  // twice downstream on peers).
  const lastBroadcastSelectionRef = useRef(null);
  useEffect(() => {
    const ids = Array.isArray(selectedIds) ? selectedIds : selectedId ? [selectedId] : [];
    const key = [...ids].sort().join('|');
    if (lastBroadcastSelectionRef.current === key) return;
    lastBroadcastSelectionRef.current = key;
    emitSelection(ids);
  }, [selectedIds, selectedId, emitSelection]);

  // Shared toolbar: apply peers' tool switches locally (never re-emit).
  // Unknown tool names are ignored so a newer client can't break this one.
  useEffect(() => {
    const sock = streamSocket;
    if (!sock || typeof sock.on !== 'function') return undefined;
    const KNOWN_TOOLS = new Set([
      'select', 'selection', 'rectangle', 'circle', 'diamond', 'arrow',
      'line', 'freehand', 'pen', 'text', 'frame', 'eraser', 'pan',
    ]);
    const onToolSync = (payload) => {
      if (!payload || payload.roomId !== streamRoomId) return;
      const tool = payload.data?.tool;
      if (typeof tool !== 'string' || !KNOWN_TOOLS.has(tool)) return;
      handleToolChange(tool === 'pen' ? 'freehand' : tool, { fromRemote: true });
    };
    sock.on('collab:tool-sync', onToolSync);
    return () => {
      try {
        sock.off?.('collab:tool-sync', onToolSync);
      } catch {
        // ignore teardown failures
      }
    };
  }, [streamSocket, streamRoomId, handleToolChange]);

  // ---- live typing previews: keystrokes stream as a text-shape preview
  // (existing `shape:preview-progress` machinery renders it on peers)
  // throttled ~150ms; commit/cancel settle via preview-cancel while the
  // authoritative create/update op carries the persisted text.
  const typingSessionRef = useRef(null);
  const typingTimerRef = useRef(null);
  const typingLatestRef = useRef({ value: '', editor: null });
  useEffect(() => {
    if (textEditor) {
      typingSessionRef.current =
        `typing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    } else {
      typingSessionRef.current = null;
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    }
  }, [textEditor]);
  useEffect(
    () => () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    },
    [],
  );
  const flushTypingPreview = useCallback(() => {
    typingTimerRef.current = null;
    const sessionId = typingSessionRef.current;
    const { value, editor } = typingLatestRef.current;
    if (!sessionId || !editor) return;
    try {
      const sock = streamSocket;
      const rid = streamRoomId;
      if (!sock || typeof sock.emit !== 'function' || !rid || sock.connected === false) return;
      if (!value || !value.trim()) {
        sock.emit('shape:preview-cancel', { roomId: rid, data: { draftId: sessionId } });
        return;
      }
      const shape = {
        id: sessionId,
        type: 'text',
        x: editor.worldX,
        y: editor.worldY,
        text: value,
        fontSize: editor.fontSize ?? fontSize,
        fontFamily,
        fill: editor.mode === 'edit' ? (editor.fill ?? color) : color,
        align: editor.align ?? editor.textAlign ?? textAlign,
        textAlign: editor.align ?? editor.textAlign ?? textAlign,
        opacity: 1,
        rotation: 0,
      };
      sock.emit('shape:preview-progress', { roomId: rid, data: { draftId: sessionId, shape } });
    } catch {
      // best-effort; never break typing
    }
  }, [streamSocket, streamRoomId, fontSize, fontFamily, color, textAlign]);
  const handleTypingChange = useCallback(
    (value) => {
      typingLatestRef.current = { value: value ?? '', editor: textEditor };
      if (typingTimerRef.current) return;
      typingTimerRef.current = setTimeout(flushTypingPreview, 150);
    },
    [textEditor, flushTypingPreview],
  );
  const cancelTypingPreview = useCallback(() => {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    const sessionId = typingSessionRef.current;
    typingSessionRef.current = null;
    try {
      if (
        sessionId &&
        streamSocket &&
        typeof streamSocket.emit === 'function' &&
        streamRoomId &&
        streamSocket.connected !== false
      ) {
        streamSocket.emit('shape:preview-cancel', { roomId: streamRoomId, data: { draftId: sessionId } });
      }
    } catch {
      // best-effort
    }
  }, [streamSocket, streamRoomId]);
  const handleTextCommit = useCallback(
    (value, measuredWidth) => {
      cancelTypingPreview();
      commitTextEditor(value, measuredWidth);
    },
    [cancelTypingPreview, commitTextEditor],
  );
  const handleTextCancel = useCallback(() => {
    cancelTypingPreview();
    cancelTextEditor();
  }, [cancelTypingPreview, cancelTextEditor]);
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
      // never bake into the exported image. Selection bounds are resolved
      // BEFORE the deselect so "selection only" exports keep their target.
      const selectedShapes = (visibleShapes ?? []).filter(
        (s) => s.id === selectedId || (Array.isArray(selectedIds) && selectedIds.includes(s.id)),
      );
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
            // Auto-cropped full-board export: union bounds via
            // exportBounds(shapes, 32px) passed into
            // stage.toDataURL({ x, y, width, height, pixelRatio: 2 }).
            if (!stage) throw new Error('Canvas not ready');
            await exportPNG(stage, 'syncspace-board.png', visibleShapes);
            flashExportNote('Exported PNG (cropped to content)');
            break;
          case 'jpeg':
            if (!stage) throw new Error('Canvas not ready');
            await exportJPEG(stage, 'syncspace-board.jpg', visibleShapes);
            flashExportNote('Exported JPEG (cropped to content)');
            break;
          case 'png-selection':
          case 'jpeg-selection': {
            if (selectedShapes.length === 0) {
              // Fallback: no selection -> auto-cropped full canvas.
              if (!stage) throw new Error('Canvas not ready');
              if (format.startsWith('png')) await exportPNG(stage, 'syncspace-board.png', visibleShapes);
              else await exportJPEG(stage, 'syncspace-board.jpg', visibleShapes);
              flashExportNote('No selection — exported full board');
              break;
            }
            if (!stage) throw new Error('Canvas not ready');
            if (format.startsWith('png')) await exportSelectedPNG(stage, selectedShapes, 'syncspace-board-selection.png');
            else await exportSelectedJPEG(stage, selectedShapes, 'syncspace-board-selection.jpg');
            flashExportNote(`Exported selection (${selectedShapes.length} shape${selectedShapes.length === 1 ? '' : 's'})`);
            break;
          }
          case 'pdf-selection': {
            if (!stage) throw new Error('Canvas not ready');
            if (selectedShapes.length === 0) {
              await exportPDF(stage, visibleShapes, 'syncspace-board.pdf');
              flashExportNote('No selection — exported full board PDF');
            } else {
              await exportPDF(stage, visibleShapes, 'syncspace-board-selection.pdf', selectedShapes);
              flashExportNote(`Exported selection PDF (${selectedShapes.length})`);
            }
            break;
          }
          case 'avif': {
            if (!stage) throw new Error('Canvas not ready');
            const { fallback } = await exportAVIF(stage, 'syncspace-board.avif', visibleShapes);
            flashExportNote(fallback ? 'AVIF unsupported — exported PNG instead' : 'Exported AVIF (cropped to content)');
            break;
          }
          case 'svg':
            exportSVG(visibleShapes, 'syncspace-board.svg');
            flashExportNote('Exported SVG');
            break;
          case 'pdf':
            if (!stage) throw new Error('Canvas not ready');
            await exportPDF(stage, visibleShapes, 'syncspace-board.pdf');
            flashExportNote('Exported PDF (cropped to content)');
            break;
          default:
            break;
        }
      } catch (err) {
        flashExportNote(err?.message ?? 'Export failed');
      }
    },
    [flashExportNote, selectShape, selectedId, selectedIds, stageRef, transformerRef, visibleShapes],
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

  // ---- global keyboard hotkeys (V/P/R/C/T/F tools, Cmd+D duplicate,
  // Cmd+G group, Cmd+Shift+G ungroup). Typing targets + text editor ignored.
  useCanvasHotkeys({
    onToolChange: handleToolChange,
    onDuplicate: duplicateSelected,
    onGroup: groupSelected,
    onUngroup: ungroupSelected,
    textEditor,
  });

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
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
              hasSelection={Boolean(selectedId) || (Array.isArray(selectedIds) && selectedIds.length > 0)}
              selectedCount={Array.isArray(selectedIds) ? selectedIds.length : (selectedId ? 1 : 0)}
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
      <section className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-[#f8f9fa] shadow-sm">
      <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden" ref={canvasWrapRef}>
        <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
          <CanvasStage
            // renderShapes = committed + local draft + remote in-progress
            // pen previews (display-only; exports/counts use visibleShapes).
            // CanvasStage splits committed vs in-flight into separate
            // layers so preview traffic never reconciles the main tree.
            shapes={renderShapes}
            draftShape={draftShape}
            selectedId={selectedId}
            selectedIds={selectedIds}
            tool={tool}
            scale={scale}
            stagePos={stagePos}
            stageRef={stageRef}
            shapeNodesRef={shapeNodesRef}
            transformerRef={transformerRef}
            guidelines={guidelines}
            selectBox={selectBox}
            syncSocket={presenceSocket}
            syncRoomId={presenceRoomId}
            syncUserId={presenceIdentity.userId}
            onPointerDown={handleStageMouseDown}
            onPointerMove={handleStageMouseMove}
            onPointerUp={handleStageMouseUp}
            onWheel={handleWheel}
            onDragStageEnd={handleDragStageEnd}
            onDragStageMove={handleDragStageMove}
            onShapeClick={handleShapeClick}
            onShapeSelect={handleShapeSelect}
            onShapeDragEnd={handleShapeDragEnd}
            onShapeDragStart={handleShapeDragStart}
            onShapeDragMove={handleShapeDragMove}
            onTransformEnd={handleTransformEnd}
            onTextDoubleClick={openTextEditorForShape}
            onBendCommit={handleBendCommit}
          />
          <TextEditorOverlay
            editor={textEditor}
            color={color}
            onCommit={handleTextCommit}
            onCancel={handleTextCancel}
            onChange={handleTypingChange}
          />
          <PresenceCursors peers={presencePeers} scale={scale} stagePos={stagePos} />
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
