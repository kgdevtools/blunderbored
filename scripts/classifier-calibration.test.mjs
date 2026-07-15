// Calibration regression test: the full classifier (lib/classification.ts,
// real code) over a fixture game's depth-18 Stockfish evals, diffed against
// lichess's server-review judgments of the SAME game (2026-07-14).
//
// This is the test that pinned down the 2× threshold-scale error: at the old
// 10/20/30 boundaries only 3/16 lichess flags matched; at 5/10/15 the
// remaining differences are boundary noise from engine-eval variance.
//
// Run: node scripts/classifier-calibration.test.mjs
// (fixture evals from tools/reviewer-lab/review_lab.py --depth 18, SF 17.1)
import { Chess } from 'chess.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyMove, countLegalMoves } from '../lib/classification.ts';
import { winP } from '../lib/accuracy.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const eco = JSON.parse(readFileSync(resolve(root, 'public/openings/eco.json'), 'utf8'));

const PGN = '1. e4 e5 2. Bc4 Nf6 3. Nf3 Nc6 4. d4 exd4 5. Nxd4 Nxd4 6. Qxd4 d6 7. Nc3 Be7 8. O-O O-O 9. Qd1 d5 10. exd5 c6 11. Bd2 cxd5 12. Nxd5 Be6 13. Nxe7+ Qxe7 14. Qf3 Bxc4 15. b3 Bb5 16. a3 Rfe8 17. Bb4 b6 18. Bxe7 Rxe7 19. a4 Be8 20. c4 a6';

// [moveIndex, san, color, evalBefore, evalAfter, winPctLoss, playedIsBest, missedMate]
// (White-POV cp; from the reviewer-lab reference run at depth 18)
const EVALS = [
  [0, 'e4', 'w', 29, 30, 0, 1, 0], [1, 'e5', 'b', 30, 34, 0.37, 1, 0],
  [2, 'Bc4', 'w', 34, -5, 3.59, 0, 0], [3, 'Nf6', 'b', -5, 8, 1.2, 1, 0],
  [4, 'Nf3', 'w', 8, -50, 5.33, 0, 0], [5, 'Nc6', 'b', -50, 25, 6.89, 0, 0],
  [6, 'd4', 'w', 25, 8, 1.56, 0, 0], [7, 'exd4', 'b', 8, 17, 0.83, 1, 0],
  [8, 'Nxd4', 'w', 17, -50, 6.15, 0, 0], [9, 'Nxd4', 'b', -50, 50, 9.18, 0, 0],
  [10, 'Qxd4', 'w', 50, 58, 0, 1, 0], [11, 'd6', 'b', 58, 86, 2.53, 0, 0],
  [12, 'Nc3', 'w', 86, 84, 0.18, 1, 0], [13, 'Be7', 'b', 84, 72, 0, 1, 0],
  [14, 'O-O', 'w', 72, 42, 2.73, 0, 0], [15, 'O-O', 'b', 42, 44, 0.18, 1, 0],
  [16, 'Qd1', 'w', 44, 12, 2.94, 0, 0], [17, 'd5', 'b', 12, 141, 11.59, 0, 0],
  [18, 'exd5', 'w', 141, 88, 4.67, 0, 0], [19, 'c6', 'b', 88, 177, 7.71, 0, 0],
  [20, 'Bd2', 'w', 177, -2, 15.92, 0, 0], [21, 'cxd5', 'b', -2, -10, 0, 1, 0],
  [22, 'Nxd5', 'w', -10, -345, 27.16, 0, 0], [23, 'Be6', 'b', -345, 220, 47.29, 0, 0],
  [24, 'Nxe7+', 'w', 220, 218, 0.16, 1, 0], [25, 'Qxe7', 'b', 218, 259, 3.13, 1, 0],
  [26, 'Qf3', 'w', 259, -397, 53.37, 0, 0], [27, 'Bxc4', 'b', -397, -392, 0.28, 1, 0],
  [28, 'b3', 'w', -392, -517, 6.13, 0, 0], [29, 'Bb5', 'b', -517, -424, 4.38, 0, 0],
  [30, 'a3', 'w', -424, -522, 4.58, 0, 0], [31, 'Rfe8', 'b', -522, -460, 2.76, 0, 0],
  [32, 'Bb4', 'w', -460, -463, 0.14, 0, 0], [33, 'b6', 'b', -463, 518, 71.69, 0, 0],
  [34, 'Bxe7', 'w', 518, 548, 0, 1, 0], [35, 'Rxe7', 'b', 548, 670, 3.91, 0, 0],
  [36, 'a4', 'w', 670, 541, 4.18, 0, 0], [37, 'Be8', 'b', 541, 747, 6, 0, 0],
  [38, 'c4', 'w', 747, 473, 8.9, 0, 0], [39, 'a6', 'b', 473, 776, 9.48, 0, 0],
];

