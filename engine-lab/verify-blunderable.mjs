// Reproduce a blunderable run's scoring with the EXACT shipped engine at the
// app's budgets: full-strength `go nodes 600000` for verdicts (SCORING_NODES),
// and the 2200-rating sampling model for the engine's replies.
//   node engine-lab/verify-blunderable.mjs
import { Engine } from './driver.mjs';
import { Chess } from 'chess.js';
import {
  ratingToNodes, ratingToTempCp, ratingToWindowCp, playMultiPv,
} from '../lib/strengthModel.ts';

const START = 'rq2rbk1/2p2ppp/p1bp1n2/2p5/4P3/1PN1RN1P/P1P1QPP1/R1B3K1 b - - 0 16';
const LINE = ['Qb7', 'Bd2', 'g6', 'Re1', 'Bg7', 'a3', 'Nd7']; // 16... to 19...
const SCORING_NODES = 600_000;
const ELO = 2200;

const winP = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
const blackPov = (cpWhite) => -cpWhite;

async function main() {
  const e = new Engine();
  await e.uci();
  e.setoption('Hash', 4);
  e.setoption('Threads', 1);
  await e.isready();
  await e.newgame();

  // FEN sequence along the line
  const c = new Chess(START);
  const fens = [c.fen()];
  const sides = []; // side that MOVED to reach fens[i+1]
  for (const san of LINE) {
    sides.push(c.turn());
    c.move(san);
    fens.push(c.fen());
  }

  // Full-strength scoring eval per position (mirrors playerEval)
  const evals = [];
  for (const f of fens) {
    const r = await e.go(f, `nodes ${SCORING_NODES}`);
    const cpW = f.split(' ')[1] === 'b' ? -(r.scoreCp ?? 0) : (r.scoreCp ?? 0);
    evals.push({ cpW, best: r.bestmove, depth: r.depth });
  }

  console.log('\n── Scoring replay (600k nodes, full strength; player = Black) ──');
  console.log(`start eval (Black POV): ${blackPov(evals[0].cpW)}cp → winP ${winP(blackPov(evals[0].cpW)).toFixed(1)}%`);
  const selfLosses = [];
  for (let i = 0; i < LINE.length; i++) {
    const before = winP(blackPov(evals[i].cpW));
    const after = winP(blackPov(evals[i + 1].cpW));
    const mover = sides[i] === 'b' ? 'YOU ' : 'ENG ';
    const delta = after - before; // Black POV
    if (sides[i] === 'b') selfLosses.push(Math.max(0, -delta));
    console.log(
      `${mover}${LINE[i].padEnd(5)} ${String(evals[i].cpW).padStart(5)}→${String(evals[i + 1].cpW).padStart(5)}cpW  ` +
      `winP(B) ${before.toFixed(1)}→${after.toFixed(1)}  Δ ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}  ` +
      `(engine best was ${evals[i].best})`,
    );
  }
  const cum = selfLosses.reduce((s, v) => s + v, 0);
  const declines = selfLosses.slice(-4).filter((l) => l >= 1).length;
  const windowTotal = selfLosses.slice(-4).reduce((s, v) => s + v, 0);
  console.log(`\nself-losses: [${selfLosses.map((v) => v.toFixed(1)).join(', ')}]`);
  console.log(`cumulative ${cum.toFixed(1)}wp (drift fail ≥20: ${cum >= 20})`);
  console.log(`regression window: ${declines} declines ≥1wp, total ${windowTotal.toFixed(1)}wp → fail(≥3 & ≥12): ${declines >= 3 && windowTotal >= 12}`);

  // Engine-reply plausibility at 2200: MultiPV sampling distribution at the
  // decision points where the engine played Bd2 / Re1 / a3.
  console.log(`\n── 2200 play model at engine decision points (nodes ${ratingToNodes(ELO)}, temp ${ratingToTempCp(ELO)}cp, window ${ratingToWindowCp(ELO)}cp, pv ${playMultiPv(ELO)}) ──`);
  e.setoption('MultiPV', playMultiPv(ELO));
  await e.isready();
  for (let i = 0; i < LINE.length; i++) {
    if (sides[i] !== 'w') continue;
    const lines = await e.goMulti(fens[i], `nodes ${ratingToNodes(ELO)}`);
    // softmax over window (mirrors sampleMove)
    const best = lines[0]?.scoreCp ?? 0;
    const within = lines.filter((l) => best - (l.scoreCp ?? -1e9) <= ratingToWindowCp(ELO));
    const temp = ratingToTempCp(ELO);
    const ws = within.map((l) => Math.exp(((l.scoreCp ?? 0) - best) / temp));
    const total = ws.reduce((s, v) => s + v, 0);
    console.log(`before ${LINE[i]}: ` + within.map((l, k) =>
      `${l.pv[0]} ${l.scoreCp}cp p=${((ws[k] / total) * 100).toFixed(0)}%`).join(' · ') +
      `  [played: ${LINE[i]}]`);
  }
  e.quit();
}
main().catch((err) => { console.error(err); process.exit(1); });
