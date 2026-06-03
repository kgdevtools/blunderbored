// Derived series + summaries for the Game Report. Pure functions over the
// already-computed GameReview — no engine work.

import type { GameReview, ReviewedMove, GamePhase } from './analysis';
import { winP } from './accuracy';

// Win% from a given side's perspective for a White-POV centipawn eval.
function sideWinP(evalWhiteCp: number, color: 'w' | 'b'): number {
  return color === 'w' ? winP(evalWhiteCp) : winP(-evalWhiteCp);
}

// Average centipawn loss per side (book moves contribute ~0, kept for simplicity).
export function acpl(moves: ReviewedMove[]): { w: number; b: number } {
  const mean = (side: 'w' | 'b') => {
    const xs = moves.filter((m) => m.color === side && !m.isBook);
    return xs.length ? xs.reduce((s, m) => s + m.cpLoss, 0) / xs.length : 0;
  };
  return { w: Math.round(mean('w')), b: Math.round(mean('b')) };
}

export interface PhaseAccuracy {
  phase: GamePhase;
  w: number | null;
  b: number | null;
}

export function accuracyByPhase(moves: ReviewedMove[]): PhaseAccuracy[] {
  const phases: GamePhase[] = ['opening', 'middlegame', 'endgame'];
  return phases.map((phase) => {
    const side = (c: 'w' | 'b') => {
      const xs = moves.filter((m) => m.phase === phase && m.color === c && !m.isBook);
      return xs.length ? Math.round(xs.reduce((s, m) => s + m.moveAccuracy, 0) / xs.length) : null;
    };
    return { phase, w: side('w'), b: side('b') };
  });
}

// Expected score (0–1) from average win% across the game — the "xG of chess":
// how much the positions you reached were worth, vs the actual result.
export function expectedScore(moves: ReviewedMove[]): { w: number; b: number } {
  if (moves.length === 0) return { w: 0.5, b: 0.5 };
  const meanWhite = moves.reduce((s, m) => s + winP(m.evalAfter), 0) / moves.length / 100;
  return { w: meanWhite, b: 1 - meanWhite };
}

// Biggest swings (turning points) — non-book moves with the largest win% loss.
export function turningPoints(moves: ReviewedMove[], n = 4): ReviewedMove[] {
  return [...moves]
    .filter((m) => !m.isBook && m.winPctLoss >= 10)
    .sort((a, b) => b.winPctLoss - a.winPctLoss)
    .slice(0, n);
}

// "Let it slip": a sub-par move made while the mover was already clearly winning.
export function slips(moves: ReviewedMove[]): ReviewedMove[] {
  return moves.filter(
    (m) => !m.isBook && m.quality !== 'good' && sideWinP(m.evalBefore, m.color) >= 75,
  );
}

// How many library games have been analysed (for the rating-estimate unlock).
export const RATING_UNLOCK_AT = 20;

export interface ReportSummary {
  acpl: { w: number; b: number };
  byPhase: PhaseAccuracy[];
  expected: { w: number; b: number };
  turning: ReviewedMove[];
  slipped: ReviewedMove[];
}

export function buildReport(review: GameReview): ReportSummary {
  return {
    acpl: acpl(review.moves),
    byPhase: accuracyByPhase(review.moves),
    expected: expectedScore(review.moves),
    turning: turningPoints(review.moves),
    slipped: slips(review.moves),
  };
}
