import { createShapeId, estimateTextWidth, isFiniteNum } from './shapes.js';

/**
 * mermaid.js — Sayon (Week 2: "Mermaid to Draw" compiler)
 *
 * Lightweight flowchart parser (no mermaid dependency): parses a subset of
 * Mermaid flowchart syntax into nodes + edges, then lays them out as native
 * whiteboard shapes (rectangles/circles with embedded text + arrows).
 *
 * Supported:
 *   flowchart TD|TB|LR|RL|BT
 *   A[Label]  A(Label)  A((Label))  A[(Database)]  A{Decision}
 *   A --> B   A --- B   A ==> B   A -- text --> B   A-->B[label]
 *   One statement per line or `;`-separated.
 */

function parseNodeToken(token) {
  const t = token.trim();
  // Longest delimiters first: (((" stadium / circle-double.
  const m = t.match(
    /^([A-Za-z0-9_]+)\s*(?:\(\(\((.*)\)\)\)|\(\((.*)\)\)|\[\((.*)\)\]|\[(.*)\]|\{(.*)\}|\((.*)\)|)$/,
  );
  if (!m) return null;
  const id = m[1];
  const label = (m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7] ?? id).trim() || id;
  let kind = 'rect';
  if (m[2] !== undefined || m[3] !== undefined) kind = 'circle';
  else if (m[4] !== undefined) kind = 'circle'; // cylinder/database -> circle w/ label
  else if (m[6] !== undefined) kind = 'diamond';
  return { id, label, kind };
}

function splitEdgeLine(line) {
  // Returns { left, right, label } split on the first edge operator.
  const m = line.match(
    /^(.*?)(--+>|==+>|\.\.+>|---+|~~~+|-->|---|==>)(.*?)$/,
  );
  if (!m) return null;
  let left = m[1].trim();
  let right = m[3].trim();
  let label = '';
  // Trailing [label] on the right side belongs to the edge.
  const lm = right.match(/^\[(.*?)\]\s*(.*)$/);
  if (lm) {
    label = lm[1].trim();
    right = lm[2].trim();
  }
  // Inline -- text -- syntax on the left remainder.
  const inline = left.match(/--\s*(.+?)\s*--$/);
  if (inline) {
    label = label || inline[1].trim().replace(/^[\s|"]+|[\s|"]+$/g, '');
    left = left.slice(0, inline.index).trim();
  }
  const directed = />|=/.test(m[2]);
  return { left, right, label, directed };
}

