// Unit tests for the reviewer's pure math layer (lib/accuracy.ts) and the
// full-tier classifier (lib/classification.ts).
// Run: node scripts/review-heuristics.test.mjs   (Node ≥23 strips TS types natively)
import {
  winP, moveAccuracy, winPctLossForSide, classifyQuality, CLASSIFY,
} from '../lib/accuracy.ts';
import {
  classifyMove, selectCriticals, detectSacrifice, countLegalMoves, classifyPhase,
  CRITICAL_SWING_CP,
} from '../lib/classification.ts';

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

// ── classifyQuality: recalibrated boundaries (5 / 10 / 15) ───────────────────
// Lichess judgments are 0.1/0.2/0.3 on its −1..+1 winning-chances scale =
// 5/10/15 points on the 0–100 winP scale (the old 10/20/30 was a 2× error;
// verified against a lichess server review 2026-07-14: 13/16 exact matches).
check('4.99 → good', classifyQuality(4.99), 'good');
check('5 → inaccuracy', classifyQuality(5), 'inaccuracy');
check('9.99 → inaccuracy', classifyQuality(9.99), 'inaccuracy');
check('10 → mistake', classifyQuality(10), 'mistake');
check('14.99 → mistake', classifyQuality(14.99), 'mistake');
check('15 → blunder', classifyQuality(15), 'blunder');
check('0 → good', classifyQuality(0), 'good');

// ── classifyMove: overlay tiers, precedence first-match-wins ─────────────────
const base = {
  winPctLoss: 0, wpBefore: 50, wpAfter: 50, playedIsBest: false, isBook: false,
  legalMoveCount: 30, missedMate: false, isSacrifice: false,
};
// forced
check('1 legal move → forced', classifyMove({ ...base, legalMoveCount: 1 }), 'forced');
check('single non-losing move → forced',
  classifyMove({ ...base, playedIsBest: true, line1Wp: 50, line2Wp: 10 }), 'forced');
check('alt at 10.01 wp → not forced (great)',
  classifyMove({ ...base, playedIsBest: true, line1Wp: 50, line2Wp: 10.01 }), 'great');
check('gap 24.99 → not forced',
  classifyMove({ ...base, playedIsBest: true, line1Wp: 34.99, line2Wp: 10 }), 'great');
// book
check('book move → book', classifyMove({ ...base, isBook: true }), 'book');
check('forced beats book', classifyMove({ ...base, isBook: true, legalMoveCount: 1 }), 'forced');
// brilliant
const brill = { ...base, playedIsBest: true, isSacrifice: true, wpBefore: 60, wpAfter: 62 };
check('sound sacrifice → brilliant', classifyMove(brill), 'brilliant');
check('losing after sac → not brilliant', classifyMove({ ...brill, wpAfter: 44.9 }) === 'brilliant', false);
check('already winning → not brilliant', classifyMove({ ...brill, wpBefore: 90.1 }) === 'brilliant', false);
check('sac but not best → not brilliant', classifyMove({ ...brill, playedIsBest: false }) === 'brilliant', false);
// great / best
check('only good move → great',
  classifyMove({ ...base, playedIsBest: true, line1Wp: 55, line2Wp: 43 }), 'great');
check('gap 11.99 → best not great',
  classifyMove({ ...base, playedIsBest: true, line1Wp: 55, line2Wp: 43.01 }), 'best');
check('top move without MultiPV → best', classifyMove({ ...base, playedIsBest: true }), 'best');
// miss
check('mistake while winning → miss',
  classifyMove({ ...base, winPctLoss: 12, wpBefore: 72 }), 'miss');
check('inaccuracy with missed mate → miss',
  classifyMove({ ...base, winPctLoss: 6, wpBefore: 60, missedMate: true }), 'miss');
check('mistake while equal → mistake',
  classifyMove({ ...base, winPctLoss: 12, wpBefore: 55 }), 'mistake');
check('blunder while winning stays blunder',
  classifyMove({ ...base, winPctLoss: 40, wpBefore: 90 }), 'blunder');
// base + excellent
check('wpl 1 not-best → excellent', classifyMove({ ...base, winPctLoss: 1 }), 'excellent');
check('wpl 1.01 → good', classifyMove({ ...base, winPctLoss: 1.01 }), 'good');
check('wpl 7 → inaccuracy', classifyMove({ ...base, winPctLoss: 7 }), 'inaccuracy');
check('wpl 20 → blunder', classifyMove({ ...base, winPctLoss: 20 }), 'blunder');

