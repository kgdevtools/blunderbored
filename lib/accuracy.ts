export type MoveQuality = 'book' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export const QUALITY_META: Record<MoveQuality, { symbol: string; label: string; color: string; hex: string }> = {
  book:       { symbol: '≡',  label: 'Book',       color: 'text-zinc-500',   hex: '#71717a' },
  good:       { symbol: '',   label: 'Good',       color: 'text-teal-400',   hex: '#2dd4bf' },
  inaccuracy: { symbol: '?!', label: 'Inaccuracy', color: 'text-yellow-400', hex: '#facc15' },
  mistake:    { symbol: '?',  label: 'Mistake',    color: 'text-orange-400', hex: '#fb923c' },
  blunder:    { symbol: '??', label: 'Blunder',    color: 'text-red-500',    hex: '#ef4444' },
};

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

// Lichess-calibrated thresholds: blunder ≥30%, mistake ≥20%, inaccuracy ≥10%.
// Assumes isBook and decided-position suppression are already handled by caller.
export function classifyQuality(winPctLoss: number): MoveQuality {
  if (winPctLoss < 10) return 'good';
  if (winPctLoss < 20) return 'inaccuracy';
  if (winPctLoss < 30) return 'mistake';
  return 'blunder';
}

// Average accuracy for one side, excluding book moves.
export function computeGameAccuracy(
  moves: { moveAccuracy: number; isBook: boolean; color: 'w' | 'b' }[],
  side: 'w' | 'b',
): number {
  const relevant = moves.filter(m => m.color === side && !m.isBook);
  if (relevant.length === 0) return 100;
  return relevant.reduce((s, m) => s + m.moveAccuracy, 0) / relevant.length;
}
