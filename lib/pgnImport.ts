// Parse-in layer: recover the per-node data a PGN carries that chess.js's move
// history alone throws away — free-text comments, [%clk]/[%eval] tokens,
// [%cal]/[%csl] arrows & highlights, and main-line NAG glyphs. Without this the
// board would silently drop everything an imported game was annotated with.
//
// chess.js keys comments by the FEN *after* the move, which is exactly each
// GameNode.fen, so comments map cleanly onto nodes. NAGs have no chess.js API in
// 1.x, so they're recovered with a defensive main-line movetext scan.

import { Chess } from 'chess.js';
import { sanitizePgn, type GameNode, type NodeAnnotation, type NodeMeta } from './gameTree';
import type { StoredAnnotation } from './db';
import { newDecorationId, type ArrowDecoration, type HighlightDecoration, type DecorationColor } from './decorations';

export interface ImportedNodeData {
  comments: Map<string, NodeAnnotation[]>;
  meta: Map<string, NodeMeta>;
  annotations: Map<string, {
    arrows: ArrowDecoration[];
    highlights: HighlightDecoration[];
  }>;
  nags: Map<string, number[]>;
}

// Shared PGN header-tag parser (single implementation — callers previously
// each carried their own ad-hoc regex).
export function parsePgnHeaders(pgn: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const m of pgn.matchAll(/^\[(\w+)\s+"([^"]*)"\]/gm)) headers[m[1]] = m[2];
  return headers;
}

// ─── Comment-token parsing ────────────────────────────────────────────────────

interface ParsedComment {
  meta: NodeMeta;
  arrows: ArrowDecoration[];
  highlights: HighlightDecoration[];
  text: string; // free text with all [%...] tokens stripped
}

function parseClkSeconds(token: string): number | null {
  const m = token.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3]);
}

const KNOWN_PGN_COLORS = new Set(['R', 'G', 'B', 'Y']);

// A square spec inside %cal/%csl is an optional colour letter (R/G/Y/B) then
// algebraic squares: "Ye2e4" → arrow e2→e4, "Re4" → highlight e4. Splits off
// that colour letter instead of discarding it, so the PGN's own colour choice
// survives into storage and rendering. Unrecognised letters (rare, non-
// standard exports) fall back to no colour rather than widening our type.
function splitColour(spec: string): { color?: DecorationColor; rest: string } {
  const m = spec.match(/^([A-Za-z])(?=[a-h])/);
  if (!m) return { rest: spec };
  const letter = m[1].toUpperCase();
  return { color: KNOWN_PGN_COLORS.has(letter) ? (letter as DecorationColor) : undefined, rest: spec.slice(1) };
}