// ── selectCriticals ──────────────────────────────────────────────────────────
{
  const quiet = {
    provisional: 'good', mateInvolved: false, playedIsBest: false,
    swingCp: 20, sacrificeCandidate: false, unscored: false,
  };
  const list = [
    quiet,                                            // 0: skipped
    { ...quiet, provisional: 'mistake' },             // 1
    { ...quiet, mateInvolved: true },                 // 2
    { ...quiet, playedIsBest: true },                 // 3
    { ...quiet, swingCp: CRITICAL_SWING_CP },         // 4
    { ...quiet, sacrificeCandidate: true },           // 5
    { ...quiet, unscored: true },                     // 6
    { ...quiet, swingCp: CRITICAL_SWING_CP - 1 },     // 7: skipped
  ];
  check('criticals picked', selectCriticals(list).join(','), '1,2,3,4,5,6');
}

// ── detectSacrifice (SEE-lite over PV) ───────────────────────────────────────
{
  // Greek gift: Bxh7+ Kxh7 — bishop gone for a pawn, not recovered in window.
  const greekGift = 'rnbq1rk1/ppp1bppp/4pn2/3p2B1/3P4/2NBP3/PPP2PPP/R2QK1NR w KQ - 0 1';
  check('Bxh7+ Kxh7 is a sacrifice',
    detectSacrifice(greekGift, ['d3h7', 'g8h7'], 4), true);
  // Plain recapture: exd5 exd5 — no net loss.
  const recapture = 'rnbqkbnr/ppp2ppp/8/3pp3/3PP3/8/PPP2PPP/RNBQKBNR w KQkq - 0 3';
  check('even exchange is not a sacrifice',
    detectSacrifice(recapture, ['e4d5', 'd8d5'], 4), false);
  check('empty pv → false', detectSacrifice(recapture, [], 4), false);
}

// ── countLegalMoves ──────────────────────────────────────────────────────────
check('startpos has 20 moves',
  countLegalMoves('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), 20);
// Qg7+ undefended against a cornered king: Kxg7 is the only legal move.
check('single legal move counted',
  countLegalMoves('7k/6Q1/8/8/8/8/8/K7 b - - 0 1') === 1, true);

// ── classifyPhase: move-number gate (piece count alone kept games "opening") ──
check('startpos → opening',
  classifyPhase('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), 'opening');
// 20 pieces at move 20 (the stress game's final position shape) → middlegame.
check('move 20 with 20 pieces → middlegame',
  classifyPhase('r3b1k1/4rppp/pp3n2/8/P1P5/1P3Q2/5PPP/R4RK1 w - - 0 21'), 'middlegame');
// Queens off + 16 pieces → endgame even above the 12-piece floor.
check('queenless 16 pieces → endgame',
  classifyPhase('r5k1/5ppp/pp3n2/8/P1P5/1P6/5PPP/R5K1 w - - 0 21'), 'endgame');
check('bare K+P endgame → endgame', classifyPhase('8/5ppp/4k3/8/8/8/6PP/6K1 w - - 0 40'), 'endgame');

// ── blunderable regression gate (lib/blunder.ts) ─────────────────────────────
{
  const { regressionFail, classifySelfLoss } = await import('../lib/blunder.ts');
  // True steady bleed, still current → fail.
  check('steady current decline fails', regressionFail([0, 4, 4, 4]), true);
  check('resumed slide re-arms', regressionFail([4, 4, 1, 4]), true);
  // One inaccuracy + scoring noise must NOT read as a trend (live-run case
  // 2026-07-15: [0, 9, 2, 2] fired at eps=1 while a bit-identical replay
  // measured 11.7wp and survived — noise-level entries were counted).
  check('inaccuracy + noise is not a trend', regressionFail([0, 9, 2, 2]), false);
  // A slide that already stopped doesn't fail retroactively.
  check('stopped slide survives', regressionFail([4, 4, 4, 1]), false);
  // Improving/holding play can never trip the gate.
  check('zero-loss run survives', regressionFail([0, 0, 0, 0]), false);
  check('short history never fires', regressionFail([9, 9, 9]), false);
  // Self-loss classes on the 5/10/15 scale.
  check('15wp self-loss = blunder', classifySelfLoss(15), 'blunder');
  check('10wp = mistake', classifySelfLoss(10), 'mistake');
  check('5wp = inaccuracy', classifySelfLoss(5), 'inaccuracy');
  check('4.99wp = ok', classifySelfLoss(4.99), 'ok');
}

// ── CLASSIFY constants sanity (puzzle generator consumes these) ──────────────
check('tier bands ascend',
  CLASSIFY.EXCELLENT_MAX_WPL < CLASSIFY.GOOD_MAX_WPL
  && CLASSIFY.GOOD_MAX_WPL < CLASSIFY.INACCURACY_MAX_WPL
  && CLASSIFY.INACCURACY_MAX_WPL < CLASSIFY.MISTAKE_MAX_WPL, true);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
