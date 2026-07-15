// NOTE: relative imports here carry explicit .ts extensions so this module
// (and lib/accuracy.ts) can run directly under Node's type-stripping for the
// scripts/*.test.mjs suites. Keep this file free of browser/engine imports.
import { Chess } from 'chess.js';
import { CLASSIFY, classifyQuality } from './accuracy.ts';
import type { MoveQuality } from './accuracy.ts';

// ── Game phase ────────────────────────────────────────────────────────────────

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

export function classifyPhase(fen: string): GamePhase {
  const board = fen.split(' ')[0];
  const count = (board.match(/[PNBRQK]/gi) ?? []).length;
  const queens = (board.match(/[qQ]/g) ?? []).length;
  const fullmove = parseInt(fen.split(' ')[5] ?? '1', 10) || 1;
  if (count <= 12 || (queens === 0 && count <= 16)) return 'endgame';
  // Raw piece-count alone kept whole games in "opening" (few captures ≠ still
  // in the opening) — gate it on the move number as well.
  if (fullmove <= 10 && count >= 24) return 'opening';
  return 'middlegame';
}

// ── classifyMove ──────────────────────────────────────────────────────────────
//
// Full-tier classifier. Base tiers come from win%-loss (classifyQuality);
// overlay tiers are applied with first-match-wins precedence:
//   forced → book → brilliant → great → best → miss → base (excellent promotion)
//
// Win% inputs are all from the MOVING side's perspective. line1Wp/line2Wp come
// from the deep MultiPV-2 pass and are undefined for moves that never went
// deep — every rule that needs them simply doesn't fire then.

export interface ClassifyInput {
  winPctLoss:     number;  // ≥ 0
  wpBefore:       number;  // mover win% before the move
  wpAfter:        number;  // mover win% after the move
  playedIsBest:   boolean; // played the engine's top move
  isBook:         boolean;
  legalMoveCount: number;  // legal moves at fenBefore
  missedMate:     boolean; // forced mate was on and was let slip
  isSacrifice:    boolean; // see detectSacrifice
  line1Wp?:       number;  // mover win% of the engine's best line (deep pass)
  line2Wp?:       number;  // mover win% of the 2nd-best line (deep pass)
}

export function classifyMove(inp: ClassifyInput): MoveQuality {
  const wpl = Math.max(0, inp.winPctLoss);
  const hasSecond = inp.line1Wp !== undefined && inp.line2Wp !== undefined;

  // forced: literally no choice, or the single non-losing move.
  if (inp.legalMoveCount === 1) return 'forced';
  if (
    hasSecond && inp.playedIsBest &&
    inp.line2Wp! <= CLASSIFY.FORCED_ALT_MAX_WP &&
    inp.line1Wp! - inp.line2Wp! >= CLASSIFY.FORCED_GAP_MIN_WP
  ) return 'forced';

  if (inp.isBook) return 'book';

  // brilliant: a sound sacrifice — material genuinely given up, yet the mover
  // isn't losing after it and wasn't already trivially winning before it.
  if (
    inp.playedIsBest && inp.isSacrifice &&
    inp.wpAfter >= CLASSIFY.BRILLIANT_MIN_WP_AFTER &&
    inp.wpBefore <= CLASSIFY.BRILLIANT_MAX_WP_BEFORE
  ) return 'brilliant';

  // great: the only good move (big win% gap to the 2nd-best line).
  if (
    hasSecond && inp.playedIsBest &&
    inp.line1Wp! - inp.line2Wp! >= CLASSIFY.GREAT_GAP_MIN_WP
  ) return 'great';

  if (inp.playedIsBest) return 'best';

  // miss: a real chance existed (winning position or forced mate) and the
  // error let it slip — but only in the inaccuracy/mistake band; a full
  // blunder stays a blunder.
  const base = classifyQuality(wpl);
  if (
    (base === 'inaccuracy' || base === 'mistake') &&
    (inp.missedMate || inp.wpBefore >= CLASSIFY.MISS_MIN_WP_BEFORE)
  ) return 'miss';

  if (base === 'good' && wpl <= CLASSIFY.EXCELLENT_MAX_WPL) return 'excellent';
  return base;
}

// ── Critical-move selection (pass 1 → pass 2 hand-off) ───────────────────────

export const CRITICAL_SWING_CP = 150;

export interface CriticalInput {
  provisional:        MoveQuality;
  mateInvolved:       boolean; // mate score at either endpoint
  playedIsBest:       boolean; // candidate for best/great/brilliant/forced
  swingCp:            number;  // |evalAfter − evalBefore|, White POV
  sacrificeCandidate: boolean;
  unscored:           boolean; // an endpoint eval failed in pass 1
}

// Returns indices of moves that deserve the deep MultiPV-2 pass.
export function selectCriticals(
  moves: CriticalInput[],
  swingThreshold: number = CRITICAL_SWING_CP,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (
      m.provisional === 'inaccuracy' || m.provisional === 'mistake' ||
      m.provisional === 'blunder' || m.provisional === 'miss' ||
      m.mateInvolved || m.playedIsBest || m.unscored ||
      m.sacrificeCandidate || m.swingCp >= swingThreshold
    ) out.push(i);
  }
  return out;
}

// ── Sacrifice detection (SEE-lite over the engine PV) ────────────────────────

const PIECE_CP: Record<string, number> = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };

// Mover's material balance (mover − opponent), in cp.
function materialBalance(chess: Chess, mover: 'w' | 'b'): number {
  let bal = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq) continue;
      bal += (sq.color === mover ? 1 : -1) * PIECE_CP[sq.type];
    }
  }
  return bal;
}

// A move is a sacrifice when, after playing it and following the engine PV for
// up to `window` further plies, the mover has given up ≥ BRILLIANT_SAC_MIN_CP
// of material that never comes back within the window. `pv` is the engine's
// principal variation from fenBefore whose first move is the played move (so
// this is only meaningful when the played move IS the engine's top move).
export function detectSacrifice(fenBefore: string, pv: string[], window = 4): boolean {
  if (pv.length === 0) return false;
  let chess: Chess;
  try {
    chess = new Chess(fenBefore);
  } catch {
    return false;
  }
  const mover = chess.turn();
  const before = materialBalance(chess, mover);
  let minNet = 0;
  const plies = Math.min(pv.length, 1 + window);
  for (let i = 0; i < plies; i++) {
    const uci = pv[i];
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as 'q' | 'r' | 'b' | 'n' | undefined) ?? undefined });
    } catch {
      break;
    }
    // Only measure at points where the opponent has had the chance to take —
    // i.e. after opponent replies (odd ply counts complete an exchange).
    const net = materialBalance(chess, mover) - before;
    if (i % 2 === 1 && net < minNet) minNet = net;
  }
  // Balance at the end of the window is what counts: given up and NOT recovered.
  const endNet = materialBalance(chess, mover) - before;
  return endNet <= -CLASSIFY.BRILLIANT_SAC_MIN_CP && minNet <= -CLASSIFY.BRILLIANT_SAC_MIN_CP;
}

// Legal move count at a FEN (for the forced tier).
export function countLegalMoves(fen: string): number {
  try {
    return new Chess(fen).moves().length;
  } catch {
    return 0;
  }
}
