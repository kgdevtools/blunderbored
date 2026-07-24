// Spaced-repetition scheduler for /learn-from-mistakes, ported from Lucas
// Chess's Leitner.py (github.com/lukasmonk/lucaschessR6) — box math and
// session-composition logic only; no Python dependency, pure TS, no
// React/UI coupling (same shape as lib/blunder.ts / lib/classification.ts).
//
// Sessions are counted, not dated: each visit to the practice page that pulls
// a batch of puzzles is "one session" (current_num_session in the original),
// and a box-N item becomes due again N sessions after it was last served —
// the same mechanism Lucas Chess's desktop trainer uses for one sitting at a
// time, which maps naturally onto "one practice run" here too.

export const NUM_BOXES = 4;
export const WIN_BOX = NUM_BOXES + 1; // 5 — "mastered"

export interface LeitnerState {
  puzzleId: string;
  box: number;                 // 0 = untried, 1-4 = in progress, WIN_BOX = mastered
  lastSessionNum: number;
  masteredAtSession?: number;  // set when box first reached WIN_BOX — orders mastered filler oldest-first
}

// Probabilistic rounding — over many sessions this converges to the exact
// target percentage rather than always rounding the same direction.
function roundProb(value: number): number {
  const lower = Math.floor(value);
  const upper = Math.ceil(value);
  if (lower === upper) return Math.max(lower, 1);
  const probability = value - lower;
  return Math.max(Math.random() < probability ? upper : lower, 1);
}

// Exponentially-weighted percentage split across `n` boxes, each guaranteed
// at least `minimo`%, biased toward the earlier (lower) boxes by `factorCaida`.
// The rounding remainder is folded into index 1 (box 2's slot) — an
// arbitrary-looking but deliberate choice preserved from the original.
function distributeExponentially(n: number, minimo: number, factorCaida: number): number[] {
  if (n <= 0) return [];
  const total = 100;
  const totalVariable = total - n * minimo;
  const pesos = Array.from({ length: n }, (_, i) => Math.exp(-factorCaida * i));
  const sumaPesos = pesos.reduce((a, b) => a + b, 0);
  const reparto = pesos.map((p) => Math.round(((p / sumaPesos) * totalVariable + minimo) * 100) / 100);
  const diferencia = Math.round((total - reparto.reduce((a, b) => a + b, 0)) * 100) / 100;
  if (reparto.length > 1) reparto[1] += diferencia;
  return reparto;
}

// Index 0 is unused (box 0/untried is always "take everything still needed"
// rather than a weighted slice, see buildSession); indices 1..NUM_BOXES drive
// the weighted session composition.
export const BOX_PERCENTAGES: number[] = [100, ...distributeExponentially(NUM_BOXES, 7, 1.0)];

export interface SessionOptions {
  elemsPerSession?: number;
  minElemsPerSession?: number;
  randomOrder?: boolean;
}

// Picks which puzzles are due for the next session, mirroring Leitner.py's
// new_session(): boxes 1-4 first (weighted by BOX_PERCENTAGES, only items
// actually due — lastSessionNum + box <= nextSessionNum), then untried
// (box 0), then — if still short of the minimum — mastered items as filler,
// oldest-mastered first.
//
// (Lucas's source also retries the whole selection up to NUM_BOXES times
// before falling back to filler; every retry recomputes an identical result
// since nothing in the selection depends on the retry count, so that loop is
// dropped here as a no-op simplification — same observable behaviour, one
// pass instead of four.)
export function buildSession(
  states: LeitnerState[],
  nextSessionNum: number,
  options: SessionOptions = {},
): string[] {
  const elemsPerSession = options.elemsPerSession ?? 30;
  const minElemsPerSession = options.minElemsPerSession ?? 10;
  const randomOrder = options.randomOrder ?? true;

  const picked: string[] = [];
  const pickedSet = new Set<string>();
  const pending = () => elemsPerSession - picked.length;

  const take = (box: number, allPossible: boolean) => {
    const startLen = picked.length;
    const maxToGet = allPossible
      ? elemsPerSession - startLen
      : Math.min(roundProb((elemsPerSession * (BOX_PERCENTAGES[box] ?? 0)) / 100), elemsPerSession - startLen);
    if (maxToGet <= 0) return;
    for (const s of states) {
      if (s.box !== box) continue;
      if (s.lastSessionNum + box > nextSessionNum) continue; // not due yet
      if (pickedSet.has(s.puzzleId)) continue;
      picked.push(s.puzzleId);
      pickedSet.add(s.puzzleId);
      if (picked.length - startLen === maxToGet) return;
    }
  };

  for (const allPossible of [false, true]) {
    for (let box = 1; box <= NUM_BOXES; box++) {
      take(box, allPossible);
      if (!pending()) break;
    }
    if (!pending()) break;
  }

  if (pending()) take(0, true);

  if (picked.length < minElemsPerSession) {
    const mastered = states
      .filter((s) => s.box === WIN_BOX && !pickedSet.has(s.puzzleId))
      .sort((a, b) => (a.masteredAtSession ?? 0) - (b.masteredAtSession ?? 0));
    for (const s of mastered) {
      picked.push(s.puzzleId);
      pickedSet.add(s.puzzleId);
      if (picked.length === minElemsPerSession) break;
    }
  }

  if (randomOrder) {
    for (let i = picked.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [picked[i], picked[j]] = [picked[j], picked[i]];
    }
  }

  return picked;
}

export interface AssignResultOutcome {
  box: number;
  masteredAtSession?: number; // set only when this call causes mastery (box just became WIN_BOX)
}

// correct: box 0 jumps straight to box 2 (skipping box 1 entirely on a first
// success); otherwise box+1. wrong: a mastered item that fails drops all the
// way to the *last* box (harsher backsliding penalty), not box 1; anything
// else resets to box 1. Both asymmetries are deliberate tuning in the
// original, preserved here rather than "simplified" to a uniform rule.
export function assignResult(box: number, correct: boolean, sessionNum: number): AssignResultOutcome {
  if (correct) {
    if (box === WIN_BOX) return { box: WIN_BOX };
    const nextBox = box === 0 ? 2 : box + 1;
    return nextBox === WIN_BOX ? { box: nextBox, masteredAtSession: sessionNum } : { box: nextBox };
  }
  return { box: box === WIN_BOX ? NUM_BOXES : 1 };
}

export function isSessionComplete(states: LeitnerState[]): boolean {
  return states.length > 0 && states.every((s) => s.box === WIN_BOX);
}

export function nextSessionNumber(states: LeitnerState[]): number {
  return states.reduce((max, s) => Math.max(max, s.lastSessionNum), 0) + 1;
}
