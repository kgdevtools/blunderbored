// Calibrate rating → node-budget. Full strength (no UCI_LimitStrength), weakened
// only by `go nodes N`. For each budget we measure cpl-vs-optimal (referee), so
// we can pick budgets that span weak→strong smoothly for the 1350–2600 slider.

import { Engine, toWhiteCp, applyUci } from './driver.mjs';
import { POSITIONS } from './positions.mjs';

const ri = process.argv.indexOf('--ref');
const REF_MS = ri >= 0 ? Number(process.argv[ri + 1]) : 2000;
const BUDGETS = [1000, 2500, 5000, 10000, 25000, 60000, 150000, 400000, 1000000];

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

async function refEval(ref, fen) {
  await ref.newgame();
  const r = await ref.go(fen, `movetime ${REF_MS}`);
  return { evalWhite: r.scoreCp == null ? 0 : toWhiteCp(r.scoreCp, fen), best: r.bestmove };
}

async function main() {
  const ref = new Engine(); await ref.uci();
  ref.setoption('Hash', 64); ref.setoption('UCI_LimitStrength', 'false'); ref.setoption('Skill Level', 20);
  await ref.isready();

  const sub = new Engine(); await sub.uci();
  sub.setoption('Hash', 4); sub.setoption('UCI_LimitStrength', 'false'); sub.setoption('MultiPV', 1);
  await sub.isready();

  const gt = new Map();
  for (const p of POSITIONS) {
    const g = await refEval(ref, p.fen);
    if (g.best) gt.set(p.id, g);
  }
  const live = POSITIONS.filter((p) => gt.has(p.id));

  console.log(`\nNode-budget calibration (full strength, ${live.length} positions, referee ${REF_MS}ms):\n`);
  console.log('nodes        avg cpl   median   depth(avg)   ~feel');
  console.log('──────────────────────────────────────────────────────');
  for (const N of BUDGETS) {
    const losses = [], depths = [];
    for (const p of live) {
      await sub.newgame();
      const played = await sub.go(p.fen, `nodes ${N}`);
      if (played.depth) depths.push(played.depth);
      if (!played.bestmove) { losses.push(0); continue; }
      const g = gt.get(p.id);
      const after = await applyUci(p.fen, played.bestmove);
      const av = after.over ? g.evalWhite : (await refEval(ref, after.fen)).evalWhite;
      const moverIsWhite = p.fen.split(' ')[1] === 'w';
      losses.push(Math.max(0, moverIsWhite ? g.evalWhite - av : av - g.evalWhite));
    }
    const cpl = Math.round(mean(losses));
    const feel = cpl > 60 ? 'casual' : cpl > 35 ? 'club' : cpl > 18 ? 'strong' : 'expert';
    console.log(
      String(N).padEnd(11) +
      String(cpl).padStart(6) + '   ' +
      String(Math.round(median(losses))).padStart(6) + '   ' +
      String(Math.round(mean(depths))).padStart(8) + '   ' +
      '   ' + feel,
    );
  }
  console.log('──────────────────────────────────────────────────────\n');
  ref.quit(); sub.quit();
}
main().catch((e) => { console.error(e); process.exit(1); });
