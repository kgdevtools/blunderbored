// Shared solution-line helpers for puzzles — used by both Solve mode and the
// generator's puzzle-picking flow, so the two never disagree about what a
// puzzle's solution actually looks like.

import { Chess } from 'chess.js';
import { nanoid } from 'nanoid';
import type { Puzzle } from './db';
import type { MoveQuality } from './accuracy';
import type { ReviewedMove } from './analysis';

// Quality tiers worth turning into a puzzle — mirrors what used to be the
// "all flagged moves" severity filter. Move-list highlighting and the
// variation picker both key off this.
export const PUZZLE_WORTHY_QUALITIES: ReadonlySet<MoveQuality> = new Set([
  'inaccuracy', 'mistake', 'miss', 'blunder',
]);

// A puzzle solution longer than this reads as homework, not a puzzle — see
// the "max 3 moves" rule. bestLineUci/bestLineUci2 are raw, uncapped engine
// PVs, so anything built from them needs this applied.
const DRAFT_MAX_PLIES = 6;

export function playedMoveUci(fenBefore: string, san: string): string | undefined {
  try {
    const m = new Chess(fenBefore).move(san);
    return m ? m.from + m.to + (m.promotion ?? '') : undefined;
  } catch {
    return undefined;
  }
}

// Builds a draft Puzzle from a flagged move's position + one of its two
// stored engine variations. No engine requery needed — bestLineUci/
// bestLineUci2 are already full PVs from the review's deep pass; this just
// caps the length. Returns null if that variation doesn't exist.
export function buildDraftPuzzle(moves: ReviewedMove[], move: ReviewedMove, variantIndex: 0 | 1): Puzzle | null {
  const pv = variantIndex === 0 ? move.bestLineUci : move.bestLineUci2;
  if (!pv || pv.length === 0) return null;
  const line = pv.slice(0, DRAFT_MAX_PLIES);
  const prev = moves[move.moveIndex - 1];
  return {
    id: nanoid(),
    fen: move.fenBefore,
    solutionUci: line[0],
    solutionLineUci: line,
    kind: 'avoid-blunder',
    sourcePly: move.moveIndex,
    severity: move.quality,
    winPctLoss: move.winPctLoss,
    createdAt: Date.now(),
    leadingMoveSan: prev?.moveSan,
    leadingMoveUci: prev ? playedMoveUci(prev.fenBefore, prev.moveSan) : undefined,
  };
}

export function solutionLine(p: Puzzle): string[] {
  return p.solutionLineUci?.length ? p.solutionLineUci : [p.solutionUci];
}

export function applyUci(fen: string, uci: string): { fen: string; san: string; from: string; to: string } | null {
  try {
    const chess = new Chess(fen);
    const m = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: (uci[4] as 'q' | 'r' | 'b' | 'n' | undefined) ?? undefined,
    });
    return m ? { fen: chess.fen(), san: m.san, from: m.from, to: m.to } : null;
  } catch {
    return null;
  }
}

// Replays `line` from `fen`, returning every intermediate FEN (fens[0] = fen)
// and each move's SAN. Stops at the first illegal move (truncated/edited lines).
export function buildSolutionSans(fen: string, line: string[]): { fens: string[]; sans: string[] } {
  const fens = [fen];
  const sans: string[] = [];
  let cur = fen;
  for (const uci of line) {
    const r = applyUci(cur, uci);
    if (!r) break;
    cur = r.fen;
    fens.push(cur);
    sans.push(r.san);
  }
  return { fens, sans };
}

// Matches one move written as UCI ("e2e4", "e7e8q") or dash-separated UCI
// ("e2-e4", "e7-e8=q") — distinct from SAN, which never takes this shape
// (a SAN pawn push is "e4", two chars, never "e2e4").
const UCI_TOKEN_RE = /^([a-h][1-8])-?([a-h][1-8])=?([qrbn])?$/i;

// Parses whitespace-separated solution text played out from `fen`, returning
// UCI for however much parses cleanly — stops at the first token that isn't
// a legal move rather than throwing, same tolerant style as sanitizePgn's
// callers elsewhere. Accepts three interchangeable move formats per token
// (move-number tokens like "14." or "14..." are always ignored, whether or
// not the caller supplied them — numbering is regenerated on the way back
// out via numberedSolutionMoves, never trusted from input):
//   - SAN:        "Qxf7 dxc6 Qf3+" (with or without move numbers)
//   - UCI:        "f7f8q d7c6"
//   - dashed UCI: "f7-f8=q d7-c6"
export function sanTextToUci(fen: string, text: string): string[] {
  const tokens = text.trim().split(/\s+/).filter((t) => t && !/^\d+\.+$/.test(t));
  const chess = new Chess(fen);
  const uci: string[] = [];
  for (const tok of tokens) {
    const uciMatch = tok.match(UCI_TOKEN_RE);
    try {
      const m = uciMatch
        ? chess.move({ from: uciMatch[1], to: uciMatch[2], promotion: uciMatch[3]?.toLowerCase() as 'q' | 'r' | 'b' | 'n' | undefined })
        : chess.move(tok);
      if (!m) break;
      uci.push(m.from + m.to + (m.promotion ?? ''));
    } catch {
      break;
    }
  }
  return uci;
}

// Numbered SAN labels ("14. Nxe5", "14… Qh4") starting from `fen`'s move number.
export function numberedSolutionMoves(fen: string, sans: string[]): { label: string; i: number }[] {
  const parts = fen.split(' ');
  let turn = parts[1] === 'w' ? 'w' : 'b';
  let num = parseInt(parts[5] || '1', 10);
  return sans.map((san, i) => {
    const label = turn === 'w' ? `${num}. ${san}` : `${num}… ${san}`;
    if (turn === 'b') num++;
    turn = turn === 'w' ? 'b' : 'w';
    return { label, i };
  });
}
