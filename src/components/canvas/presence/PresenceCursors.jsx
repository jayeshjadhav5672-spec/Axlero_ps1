import React from 'react';

/**
 * PresenceCursors — smooth remote-peer cursor overlay.
 *
 * Absolute HTML overlay (pointer-events-none) above the Konva stage:
 * each peer renders an SVG cursor pointer tinted with `peer.color` plus
 * a pill badge showing `peer.userName`. Positions interpolate with
 * `transition: transform 80ms linear` for smooth movement.
 *
 * Peers carry canvas-space (world) coords; screen projection applies the
 * live viewport (`screen = world * scale + stagePos`).
 */
export default function PresenceCursors({ peers = [], scale = 1, stagePos = { x: 0, y: 0 } }) {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const px = Number.isFinite(stagePos?.x) ? stagePos.x : 0;
  const py = Number.isFinite(stagePos?.y) ? stagePos.y : 0;
  if (!Array.isArray(peers) || peers.length === 0) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
      data-testid="presence-cursors"
    >
      {peers.map((peer, index) => {
        if (!peer || !Number.isFinite(peer.x) || !Number.isFinite(peer.y)) return null;
        const left = peer.x * s + px;
        const top = peer.y * s + py;
        const color = peer.color ?? '#4f46e5';
        return (
          <div
            // Per-connection identity: socketId first (each tab/share is an
            // individual cursor), userId + index fallback — userId alone
            // collides across tabs of one account.
            key={peer.socketId || `${peer.userId || peer.id || 'peer'}-${index}`}
            className="absolute left-0 top-0"
            style={{ transform: `translate(${left}px, ${top}px)`, transition: 'transform 80ms linear' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill={color} aria-hidden="true">
              <path d="M4 3l7.5 18 2.5-7.5L21.5 11 4 3z" stroke="#ffffff" strokeWidth="1.5" />
            </svg>
            <span
              className="ml-4 -mt-1 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow"
              style={{ backgroundColor: color }}
            >
              {peer.userName ?? 'Guest'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