function parseComment(raw: string): ParsedComment {
  const meta: NodeMeta = {};
  const arrows: ArrowDecoration[] = [];
  const highlights: HighlightDecoration[] = [];
  let order = 0;

  const clk = raw.match(/\[%clk\s+([^\]]+)\]/);
  if (clk) {
    const secs = parseClkSeconds(clk[1]);
    if (secs != null) meta.clk = secs;
  }

  const ev = raw.match(/\[%eval\s+([^\]]+)\]/);
  if (ev) meta.evalText = ev[1].trim();

  const csl = raw.match(/\[%csl\s+([^\]]+)\]/);
  if (csl) {
    for (const part of csl[1].split(',')) {
      const { color, rest } = splitColour(part.trim());
      if (/^[a-h][1-8]$/.test(rest)) highlights.push({ id: newDecorationId(), order: order++, square: rest, color });
    }
  }

  const cal = raw.match(/\[%cal\s+([^\]]+)\]/);
  if (cal) {
    for (const part of cal[1].split(',')) {
      const { color, rest } = splitColour(part.trim());
      const mm = rest.match(/^([a-h][1-8])([a-h][1-8])$/);
      if (mm) arrows.push({ id: newDecorationId(), order: order++, from: mm[1], to: mm[2], color });
    }
  }

  // Strip every [%...] token, then collapse leftover whitespace → free text.
  const text = raw.replace(/\[%[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();

  return { meta, arrows, highlights, text };
}

// ─── Main-line NAG recovery ───────────────────────────────────────────────────

// Returns ply-index → NAG codes for the main line only. Comments and variations
// are stripped first so the remaining tokens are a flat move sequence; a `$N`
// token attaches to the most recently seen move. Defensive by design: any parse
// trouble yields an empty map rather than throwing.
function parseMainLineNags(cleanPgn: string): Map<number, number[]> {
  const out = new Map<number, number[]>();
  try {
    // Drop header tags and the leading blank line.
    let body = cleanPgn.replace(/^\[[^\]]*\]\s*$/gm, '');
    // Drop brace comments (PGN comments don't nest).
    body = body.replace(/\{[^}]*\}/g, ' ');
    // Drop variations, innermost-first, until none remain.
    let prev: string;
    do {
      prev = body;
      body = body.replace(/\([^()]*\)/g, ' ');
    } while (body !== prev);

    let ply = -1;
    for (let tok of body.split(/\s+/)) {
      if (!tok) continue;
      tok = tok.replace(/^\d+\.+/, ''); // strip a leading move number ("12." / "12...")
      if (!tok) continue;
      if (tok === '*' || /^(1-0|0-1|1\/2-1\/2)$/.test(tok)) continue;
      if (tok.startsWith('$')) {
        const code = parseInt(tok.slice(1), 10);
        if (ply >= 0 && Number.isFinite(code)) {
          const arr = out.get(ply) ?? [];
          arr.push(code);
          out.set(ply, arr);
        }
        continue;
      }
      ply++; // a SAN move advances the ply counter
    }
  } catch {
    return new Map();
  }
  return out;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

// `mainNodes` are the move nodes in ply order (history order); `root` carries
// any pre-game comment keyed by the start FEN.
export function extractNodeData(
  chess: Chess,
  cleanPgn: string,
  root: GameNode,
  mainNodes: GameNode[],
): ImportedNodeData {
  const comments = new Map<string, NodeAnnotation[]>();
  const meta = new Map<string, NodeMeta>();
  const annotations = new Map<string, {
    arrows: ArrowDecoration[];
    highlights: HighlightDecoration[];
  }>();
  const nags = new Map<string, number[]>();

  // FEN → first node carrying it (root then main line). Repeated positions
  // (e.g. repetitions) collapse to their earliest node — chess.js's own
  // comment map has the same one-per-FEN limitation.
  const fenToNode = new Map<string, GameNode>();
  for (const n of [root, ...mainNodes]) {
    if (!fenToNode.has(n.fen)) fenToNode.set(n.fen, n);
  }

  for (const { fen, comment } of chess.getComments()) {
    const node = fenToNode.get(fen);
    if (!node || !comment) continue;
    const parsed = parseComment(comment);
    if (parsed.text) comments.set(node.id, [{ source: 'pgn', text: parsed.text }]);
    if (parsed.meta.clk != null || parsed.meta.evalText) meta.set(node.id, parsed.meta);
    if (parsed.arrows.length || parsed.highlights.length) {
      annotations.set(node.id, { arrows: parsed.arrows, highlights: parsed.highlights });
    }
  }

  const plyNags = parseMainLineNags(cleanPgn);
  for (const [ply, codes] of plyNags) {
    const node = mainNodes[ply];
    if (node && codes.length) nags.set(node.id, codes);
  }

  return { comments, meta, annotations, nags };
}

// ─── Ply-keyed extraction (for bulk import / persistence) ─────────────────────

// Persisted per-node data is keyed by *main-line ply index* (0-based), not the
// session-only node id, so it survives a save → reload round-trip regardless of
// when the tree was built. This parses a single game's PGN straight into that
// ply-keyed shape without needing a GameNode tree.
export interface PlyKeyedAnnotations {
  nodeComments: Record<string, NodeAnnotation[]>;
  nodeMeta: Record<string, NodeMeta>;
  annotations: Record<string, StoredAnnotation>;
  nags: Record<string, number[]>;
}

export function parseGameAnnotations(pgn: string): PlyKeyedAnnotations | null {
  const clean = sanitizePgn(pgn);
  const chess = new Chess();
  try {
    chess.loadPgn(clean);
  } catch {
    return null;
  }
  const history = chess.history({ verbose: true });

  const nodeComments: Record<string, NodeAnnotation[]> = {};
  const nodeMeta: Record<string, NodeMeta> = {};
  const annotations: Record<string, StoredAnnotation> = {};
  const nags: Record<string, number[]> = {};

  const byFen = new Map(chess.getComments().map((c) => [c.fen, c.comment]));
  history.forEach((h, ply) => {
    const raw = byFen.get(h.after);
    if (!raw) return;
    const p = parseComment(raw);
    const key = String(ply);
    if (p.text) nodeComments[key] = [{ source: 'pgn', text: p.text }];
    if (p.meta.clk != null || p.meta.evalText) nodeMeta[key] = p.meta;
    if (p.arrows.length || p.highlights.length) {
      annotations[key] = {
        arrows: p.arrows,
        highlights: p.highlights,
        history: [
          ...p.arrows.map((a) => ({ kind: 'arrow' as const, id: a.id })),
          ...p.highlights.map((h) => ({ kind: 'highlight' as const, id: h.id })),
        ],
      };
    }
  });

  for (const [ply, codes] of parseMainLineNags(clean)) {
    if (codes.length) nags[String(ply)] = codes;
  }

  // Nothing worth storing? Let the caller fall back to empty defaults.
  if (!Object.keys(nodeComments).length && !Object.keys(nodeMeta).length &&
      !Object.keys(annotations).length && !Object.keys(nags).length) {
    return null;
  }
  return { nodeComments, nodeMeta, annotations, nags };
}
