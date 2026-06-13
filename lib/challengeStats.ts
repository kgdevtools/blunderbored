// Performance analytics derived from finished /blunderable challenges. Pure
// functions over ChallengeReport[]; the charts in PerformanceCharts.tsx render
// these. Estimates are deliberately rough but defensible — all clamped 0–100.

import { winP, moveAccuracy } from './accuracy';
import type { ChallengeReport } from './db';

const clamp = (x: number) => Math.max(0, Math.min(100, x));

// Per-challenge accuracy: average Lichess move-accuracy from each move's self-loss.
export function challengeAccuracy(r: ChallengeReport): number {
  if (!r.moves.length) return 100;
  const accs = r.moves.map((m) => moveAccuracy(m.wpLoss ?? 0, 0));
  return accs.reduce((s, v) => s + v, 0) / accs.length;
}

export function endEvalCp(r: ChallengeReport): number {
  const last = r.moves[r.moves.length - 1];
  return last ? (last.engineEvalCp ?? last.evalCp ?? r.e0Cp) : r.e0Cp;
}

// Win% surrendered start→end (player POV; winP is symmetric so a player-POV cp
// maps straight to the player's win probability). 0 = held or improved.
export function evalSurrenderedWp(r: ChallengeReport): number {
  return Math.max(0, winP(r.e0Cp) - winP(endEvalCp(r)));
}

// ─── Skill-facet radar ────────────────────────────────────────────────────────

export interface Facets {
  survival: number;    // pass rate
  tactics: number;     // blunder-free play
  technique: number;   // low cumulative drift
  time: number;        // clock management (no flags, not too slow)
  conversion: number;  // held / improved the eval
}

export const FACET_LABELS: Record<keyof Facets, string> = {
  survival: 'Survival', tactics: 'Tactics', technique: 'Technique', time: 'Time', conversion: 'Conversion',
};

export function aggregateFacets(reports: ChallengeReport[]): Facets {
  const n = reports.length;
  if (!n) return { survival: 0, tactics: 0, technique: 0, time: 0, conversion: 0 };

  let moves = 0, blunders = 0, sumCumWp = 0, flagged = 0, sumSecPerMove = 0, sumSurrender = 0;
  for (const r of reports) {
    moves += r.moves.length;
    blunders += r.moves.filter((m) => m.cls === 'blunder').length;
    sumCumWp += r.cumulativeWp ?? r.moves.reduce((s, m) => s + (m.wpLoss ?? 0), 0);
    if (r.endReason === 'flagged' && r.result === 'failed') flagged += 1;
    const secs = r.moves.reduce((s, m) => s + m.clockMs, 0) / 1000;
    sumSecPerMove += r.moves.length ? secs / r.moves.length : 0;
    sumSurrender += evalSurrenderedWp(r);
  }
  const succ = reports.filter((r) => r.result === 'succeeded').length;
  const blunderRate = moves ? blunders / moves : 0;

  return {
    survival: clamp((succ / n) * 100),
    tactics: clamp(100 - blunderRate * 100 * 8),
    technique: clamp(100 - (sumCumWp / n) * 5),
    time: clamp(100 - (flagged / n) * 80 - Math.max(0, sumSecPerMove / n - 10) * 2),
    conversion: clamp(100 - (sumSurrender / n) * 3),
  };
}

// ─── Series for the line / bar / scatter charts ───────────────────────────────

export interface ChallengePoint { t: number; accuracy: number; rating: number | null; succeeded: boolean; }

// Chronological accuracy points (oldest → newest) for the trend line.
export function accuracySeries(reports: ChallengeReport[]): ChallengePoint[] {
  return [...reports]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => ({ t: r.createdAt, accuracy: challengeAccuracy(r), rating: r.ratingElo ?? null, succeeded: r.result === 'succeeded' }));
}

export interface RatingBand { label: string; lo: number; hi: number; count: number; successPct: number; }

const BANDS: [string, number, number][] = [
  ['<1600', 0, 1600],
  ['1600–1900', 1600, 1900],
  ['1900–2200', 1900, 2200],
  ['2200+', 2200, 9999],
];

// Success rate by opponent-rating band (challenges with a rating only).
export function successByRatingBand(reports: ChallengeReport[]): RatingBand[] {
  return BANDS.map(([label, lo, hi]) => {
    const inBand = reports.filter((r) => r.ratingElo != null && r.ratingElo >= lo && r.ratingElo < hi);
    const succ = inBand.filter((r) => r.result === 'succeeded').length;
    return { label, lo, hi, count: inBand.length, successPct: inBand.length ? (succ / inBand.length) * 100 : 0 };
  });
}
