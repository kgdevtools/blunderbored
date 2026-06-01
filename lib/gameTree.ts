import type { Move } from 'chess.js';

export interface GameNode {
  id: string;
  fen: string;
  move: Move | null;      // null for the root node
  parent: GameNode | null;
  children: GameNode[];   // children[0] is the main-line continuation
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
  comments?: Map<string, string>;
  // arrows: [from, to][] and highlights: square[] keyed by node id
  annotations?: Map<string, { arrows: [string, string][]; highlights: string[] }>;
}

// Builds the PGN comment block for a node, e.g. { [%csl Ye4] [%cal Ye2e4] My comment }
function buildMoveComment(nodeId: string, extras?: PgnExtras): string {
  const parts: string[] = [];

  const highlights = extras?.annotations?.get(nodeId)?.highlights ?? [];
  if (highlights.length > 0) {
    parts.push(`[%csl ${highlights.map(sq => `Y${sq}`).join(',')}]`);
  }

  const arrows = extras?.annotations?.get(nodeId)?.arrows ?? [];
  if (arrows.length > 0) {
    parts.push(`[%cal ${arrows.map(([f, t]) => `Y${f}${t}`).join(',')}]`);
  }

  const comment = extras?.comments?.get(nodeId);
  if (comment) parts.push(comment);

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
      parts.push(`${moveNum}... ${n.move!.san}${buildMoveComment(n.id, extras)}`);
      i = 1;
      moveNum++;
    }

    for (; i < mainNodes.length; i += 2) {
      const wNode = mainNodes[i];
      const bNode = mainNodes[i + 1];
      const wPart = `${wNode.move!.san}${buildMoveComment(wNode.id, extras)}`;
      if (bNode) {
        const bPart = `${bNode.move!.san}${buildMoveComment(bNode.id, extras)}`;
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
