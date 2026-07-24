// Builds an *enriched* PGN suitable for handing off to /board: the original
// comments/clk/arrows, plus the reviewer's per-move eval ([%eval]) and quality
// verdict (NAG), and any extra caller-supplied comments layered on top. The
// board re-parses this so all of it shows up there too. Shared between
// ReviewerShell's "Open in Board" and PuzzleGeneratorShell's equivalent.

import { Chess, DEFAULT_POSITION } from 'chess.js';
import type { GameReview } from './analysis';
import type { MoveQuality } from './accuracy';
import { createRootNode, addMove, toMainLinePgn, sanitizePgn, type GameNode } from './gameTree';
import { extractNodeData } from './pgnImport';

// Move quality → standard PGN NAG code. good/excellent/best/book/forced carry no glyph.
const QUALITY_NAG: Partial<Record<MoveQuality, number>> = {
  brilliant: 3,  // !!
  great: 1,      // !
  inaccuracy: 6, // ?!
  mistake: 2,    // ?
  miss: 2,       // ? (a missed win reads as a mistake in standard NAGs)
  blunder: 4,    // ??
};

// White-perspective centipawns → a PGN [%eval] token (pawns, or #-mate).
function formatEvalToken(cp: number): string {
  if (cp >= 9900) return '#1';
  if (cp <= -9900) return '#-1';
  const v = cp / 100;
  return (v >= 0 ? '+' : '') + v.toFixed(2);
}

export function buildEnrichedPgn(
  originalPgn: string,
  review: GameReview,
  headers: Record<string, string>,
  extraComments?: Map<number, string>,
): string {
  const clean = sanitizePgn(originalPgn);
  const chess = new Chess();
  chess.loadPgn(clean);
  const history = chess.history({ verbose: true });
  const root = createRootNode(history[0]?.before ?? DEFAULT_POSITION);
  const mainNodes: GameNode[] = [];
  let node = root;
  for (const m of history) { node = addMove(node, m, m.after); mainNodes.push(node); }

  // Start from the PGN's own annotations, then overlay the reviewer's.
  const data = extractNodeData(chess, clean, root, mainNodes);
  for (const rm of review.moves) {
    const n = mainNodes[rm.moveIndex];
    if (!n) continue;
    data.meta.set(n.id, { ...(data.meta.get(n.id) ?? {}), evalText: formatEvalToken(rm.evalAfter) });
    const nag = QUALITY_NAG[rm.quality];
    if (nag) {
      const cur = data.nags.get(n.id) ?? [];
      if (!cur.includes(nag)) data.nags.set(n.id, [...cur, nag]);
    }
  }
  extraComments?.forEach((text, moveIndex) => {
    const n = mainNodes[moveIndex];
    if (!n || !text.trim()) return;
    const list = data.comments.get(n.id) ?? [];
    data.comments.set(n.id, [...list, { source: 'reviewer', text: text.trim() }]);
  });

  const annForExport = new Map(
    [...data.annotations].map(([id, a]) => [id, { arrows: a.arrows, highlights: a.highlights }]),
  );
  return toMainLinePgn(root, headers, {
    comments: data.comments,
    meta: data.meta,
    annotations: annForExport,
    nags: data.nags,
  });
}
