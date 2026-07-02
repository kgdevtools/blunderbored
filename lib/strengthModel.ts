// The /blunderable play-strength model: node cap (consistency) + top-K softmax
// sampling (rating texture), validated by the engine-lab harness — see
// engine-lab/README.md for the measurements behind every curve here.
//
// engine-lab/run-model.mjs mirrors these functions in plain JS; if you change a
// curve, change it there too and re-run the harness.

export const RATING_MIN = 1350;
export const RATING_MAX = 2600;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const t = (elo: number) => clamp01((elo - RATING_MIN) / (RATING_MAX - RATING_MIN));

// Node budget: ~50k at 1350 up to ~1M at 2600 (geometric). Caps how deep it sees.
export function ratingToNodes(elo: number): number {
  return Math.round(50_000 * Math.pow(20, t(elo)));
}

// Sampling temperature (centipawns): high at low ratings (flatter → more likely
// to pick a worse candidate), near-zero at the top (always best).
export function ratingToTempCp(elo: number): number {
  return Math.round(140 - t(elo) * 134); // 140 … 6
}

// Candidate window: a line is only sampleable if it's within this many cp of
// the best line. This is the guard against "garbage-line sampling": at low node
// budgets MultiPV lines 2–4 are barely searched and can be outright losing —
// without the window, softmax occasionally played them, which read as a random
// blunder dropped into a calm position.
export function ratingToWindowCp(elo: number): number {
  return Math.round(250 - t(elo) * 210); // 250 … 40
}

// Candidate count: above ~2400 the temperature is so low that extra MultiPV
// lines are wasted search — drop to 2 for faster replies.
export function playMultiPv(elo: number): number {
  return elo >= 2400 ? 2 : 4;
}

// Minimum think-time (ms), purely for feel: node-capped searches can return in
// <100ms, which reads botlike. Scaled with rating (stronger "players" think a
// touch longer).
export function ratingToMinThinkMs(elo: number): number {
  return Math.round(300 + t(elo) * 400); // 300 … 700
}

// Softmax-sample a move from the top lines by their (side-to-move POV) score.
// tempCp≈0 ⇒ always the best line; larger ⇒ flatter distribution. Lines outside
// the candidate window are excluded up front, and the temperature tightens in
// decided positions (|best| > 500cp) — real players convert and resist harder
// once the game is already won or lost.
export function sampleMove(
  lines: { score: number; pv: string[] }[],
  tempCp: number,
  windowCp: number,
): string | null {
  if (lines.length === 0) return null;
  const best = lines[0].score;
  const candidates = lines.filter((l) => best - l.score <= windowCp);
  const temp = Math.abs(best) > 500 ? tempCp / 2 : tempCp;
  if (temp <= 1 || candidates.length === 1) return candidates[0].pv[0] ?? null;
  const weights = candidates.map((l) => Math.exp((l.score - best) / temp));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i].pv[0] ?? null;
  }
  return candidates[0].pv[0] ?? null;
}
