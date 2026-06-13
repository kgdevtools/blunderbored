import type { Move } from 'chess.js';
import { formatClk } from './clock';

export interface GameNode {
  id: string;
  fen: string;
  move: Move | null;      // null for the root node
  parent: GameNode | null;
  children: GameNode[];   // children[0] is the main-line continuation
}

// ─── Per-node annotation model ────────────────────────────────────────────────

// Where a comment came from. Sources coexist on a node and are colour-coded in
// the UI; the original PGN's comments ('pgn') are never overwritten when the
// user ('manual') or the game reviewer ('reviewer') add their own.
export type AnnoSource = 'pgn' | 'manual' | 'reviewer';

export interface NodeAnnotation {
  source: AnnoSource;
  text: string;
}

// Clock/eval data parsed from a move's PGN comment ([%clk] / [%eval]). Kept
// separate from free-text comments so it can drive time/eval UI and round-trip
// back to PGN without being mixed into the displayed prose.
export interface NodeMeta {
  clk?: number;      // seconds remaining on the mover's clock after this ply
  evalText?: string; // raw eval token, e.g. "+0.24" or "#-3"
}

// Normalises PGN text that mobile keyboards / clipboards mangle: curly quotes
// in header tags, non-breaking & thin spaces, and zero-width characters all make
// chess.js's strict parser throw. Run this before loadPgn.
export function sanitizePgn(pgn: string): string {
  return pgn
    .replace(/[\u00a0\u2007\u2009\u202f]/g, ' ') // nbsp / figure / thin / narrow-nbsp -> space
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"') // curly double quotes / double-prime -> "
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'") // curly single quotes / prime -> '
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '') // zero-width chars / BOM
    .replace(/\}\s*\{/g, ' ') // merge adjacent {\u2026} comments (Lichess emits clk + opening on move 1)
    .trim();
}

// Pads a bare FEN (just the piece-placement field, or one missing trailing
// fields) with sane defaults so chess.js's strict constructor accepts it. A
// complete FEN passes through unchanged.
export function normalizeFen(input: string): string {
  const t = input.trim();
  if (!t) return t;
  const [placement, side = 'w', castle = '-', ep = '-', half = '0', full = '1'] = t.split(/\s+/);
  return [placement, side, castle, ep, half, full].join(' ');
}

let _counter = 0;

export function createRootNode(fen: string): GameNode {
  return { id: `n${++_counter}`, fen, move: null, parent: null, children: [] };
}

// Returns the existing child if the same SAN was already played, otherwise creates a new one.
export function addMove(parent: GameNode, move: Move, fen: string): GameNode {
  const existing = parent.children.find(c => c.move?.san === move.san);
  if (existing) return existing;
  const node: GameNode = { id: `n${++_counter}`, fen, move, parent, children: [] };
  parent.children.push(node);
  return node;
}

// Returns root + every children[0] node down the main line.
export function getMainLine(root: GameNode): GameNode[] {
  const line: GameNode[] = [root];
  let node = root.children[0] ?? null;
  while (node) {
    line.push(node);
    node = node.children[0] ?? null;
  }
  return line;
}

// Returns the sequence of nodes from the root down to (and including) the given node.
export function getPathFromRoot(node: GameNode): GameNode[] {
  const path: GameNode[] = [];
  let cur: GameNode | null = node;
  while (cur) {
    path.unshift(cur);
    cur = cur.parent;
  }
  return path;
}

// Optional per-node extras included when serialising to PGN.
export interface PgnExtras {
  // One node can carry comments from several sources; they're concatenated into
  // the single PGN comment block (PGN has no notion of provenance).
  comments?: Map<string, NodeAnnotation[]>;
  // Clock/eval re-emitted as [%clk]/[%eval] tokens.
  meta?: Map<string, NodeMeta>;
  // arrows: [from, to][] and highlights: square[] keyed by node id
  annotations?: Map<string, { arrows: [string, string][]; highlights: string[] }>;
  // NAG codes keyed by node id, e.g. [1] = good move (!). Emitted as `$1` after the SAN.
  nags?: Map<string, number[]>;
}

// Standard PGN NAG tokens emitted after a move's SAN, e.g. " $1 $5".
function buildNags(nodeId: string, extras?: PgnExtras): string {
  const nags = extras?.nags?.get(nodeId);
  if (!nags || nags.length === 0) return '';
  return ' ' + nags.map((n) => `$${n}`).join(' ');
}

// Full move text for one node: SAN, then any NAGs, then the comment/annotation block.
function renderMove(node: GameNode, extras?: PgnExtras): string {
  return `${node.move!.san}${buildNags(node.id, extras)}${buildMoveComment(node.id, extras)}`;
}