// lichess server-review judgments (moveIndex → tier); every other move unflagged.
const LICHESS = {
  4: 'inaccuracy', 5: 'inaccuracy', 9: 'inaccuracy', 17: 'mistake', 19: 'inaccuracy',
  20: 'mistake', 22: 'blunder', 23: 'blunder', 26: 'blunder', 28: 'inaccuracy',
  29: 'inaccuracy', 33: 'blunder', 36: 'inaccuracy', 37: 'inaccuracy', 38: 'inaccuracy', 39: 'inaccuracy',
};
// Boundary cases where our depth-18 eval sits on the other side of a tier line
// than lichess's cloud eval (differences ≤ ~1.6 win% points — engine variance,
// not calibration): 8 (their 4.2 vs our 6.2), 20 (14.4 vs 15.9),
// 29 (5.8 vs 4.4), 36 (5.6 vs 4.2).
const BOUNDARY_OK = new Set([8, 20, 29, 36]);
// Deliberate semantic difference: 3.Nf3 / 3...Nc6 are catalogued theory
// (Italian / Two Knights via transposition), so we classify them 'book' and
// suppress the judgment — chess.com/Chessigma behavior. Lichess flags theory
// moves anyway when the engine mildly dislikes them (the Nxe4 fork-trick line).
const BOOK_SUPPRESSION_OK = new Set([4, 5]);

const chess = new Chess();
chess.loadPgn(PGN);
const hist = chess.history();
chess.reset();
const fens = [chess.fen()];
for (const san of hist) { chess.move(san); fens.push(chess.fen()); }
const epd = (fen) => fen.split(' ').slice(0, 4).join(' ');

let pass = 0, fail = 0;
const check = (label, ok) => { ok ? pass++ : (fail++, console.error(`  ✗ ${label}`)); };

// Opening naming: lichess called this exact game C44 Scotch Gambit Dubois Réti.
{
  let opening = null;
  for (let i = fens.length - 1; i >= 0 && !opening; i--) {
    const hit = eco.positions[epd(fens[i])];
    if (Array.isArray(hit)) opening = hit;
  }
  check(`opening = C44 (got ${opening?.[0]} ${opening?.[1]})`, opening?.[0] === 'C44');
}

const FLAG_TIERS = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);
let exact = 0, boundary = 0, mismatch = 0;
for (const [i, san, color, evalBefore, evalAfter, wpl, isBest, missedMate] of EVALS) {
  const wpBefore = color === 'w' ? winP(evalBefore) : winP(-evalBefore);
  const wpAfter = color === 'w' ? winP(evalAfter) : winP(-evalAfter);
  const isBook = eco.positions[epd(fens[i + 1])] !== undefined;
  const quality = classifyMove({
    winPctLoss: wpl, wpBefore, wpAfter,
    playedIsBest: !!isBest, isBook,
    legalMoveCount: countLegalMoves(fens[i]),
    missedMate: !!missedMate,
    isSacrifice: false, // pv not stored in the fixture; no sacrifices in this game
    // no line2 (fixture is a single-PV run) → great/forced gap rules can't fire
  });
  const li = LICHESS[i];
  const matches =
    quality === li ||
    // 'miss' is our refinement of the same inaccuracy/mistake band
    (quality === 'miss' && (li === 'inaccuracy' || li === 'mistake')) ||
    (li === undefined && !FLAG_TIERS.has(quality));
  if (matches) exact++;
  else if (BOUNDARY_OK.has(i)) boundary++;
  else if (BOOK_SUPPRESSION_OK.has(i) && quality === 'book') boundary++;
  else { mismatch++; console.error(`  ✗ move ${i} ${san}: ours=${quality} lichess=${li ?? 'unflagged'} (wpl ${wpl})`); }
}
check(`no unexplained disagreements (exact ${exact}, expected-diff ${boundary}, other ${mismatch})`, mismatch === 0);
check('expected differences stay ≤ 6', boundary <= 6);

console.log(`${pass} passed, ${fail} failed · ${exact}/${EVALS.length} exact vs lichess, ${boundary} expected differences`);
process.exit(fail ? 1 : 0);
