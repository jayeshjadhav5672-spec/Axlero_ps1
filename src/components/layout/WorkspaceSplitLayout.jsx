import React, { useState, useEffect, useRef } from "react";
import { SPLIT_DEFAULT_PCT, clampSplitPercent, minPaneWidth } from "./splitLayout.js";

function readStoredWidth(fallback) {
  const safeFallback = clampSplitPercent(fallback);
  try {
    const saved = localStorage.getItem("syncspace_left_width");
    if (saved !== null && saved !== "") {
      const n = Number(saved);
      if (Number.isFinite(n)) return clampSplitPercent(n, safeFallback);
    }
    // Legacy key fallback (same physical-left percentage scale now that
    // the whiteboard is fixed on the left).
    const legacy = localStorage.getItem("syncspace_split_ratio");
    if (legacy !== null && legacy !== "") {
      const n = Number(legacy);
      if (Number.isFinite(n)) return clampSplitPercent(n, safeFallback);
    }
  } catch {
    // ignore storage failures (private mode / SSR)
  }
  return safeFallback;
}

export default function WorkspaceSplitLayout({
  whiteboardComponent,
  codeEditorComponent,
  initialSplit = 50,
}) {
  const [leftWidth, setLeftWidth] = useState(() => readStoredWidth(initialSplit));

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef(null);
  // Measured container width so per-pane minimums stay consistent on
  // narrow viewports (see minPaneWidth). Updated on resize; defaults to
  // 0 (200px minimums) until the first measurement lands.
  const [containerWidth, setContainerWidth] = useState(0);
  const paneMin = minPaneWidth(containerWidth);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const update = () => {
      try {
        setContainerWidth(el.clientWidth || 0);
      } catch {
        // ignore measurement failures
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("syncspace_left_width", leftWidth.toString());
    } catch {
      // ignore storage failures
    }
  }, [leftWidth]);

  const handlePointerDown = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (!(rect.width > 0)) return;
      const currentX = e.clientX - rect.left;
      let newLeftWidth = (currentX / rect.width) * 100;
      newLeftWidth = clampSplitPercent(newLeftWidth, leftWidth);
      setLeftWidth(newLeftWidth);
    };

    const handlePointerUp = () => setIsDragging(false);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isDragging]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full flex-1 min-h-0 flex flex-row overflow-hidden bg-white select-none ${
        isDragging ? "cursor-col-resize select-none" : ""
      }`}
    >
      {/* Left Column: Whiteboard */}
      <div
        style={{ width: `${leftWidth}%`, minWidth: paneMin }}
        className="h-full min-h-0 flex flex-col overflow-hidden"
        data-testid="pane-whiteboard"
      >
        {whiteboardComponent}
      </div>

      {/* Resizer Handle */}
      <div
        onPointerDown={handlePointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
        data-testid="split-divider"
        className="w-3 -mx-1.5 cursor-col-resize touch-none transition-colors flex items-center justify-center shrink-0 z-20 group bg-transparent hover:bg-slate-100"
      >
        <div className="h-8 w-1 rounded-full bg-slate-300 group-hover:bg-slate-500 transition-colors" />
      </div>

      {/* Right Column: Code Editor */}
      <div
        style={{ width: `${100 - leftWidth}%`, minWidth: paneMin }}
        className="h-full min-h-0 flex flex-col overflow-hidden"
        data-testid="pane-code"
      >
        {codeEditorComponent}
      </div>
    </div>
  );
}