// Builds the PGN comment block for a node, e.g.
// { [%clk 0:09:58] [%eval +0.24] [%csl Ye4] [%cal Ye2e4] My comment }
function buildMoveComment(nodeId: string, extras?: PgnExtras): string {
  const parts: string[] = [];

  const meta = extras?.meta?.get(nodeId);
  if (meta?.clk != null) parts.push(`[%clk ${formatClk(meta.clk)}]`);
  if (meta?.evalText) parts.push(`[%eval ${meta.evalText}]`);

  const highlights = extras?.annotations?.get(nodeId)?.highlights ?? [];
  if (highlights.length > 0) {
    parts.push(`[%csl ${highlights.map(sq => `Y${sq}`).join(',')}]`);
  }

  const arrows = extras?.annotations?.get(nodeId)?.arrows ?? [];
  if (arrows.length > 0) {
    parts.push(`[%cal ${arrows.map(([f, t]) => `Y${f}${t}`).join(',')}]`);
  }

  // All comment sources merge into the single PGN comment text.
  const text = (extras?.comments?.get(nodeId) ?? [])
    .map((c) => c.text.trim())
    .filter(Boolean)
    .join(' ');
  if (text) parts.push(text);

  return parts.length > 0 ? ` { ${parts.join(' ')} }` : '';
}

// Serialises the main line as a PGN string, optionally including headers and per-node annotations.
export function toMainLinePgn(root: GameNode, headers?: Record<string, string>, extras?: PgnExtras): string {
  const fenParts = root.fen.split(' ');
  let moveNum = parseInt(fenParts[5], 10);
  const startsWithBlack = fenParts[1] === 'b';

  // Collect main-line move nodes
  const mainNodes: GameNode[] = [];
  let node = root.children[0] ?? null;
  while (node?.move) {
    mainNodes.push(node);
    node = node.children[0] ?? null;
  }

  // Build move text with inline annotation comments
  let moveText = '';
  if (mainNodes.length > 0) {
    const parts: string[] = [];
    let i = 0;

    if (startsWithBlack) {
      const n = mainNodes[0];
      parts.push(`${moveNum}... ${renderMove(n, extras)}`);
      i = 1;
      moveNum++;
    }

    for (; i < mainNodes.length; i += 2) {
      const wNode = mainNodes[i];
      const bNode = mainNodes[i + 1];
      const wPart = renderMove(wNode, extras);
      if (bNode) {
        const bPart = renderMove(bNode, extras);
        parts.push(`${moveNum}. ${wPart} ${bPart}`);
      } else {
        parts.push(`${moveNum}. ${wPart}`);
      }
      moveNum++;
    }

    moveText = parts.join(' ');
  }

  if (!headers || Object.keys(headers).length === 0) {
    return moveText;
  }

  const STANDARD_ORDER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
  const written = new Set<string>();
  const headerLines: string[] = [];
  for (const key of STANDARD_ORDER) {
    if (headers[key] !== undefined) {
      headerLines.push(`[${key} "${headers[key]}"]`);
      written.add(key);
    }
  }
  for (const [key, val] of Object.entries(headers)) {
    if (!written.has(key)) headerLines.push(`[${key} "${val}"]`);
  }

  const result = headers.Result ?? '*';
  const movePart = moveText ? `${moveText} ${result}` : result;
  return `${headerLines.join('\n')}\n\n${movePart}`;
}

// Removes all moves before 'node' by making the position just before it the new root.
// Returns the new root; 'node' and all its descendants are preserved.
export function deleteMovesBeforeNode(node: GameNode): GameNode {
  if (!node.parent) return node; // already root, nothing to delete
  const newRoot = createRootNode(node.parent.fen);
  node.parent = newRoot;
  newRoot.children = [node];
  return newRoot;
}

// Removes all moves after 'node' by clearing its children (and thus all descendants).
export function deleteMovesAfterNode(node: GameNode): void {
  node.children = [];
}

// Depth-first search for a node by id.
export function findNode(root: GameNode, id: string): GameNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

// ─── Flat token list for MovesList rendering ─────────────────────────────────

export type MoveToken = {
  kind: 'move';
  node: GameNode;
  showMoveNumber: boolean;
  variationDepth: number;
};

export type VarToken = {
  kind: 'var-open' | 'var-close';
  variationDepth: number;
};

export type MoveListToken = MoveToken | VarToken;

function flattenFrom(node: GameNode, depth: number, forceNumber: boolean): MoveListToken[] {
  if (!node.move) {
    if (node.children[0]) return flattenFrom(node.children[0], depth, true);
    return [];
  }

  const tokens: MoveListToken[] = [];
  tokens.push({
    kind: 'move',
    node,
    showMoveNumber: node.move.color === 'w' || forceNumber,
    variationDepth: depth,
  });

  if (node.children.length === 0) return tokens;

  const [main, ...variations] = node.children;

  for (const varNode of variations) {
    tokens.push({ kind: 'var-open', variationDepth: depth + 1 });
    tokens.push(...flattenFrom(varNode, depth + 1, true));
    tokens.push({ kind: 'var-close', variationDepth: depth + 1 });
  }

  // After an inline variation, re-show move number if it's Black's turn (e.g. "2... Nc6")
  const forceMainNumber = variations.length > 0 && main.move?.color === 'b';
  tokens.push(...flattenFrom(main, depth, forceMainNumber));

  return tokens;
}

export function flattenTree(root: GameNode): MoveListToken[] {
  return flattenFrom(root, 0, false);
}
