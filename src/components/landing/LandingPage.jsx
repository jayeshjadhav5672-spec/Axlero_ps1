import React from 'react';

/**
 * LandingPage — Avantee (React UI / Frontend Engineer)
 *
 * Product landing page and default entry view for SyncSpace, shown before
 * the Dashboard on the same "/" route (see App.jsx `showLanding` state —
 * no router involved). Pure presentational UI: the single `onEnter`
 * callback returns the user to the existing Dashboard/Workspace flow.
 *
 * Visual system: beige/white/black palette (#F5F1E8 page, #FFFFFF
 * surfaces, #111111 headings and primary actions, #57534E body,
 * #E7DFCC borders). Tailwind utilities only, no new dependencies.
 *
 * The hero visual is ONE connected abstraction (plain SVG — a freeform
 * whiteboard stroke flowing into a shared sync hub with collaborator
 * nodes, continuing into a brace-and-cursor code motif). It deliberately
 * contains no simulated product UI: no fake browser window, editor,
 * whiteboard canvas, floating cards, avatars, or cursors-as-people.
 *
 * Props: { onEnter: () => void }
 */

/* ------------------------------------------------------------------ */
/* Brand mark (verbatim from WorkspaceHeader — do not redraw)           */
/* ------------------------------------------------------------------ */

