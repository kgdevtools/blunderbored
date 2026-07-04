// Unit tests for the reviewer's pure math layer (lib/accuracy.ts).
// Run: node scripts/review-heuristics.test.mjs   (Node ≥23 strips TS types natively)
import {
  winP, moveAccuracy, winPctLossForSide, classifyQuality, computeGameAccuracy,
} from '../lib/accuracy.ts';

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const ok = typeof expected === 'number' && typeof actual === 'number' && !Number.isInteger(expected)
    ? Math.abs(actual - expected) < 0.01
    : actual === expected;
  if (ok) pass++;
  else { fail++; console.error(`  ✗ ${label}  got=${actual} expected=${expected}`); }
};

// ── winP: Lichess sigmoid calibration ────────────────────────────────────────
check('winP(0) = 50', winP(0), 50);
check('winP symmetric', +(winP(100) + winP(-100)).toFixed(6), 100);
check('winP(+300) ≈ 75.1', Math.round(winP(300) * 10) / 10, 75.1);
check('winP monotonic', winP(50) < winP(150) && winP(150) < winP(500), true);
check('winP(+10000) ≈ 100', winP(10000) > 99.99, true);

// ── moveAccuracy: Lichess exponential ────────────────────────────────────────
// Lichess constants give 99.9999 at zero loss (103.1668·e⁰ − 3.1669), not a bug.
check('no loss → ~100', moveAccuracy(50, 50) > 99.99, true);
check('gain also 100 (capped)', moveAccuracy(50, 60), 100);
check('total collapse → ~0', moveAccuracy(100, 0) < 5, true);
check('10% loss ≈ 63.5', Math.round(moveAccuracy(60, 50)), 64);
check('never negative', moveAccuracy(100, -50) >= 0, true);

// ── winPctLossForSide: the black-perspective sign flip ───────────────────────
{
  // White blunders 200cp: +100 → -100 (White POV evals)
  const w = winPctLossForSide(100, -100, 'w');
  check('white loss positive', w.winPctLoss > 0, true);
  // Same eval move seen from Black: Black GAINED — loss must be negative
  const b = winPctLossForSide(100, -100, 'b');
  check('black gain negative', b.winPctLoss < 0, true);
  check('symmetry |w| == |b|', +(w.winPctLoss + b.winPctLoss).toFixed(6), 0);
  // Black to move blunders: eval goes -150 → +150 (White POV)
  const b2 = winPctLossForSide(-150, 150, 'b');
  check('black blunder positive', b2.winPctLoss > 0, true);
}

// ── classifyQuality: threshold boundaries (10 / 20 / 30) ─────────────────────
check('9.99 → good', classifyQuality(9.99), 'good');
check('10 → inaccuracy', classifyQuality(10), 'inaccuracy');
check('19.99 → inaccuracy', classifyQuality(19.99), 'inaccuracy');
check('20 → mistake', classifyQuality(20), 'mistake');
check('29.99 → mistake', classifyQuality(29.99), 'mistake');
check('30 → blunder', classifyQuality(30), 'blunder');
check('0 → good', classifyQuality(0), 'good');

// ── computeGameAccuracy: book exclusion + empty side ─────────────────────────
{
  const ms = [
    { moveAccuracy: 100, isBook: true,  color: 'w' },
    { moveAccuracy: 80,  isBook: false, color: 'w' },
    { moveAccuracy: 60,  isBook: false, color: 'w' },
    { moveAccuracy: 10,  isBook: false, color: 'b' },
  ];
  check('book excluded from mean', computeGameAccuracy(ms, 'w'), 70);
  check('all-book side → 100', computeGameAccuracy([{ moveAccuracy: 0, isBook: true, color: 'b' }], 'b'), 100);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
