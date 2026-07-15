export type MoveQuality =
  | 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'book'
  | 'inaccuracy' | 'mistake' | 'miss' | 'blunder' | 'forced';

export const QUALITY_META: Record<MoveQuality, { symbol: string; label: string; color: string; hex: string }> = {
  brilliant:  { symbol: '!!', label: 'Brilliant',  color: 'text-cyan-400',    hex: '#22d3ee' },
  great:      { symbol: '!',  label: 'Great',      color: 'text-blue-400',    hex: '#60a5fa' },
  best:       { symbol: '★',  label: 'Best',       color: 'text-green-400',   hex: '#4ade80' },
  excellent:  { symbol: '',   label: 'Excellent',  color: 'text-emerald-400', hex: '#34d399' },
  good:       { symbol: '',   label: 'Good',       color: 'text-teal-400',    hex: '#2dd4bf' },
  book:       { symbol: '≡',  label: 'Book',       color: 'text-zinc-500',    hex: '#71717a' },
  inaccuracy: { symbol: '?!', label: 'Inaccuracy', color: 'text-yellow-400',  hex: '#facc15' },
  mistake:    { symbol: '?',  label: 'Mistake',    color: 'text-orange-400',  hex: '#fb923c' },
  miss:       { symbol: '×',  label: 'Miss',       color: 'text-amber-500',   hex: '#f59e0b' },
  blunder:    { symbol: '??', label: 'Blunder',    color: 'text-red-500',     hex: '#ef4444' },
  forced:     { symbol: '□',  label: 'Forced',     color: 'text-zinc-400',    hex: '#a1a1aa' },
};

// Classification thresholds. Win%-loss values are points on the 0–100 winP
// scale below. Lichess defines its judgments on a −1..+1 winning-chances scale
// (inaccuracy 0.1 / mistake 0.2 / blunder 0.3), which converts to 5/10/15
// points here — NOT 10/20/30 (that earlier calibration was a 2× scale error;
// verified against a lichess server review 2026-07-14).
// The puzzle generator consumes these same constants — keep them exported.
export const CLASSIFY = {
  /** wpl ≤ this and not the top move → 'excellent' */
  EXCELLENT_MAX_WPL: 1,
  /** wpl below this → 'good' (5 = lichess inaccuracy onset) */
  GOOD_MAX_WPL: 5,
  /** wpl below this → 'inaccuracy' */
  INACCURACY_MAX_WPL: 10,
  /** wpl below this → 'mistake'; at/above → 'blunder' */
  MISTAKE_MAX_WPL: 15,
  /** forced: best played, 2nd line win% ≤ this … */
  FORCED_ALT_MAX_WP: 10,
  /** … and best-vs-2nd win% gap ≥ this */
  FORCED_GAP_MIN_WP: 25,
  /** brilliant: material given up (cp) and unrecovered in the PV window.
   *  200 = lichess tagger's "dips ≥ 2 pawns" — covers minor-for-pawn (Greek
   *  gift nets −200) and exchange sacs; a plain pawn sac doesn't qualify. */
  BRILLIANT_SAC_MIN_CP: 200,
  /** brilliant: mover's win% after the move must stay ≥ this (not losing) */
  BRILLIANT_MIN_WP_AFTER: 45,
  /** brilliant: mover's win% before must be ≤ this (not already trivially won) */
  BRILLIANT_MAX_WP_BEFORE: 90,
  /** great: best played and best-vs-2nd win% gap ≥ this (the only good move) */
  GREAT_GAP_MIN_WP: 12,
  /** miss: mover's win% before ≥ this and the chance slipped (5 ≤ wpl < 15) */
  MISS_MIN_WP_BEFORE: 72,
} as const;

// Lichess sigmoid: centipawns (White's perspective) → win% (0–100)
export function winP(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

// Lichess per-move accuracy. Inputs are win% from the MOVING side's perspective.
export function moveAccuracy(wpBefore: number, wpAfter: number): number {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * (wpBefore - wpAfter)) - 3.1669));
}

// Returns win% values and loss, all from the moving side's perspective.
// Inputs evalBefore/evalAfter are always from White's perspective (cp).
export function winPctLossForSide(
  evalBefore: number,
  evalAfter: number,
  color: 'w' | 'b',
): { wpBefore: number; wpAfter: number; winPctLoss: number } {
  const wpBefore = color === 'w' ? winP(evalBefore)  : winP(-evalBefore);
  const wpAfter  = color === 'w' ? winP(evalAfter)   : winP(-evalAfter);
  return { wpBefore, wpAfter, winPctLoss: wpBefore - wpAfter };
}

// Base tier by win%-loss alone (5/10/15 — see CLASSIFY note above). Overlay
// tiers (brilliant/great/best/excellent/miss/forced/book) are applied by
// classifyMove in lib/classification.ts.
export function classifyQuality(winPctLoss: number): MoveQuality {
  if (winPctLoss < CLASSIFY.GOOD_MAX_WPL) return 'good';
  if (winPctLoss < CLASSIFY.INACCURACY_MAX_WPL) return 'inaccuracy';
  if (winPctLoss < CLASSIFY.MISTAKE_MAX_WPL) return 'mistake';
  return 'blunder';
}

// Tiers excluded from accuracy averaging: no meaningful choice was made.
export const ACCURACY_EXCLUDED: ReadonlySet<MoveQuality> = new Set(['book', 'forced']);