function BrandMark() {
  return (
    <span className="flex shrink-0 items-center gap-2.5">
      <svg className="h-7 w-7 text-[#111111]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
      <span className="text-lg font-bold tracking-tight text-[#111111]">SyncSpace</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Hand-authored stroke icons (project convention: 24x24 grid, round    */
/* caps, ~1.8px stroke — no icon library)                               */
/* ------------------------------------------------------------------ */

function StrokeIcon({ className = 'h-6 w-6', children }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function WhiteboardIcon({ className }) {
  return (
    <StrokeIcon className={className}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M12 16v2.5M8.5 21.5h7" />
      <path d="M7.5 11.5l4.5-4.5 3 3-4.5 4.5H7.5v-3z" />
    </StrokeIcon>
  );
}

function CodeIcon({ className }) {
  return (
    <StrokeIcon className={className}>
      <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
    </StrokeIcon>
  );
}

function SyncIcon({ className }) {
  return (
    <StrokeIcon className={className}>
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5M3 21v-5h5" />
    </StrokeIcon>
  );
}

function RoomIcon({ className }) {
  return (
    <StrokeIcon className={className}>
      <rect x="3" y="7" width="13" height="13" rx="2" />
      <path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h9A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H17" />
    </StrokeIcon>
  );
}

/* ------------------------------------------------------------------ */
/* Hero visual — one connected abstraction (decorative SVG only)        */
/*                                                                     */
/* A single eye-flow reads left → right as one idea: a freeform        */
/* whiteboard stroke flows into a shared hub ring; thin sync           */
/* connectors branch from the hub to two collaborator nodes; a final   */
/* connector continues into a brace-and-cursor code motif. One stroke  */
/* weight (1.5px), one hue (#111111, with low-opacity tints for        */
/* background depth), no fills except node faces. Deliberately no      */
/* product UI: no window, editor, canvas, avatars, or cursors-as-      */
/* people.                                                             */
/*                                                                     */
/* Motion: one entrance reveal (nodes pop in, lines draw via           */
/* pathLength dashoffset, code motif fades) totalling ~850ms, plus a   */
/* single slow cursor pulse afterwards as the only continuous          */
/* detail. Everything lives under                                      */
/* `@media (prefers-reduced-motion: no-preference)` so reduced-motion  */
/* users see the finished composition statically.                      */
/* ------------------------------------------------------------------ */

function HeroVisual() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-md select-none">
      <style>{`@media (prefers-reduced-motion: no-preference){@keyframes sync-node-in{from{opacity:0;transform:scale(0.5)}to{opacity:1;transform:scale(1)}}@keyframes sync-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}@keyframes sync-fade-in{from{opacity:0}to{opacity:1}}@keyframes sync-cursor-pulse{0%,100%{opacity:1}50%{opacity:0.3}}.sync-node{transform-box:fill-box;transform-origin:center;animation:sync-node-in 350ms ease-out both}.sync-line{stroke-dasharray:1;stroke-dashoffset:1;animation:sync-draw 450ms ease-out 250ms both}.sync-code{animation:sync-fade-in 300ms ease-out 550ms both}.sync-cursor{animation:sync-cursor-pulse 3s ease-in-out 1.2s infinite}}`}</style>
      <svg viewBox="0 0 360 280" className="h-auto w-full" focusable="false">
        {/* faint dashed orbit for depth — decorative, hidden on small screens */}
        <ellipse
          className="hidden sm:block"
          cx="180"
          cy="140"
          rx="150"
          ry="100"
          fill="none"
          stroke="#E7DFCC"
          strokeWidth="1.5"
          strokeDasharray="5 7"
        />
        {/* whiteboard freeform stroke */}
        <path
          className="sync-line"
          pathLength="1"
          d="M34 212 C56 190 64 204 86 190 S114 170 136 182"
          fill="none"
          stroke="#111111"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle className="sync-node" cx="34" cy="212" r="3" fill="#111111" />
        {/* stroke flows into the shared hub */}
        <path
          className="sync-line"
          pathLength="1"
          d="M136 182 L167 158"
          fill="none"
          stroke="#111111"
          strokeOpacity="0.45"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* shared hub ring */}
        <circle
          className="sync-node"
          style={{ animationDelay: '100ms' }}
          cx="188"
          cy="138"
          r="26"
          fill="#ffffff"
          stroke="#111111"
          strokeWidth="1.5"
        />
        <circle className="sync-node" style={{ animationDelay: '160ms' }} cx="188" cy="138" r="6" fill="#111111" />
        {/* sync branches to collaborator nodes */}
        <path
          className="sync-line"
          pathLength="1"
          d="M208 120 L254 94"
          fill="none"
          stroke="#111111"
          strokeOpacity="0.45"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          className="sync-line"
          pathLength="1"
          d="M206 156 L246 188"
          fill="none"
          stroke="#111111"
          strokeOpacity="0.45"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle
          className="sync-node"
          style={{ animationDelay: '200ms' }}
          cx="266"
          cy="86"
          r="10"
          fill="#ffffff"
          stroke="#111111"
          strokeWidth="1.5"
        />
        <circle className="sync-node" style={{ animationDelay: '240ms' }} cx="266" cy="86" r="3" fill="#111111" />
        <circle
          className="sync-node"
          style={{ animationDelay: '280ms' }}
          cx="258"
          cy="196"
          r="10"
          fill="#ffffff"
          stroke="#111111"
          strokeWidth="1.5"
        />
        <circle className="sync-node" style={{ animationDelay: '320ms' }} cx="258" cy="196" r="3" fill="#111111" />
        {/* hub continues into the code motif */}
        <path
          className="sync-line"
          pathLength="1"
          d="M214 138 L256 138"
          fill="none"
          stroke="#111111"
          strokeOpacity="0.45"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* brace-and-cursor code motif, drawn in the same linework */}
        <g className="sync-code" fill="none" stroke="#111111" strokeWidth="1.5" strokeLinecap="round">
          <path d="M270 122 C265 122 263 124 263 129 L263 133 C263 136 261 138 258 138 C261 138 263 140 263 143 L263 147 C263 152 265 154 270 154" />
          <path d="M282 122 C287 122 289 124 289 129 L289 133 C289 136 291 138 294 138 C291 138 289 140 289 143 L289 147 C289 152 287 154 282 154" />
        </g>
        <rect className="sync-code sync-cursor" x="274" y="128" width="4.5" height="20" rx="1" fill="#111111" />
        {/* small geometric accents — decorative, hidden on small screens */}
        <g className="hidden sm:block" stroke="rgba(17,17,17,0.4)" strokeWidth="1.5" strokeLinecap="round">
          <path d="M52 116h14M59 109v14" />
          <path d="M312 168h12M318 162v12" />
        </g>
        <circle className="hidden sm:block" cx="40" cy="156" r="3.5" fill="#111111" fillOpacity="0.35" />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Content data (real product concepts only — nothing invented)         */
/* ------------------------------------------------------------------ */

const CAPABILITIES = [
  {
    title: 'Collaborative Whiteboard',
    body: 'Sketch flows and diagrams on a shared canvas everyone sees.',
    Icon: WhiteboardIcon,
  },
  {
    title: 'Collaborative Code',
    body: 'Edit code together with every keystroke kept in sync.',
    Icon: CodeIcon,
  },
  {
    title: 'Real-Time Collaboration',
    body: 'Changes appear instantly for everyone in the room.',
    Icon: SyncIcon,
  },
  {
    title: 'Shared Workspace',
    body: 'One room holds your team, board, and code together.',
    Icon: RoomIcon,
  },
];

const HOW_IT_WORKS = [
  { title: 'Create or join a room', body: 'Pick a room ID and open your workspace.' },
  { title: 'Invite your team', body: 'Share the room link with collaborators.' },
  { title: 'Whiteboard and code together', body: 'Sketch and implement in real time.' },
];

/* ------------------------------------------------------------------ */
/* LandingPage                                                          */
/* ------------------------------------------------------------------ */

export default function LandingPage({ onEnter }) {
  return (
    <div className="flex w-full flex-1 flex-col bg-[#F5F1E8] text-[#111111]">
      {/* Top navigation */}
      <header className="w-full border-b border-[#E7DFCC] bg-white/80 backdrop-blur">
        <nav aria-label="Primary" className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
          <BrandMark />
          <span className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-medium text-[#57534E]">
            <a href="#capabilities" className="rounded transition-colors hover:text-[#111111]">
              Capabilities
            </a>
            <a href="#how-it-works" className="rounded transition-colors hover:text-[#111111]">
              How it works
            </a>
          </span>
        </nav>
      </header>

      <main className="flex w-full flex-1 flex-col">
        {/* Hero */}
        <section aria-labelledby="landing-hero-title" className="w-full">
          <div className="landing-rise mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-10 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 md:grid-cols-2 lg:gap-14">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-2 rounded-full border border-[#E7DFCC] bg-white px-3 py-1 text-xs font-semibold text-[#111111]">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#111111]" />
                Real-time whiteboard + code
              </p>
              <h1 id="landing-hero-title" className="mt-4 text-4xl font-extrabold tracking-tight text-[#111111] sm:text-5xl">
                Whiteboard and code, together in one room.
              </h1>
              <p className="mt-4 max-w-xl text-base text-[#57534E] sm:text-lg">
                SyncSpace gives your team a shared room with a collaborative whiteboard and a
                collaborative code editor, kept in sync in real time.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onEnter}
                  className="rounded-lg bg-[#111111] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#2A2A2A]"
                >
                  Open SyncSpace
                </button>
                <a
                  href="#how-it-works"
                  className="rounded-lg border border-[#E7DFCC] bg-white px-6 py-3 text-sm font-semibold text-[#111111] transition-colors hover:bg-[#EDE6D6]"
                >
                  See how it works
                </a>
              </div>
            </div>
            <HeroVisual />
          </div>
        </section>

        {/* Capabilities */}
        <section aria-labelledby="landing-capabilities-title" id="capabilities" className="w-full scroll-mt-4 bg-white">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
            <h2 id="landing-capabilities-title" className="text-2xl font-bold tracking-tight text-[#111111] sm:text-3xl">
              Everything the room needs
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-[#57534E] sm:text-base">
              Four real building blocks - nothing more, nothing missing.
            </p>
            <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {CAPABILITIES.map(({ title, body, Icon }) => (
                <li
                  key={title}
                  className="flex flex-col rounded-2xl border border-[#E7DFCC] bg-[#F5F1E8] p-6"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#111111]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold text-[#111111]">{title}</h3>
                  <p className="mt-1.5 text-sm text-[#57534E]">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section aria-labelledby="landing-how-title" id="how-it-works" className="w-full scroll-mt-4 bg-white">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
            <h2 id="landing-how-title" className="text-2xl font-bold tracking-tight text-[#111111] sm:text-3xl">
              How it works
            </h2>
            <ol className="mt-8 flex flex-col gap-3">
              {HOW_IT_WORKS.map((step, index) => (
                <li
                  key={step.title}
                  className="flex items-start gap-4 rounded-xl border border-[#E7DFCC] bg-[#F5F1E8] px-5 py-4"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#111111] text-sm font-bold text-white"
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[#111111]">{step.title}</span>
                    <span className="block text-sm text-[#57534E]">{step.body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-[#E7DFCC] bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-6 sm:px-6">
          <BrandMark />
          <p className="ml-auto text-xs text-[#57534E]">© 2026 SyncSpace - real-time collaborative whiteboard and code editor.</p>
        </div>
      </footer>
    </div>
  );
}