function cleanLabel(s) {
  return String(s ?? '')
    .replace(/^["']|["']$/g, '')
    .replace(/[|"]/g, '')
    .trim();
}

/**
 * parseMermaidFlowchart(source) -> { nodes: [{id,label,kind}], edges: [{from,to,label,directed}], direction } | { error }
 */
export function parseMermaidFlowchart(source) {
  if (typeof source !== 'string' || !source.trim()) {
    return { error: 'Empty diagram. Paste flowchart syntax to compile.' };
  }
  const text = source.replace(/\r/g, '');
  const chunks = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('%%'))
    .flatMap((l) => l.split(';').map((s) => s.trim()).filter(Boolean));

  let direction = 'TD';
  const nodes = new Map();
  const edges = [];

  const ensureNode = (token) => {
    if (!token) return null;
    const parsed = parseNodeToken(token);
    if (!parsed) {
      // Bare id reference (edge endpoint without a fresh definition).
      const bare = token.match(/^([A-Za-z0-9_]+)$/);
      if (!bare) return null;
      if (!nodes.has(bare[1])) nodes.set(bare[1], { id: bare[1], label: bare[1], kind: 'rect' });
      return bare[1];
    }
    if (!nodes.has(parsed.id)) {
      nodes.set(parsed.id, { id: parsed.id, label: cleanLabel(parsed.label) || parsed.id, kind: parsed.kind });
    } else if (parsed.label && parsed.label !== parsed.id) {
      const existing = nodes.get(parsed.id);
      existing.label = cleanLabel(parsed.label);
      existing.kind = parsed.kind;
    }
    return parsed.id;
  };

  for (const chunk of chunks) {
    const head = chunk.match(/^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\s*(.*)$/i);
    if (head) {
      direction = head[1].toUpperCase();
      const rest = (head[2] || '').trim();
      if (rest) {
        // Fall through to parse the remainder as a statement.
        const stmt = rest;
        const edge = splitEdgeLine(stmt);
        if (edge) {
          const from = ensureNode(edge.left);
          const to = ensureNode(edge.right);
          if (from && to) edges.push({ from, to, label: cleanLabel(edge.label), directed: edge.directed });
        } else {
          ensureNode(stmt);
        }
      }
      continue;
    }
    if (/^(?:flowchart|graph)\s*$/i.test(chunk)) continue;
    // Strip style/class/click/subgraph directives we don't compile.
    if (/^(style|class|classDef|click|subgraph|end|direction)\b/i.test(chunk)) continue;

    const edge = splitEdgeLine(chunk);
    if (edge) {
      const from = ensureNode(edge.left);
      const to = ensureNode(edge.right);
      if (from && to) {
        edges.push({ from, to, label: cleanLabel(edge.label), directed: edge.directed });
      } else if (from || to) {
        // Half-parseable edge: keep the resolvable endpoint as a node.
      } else {
        return { error: `Could not parse line: "${chunk}"` };
      }
    } else {
      const id = ensureNode(chunk);
      if (!id) return { error: `Could not parse line: "${chunk}"` };
    }
  }

  if (nodes.size === 0) return { error: 'No nodes found. Add lines like `A[Client] --> B[Server]`.' };
  return { nodes: [...nodes.values()], edges, direction };
}

const NODE_W = 170;
const NODE_H = 64;
const GAP_X = 60;
const GAP_Y = 90;

/**
 * compileMermaidToShapes(source, origin, style) -> { shapes } | { error }
 * Lays nodes out in topological layers (vertical for TD/BT/TB, horizontal
 * for LR/RL) and connects them with arrows anchored at node borders.
 * All output is plain serializable JSON via the standard shape fields.
 */
export function compileMermaidToShapes(
  source,
  origin = { x: 80, y: 80 },
  style = {},
) {
  const parsed = parseMermaidFlowchart(source);
  if (parsed.error) return { error: parsed.error };
  const { nodes, edges, direction } = parsed;
  const horizontal = direction === 'LR' || direction === 'RL';

  const ox = isFiniteNum(origin?.x) ? origin.x : 80;
  const oy = isFiniteNum(origin?.y) ? origin.y : 80;
  const stroke = style.color ?? style.stroke ?? '#1e1e1e';
  const strokeWidth = style.strokeWidth ?? 2;
  const fontSize = style.fontSize ?? 15;

  // Layer assignment: longest-path depth from roots (Kahn-style BFS).
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  const outgoing = new Map(nodes.map((n) => [n.id, []]));
  const incoming = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    if (!outgoing.has(e.from) || !incoming.has(e.to)) continue;
    outgoing.get(e.from).push(e.to);
    incoming.set(e.to, incoming.get(e.to) + 1);
  }
  const queue = nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id);
  const seen = new Set(queue);
  if (queue.length === 0 && nodes.length > 0) queue.push(nodes[0].id);
  while (queue.length > 0) {
    const id = queue.shift();
    for (const next of outgoing.get(id) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, (depth.get(id) ?? 0) + 1));
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const layers = new Map();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d).push(n);
  }

  const positions = new Map();
  const sortedDepths = [...layers.keys()].sort((a, b) => a - b);
  sortedDepths.forEach((d, li) => {
    const row = layers.get(d);
    row.forEach((n, i) => {
      const px = horizontal ? ox + li * (NODE_W + GAP_X) : ox + i * (NODE_W + GAP_X);
      const py = horizontal ? oy + i * (NODE_H + GAP_Y) : oy + li * (NODE_H + GAP_Y);
      positions.set(n.id, { x: px, y: py });
    });
  });

  const shapes = [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    const pos = positions.get(n.id);
    const labelW = estimateTextWidth(n.label, fontSize) + 28;
    const w = Math.max(NODE_W, Math.min(320, labelW));
    if (n.kind === 'diamond') {
      const cx = pos.x + NODE_W / 2;
      const cy = pos.y + NODE_H / 2;
      shapes.push({
        id: createShapeId(),
        type: 'diamond',
        x: cx - w / 2,
        y: cy - NODE_H / 2,
        width: w,
        height: NODE_H,
        stroke,
        strokeWidth,
        strokeStyle: 'solid',
        opacity: 1,
        roughness: 0,
        roundness: 'sharp',
        fill: '#ffffff',
        rotation: 0,
      });
    } else if (n.kind === 'circle') {
      const rx = Math.max(w / 2, NODE_H / 2);
      shapes.push({
        id: createShapeId(),
        type: 'circle',
        x: pos.x + NODE_W / 2,
        y: pos.y + NODE_H / 2,
        radius: rx,
        radiusX: rx,
        radiusY: NODE_H / 2,
        stroke,
        strokeWidth,
        strokeStyle: 'solid',
        opacity: 1,
        roughness: 0,
        roundness: 'sharp',
        fill: '#ffffff',
        rotation: 0,
      });
    } else {
      shapes.push({
        id: createShapeId(),
        type: 'rectangle',
        x: pos.x,
        y: pos.y,
        width: w,
        height: NODE_H,
        stroke,
        strokeWidth,
        strokeStyle: 'solid',
        opacity: 1,
        roughness: 0,
        roundness: 'round',
        fill: '#ffffff',
        rotation: 0,
      });
    }
    // Embedded label as a text shape centered on the node.
    const nodeW = n.kind === 'rect' ? w : n.kind === 'diamond' ? w : w;
    const textW = estimateTextWidth(n.label, fontSize);
    shapes.push({
      id: createShapeId(),
      type: 'text',
      x: (n.kind === 'rect' ? pos.x : pos.x + NODE_W / 2 - nodeW / 2) + (nodeW - textW) / 2,
      y: pos.y + NODE_H / 2 - fontSize * 0.7,
      text: n.label,
      fontSize,
      fontFamily: style.fontFamily ?? 'sans-serif',
      fontFamilyKey: style.fontFamilyKey ?? 'normal',
      textAlign: 'center',
      align: 'center',
      fill: stroke,
      width: textW,
      opacity: 1,
      rotation: 0,
    });
    void nodeById;
  }

  // Edges -> arrows between node border midpoints.
  for (const e of edges) {
    const a = positions.get(e.from);
    const b = positions.get(e.to);
    if (!a || !b) continue;
    let x1;
    let y1;
    let x2;
    let y2;
    if (horizontal) {
      x1 = a.x + NODE_W;
      y1 = a.y + NODE_H / 2;
      x2 = b.x;
      y2 = b.y + NODE_H / 2;
    } else {
      x1 = a.x + NODE_W / 2;
      y1 = a.y + NODE_H;
      x2 = b.x + NODE_W / 2;
      y2 = b.y;
    }
    if (direction === 'BT') {
      [x1, y1, x2, y2] = [x2, y2, x1, y1];
    } else if (direction === 'RL') {
      [x1, y1, x2, y2] = [x2, y2, x1, y1];
    }
    shapes.push({
      id: createShapeId(),
      type: 'arrow',
      x: 0,
      y: 0,
      points: [x1, y1, x2, y2],
      stroke,
      strokeWidth,
      strokeStyle: 'solid',
      opacity: 1,
      roughness: 0,
      startArrowhead: 'none',
      endArrowhead: e.directed === false ? 'none' : 'arrow',
      arrowType: 'straight',
      fill: stroke,
      lineCap: 'round',
      lineJoin: 'round',
      rotation: 0,
      ...(e.label ? { label: e.label } : {}),
    });
  }

  return { shapes };
}

export const MERMAID_PLACEHOLDER = `flowchart TD
  A[Client] --> B[API Server]
  B --> C[(Database)]`;
