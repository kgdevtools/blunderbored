// Validate the SHIPPING model: node cap + top-K softmax sampling. For each
// rating we search node-limited multi-PV, sample several times (it's stochastic),
// and measure average cpl-vs-optimal. A good model = cpl rises smoothly as the
// rating drops, with no wild variance.
//
// Mirrors lib/strengthModel.ts (ratingToNodes / ratingToTempCp /
// ratingToWindowCp / playMultiPv / sampleMove) — keep both in sync.

import { Engine, toWhiteCp, applyUci } from './driver.mjs';
import { POSITIONS } from './positions.mjs';

const RATING_MIN = 1350, RATING_MAX = 2600;
const SAMPLES = 6;
const RATINGS = [1350, 1600, 1900, 2250, 2600];
const ri = process.argv.indexOf('--ref');
const REF_MS = ri >= 0 ? Number(process.argv[ri + 1]) : 1800;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const t = (e) => clamp01((e - RATING_MIN) / (RATING_MAX - RATING_MIN));
const ratingToNodes = (e) => Math.round(50_000 * Math.pow(20, t(e)));
const ratingToTempCp = (e) => Math.round(140 - t(e) * 134);
const ratingToWindowCp = (e) => Math.round(250 - t(e) * 210);
const playMultiPv = (e) => (e >= 2400 ? 2 : 4);
function sampleMove(lines, tempCp, windowCp) {
  if (!lines.length) return null;
  const best = lines[0].scoreCp;
  const cand = lines.filter((l) => best - l.scoreCp <= windowCp);
  const temp = Math.abs(best) > 500 ? tempCp / 2 : tempCp;
  if (temp <= 1 || cand.length === 1) return cand[0].pv[0] ?? null;
  const w = cand.map((l) => Math.exp((l.scoreCp - best) / temp));
  const tot = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * tot;
  for (let i = 0; i < cand.length; i++) { r -= w[i]; if (r <= 0) return cand[i].pv[0] ?? null; }
  return cand[0].pv[0] ?? null;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
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
  sub.setoption('Hash', 4); sub.setoption('UCI_LimitStrength', 'false');
  await sub.isready();

  const gt = new Map();
  for (const p of POSITIONS) { const g = await refEval(ref, p.fen); if (g.best) gt.set(p.id, g); }
  const live = POSITIONS.filter((p) => gt.has(p.id));
  const evalCache = new Map(); // fen -> evalWhite (referee)

  console.log(`\nShipping model (node cap + windowed softmax), ${live.length} positions × ${SAMPLES} samples:\n`);
  console.log('rating   nodes     tempCp  winCp  pv   avg cpl   worst-sample cpl');
  console.log('──────────────────────────────────────────────────────────────────');
  for (const elo of RATINGS) {
    const nodes = ratingToNodes(elo), temp = ratingToTempCp(elo), win = ratingToWindowCp(elo), pv = playMultiPv(elo);
    const all = [];
    for (const p of live) {
      const moverIsWhite = p.fen.split(' ')[1] === 'w';
      const g = gt.get(p.id);
      await sub.newgame();
      sub.setoption('MultiPV', pv);
      await sub.isready();
      const lines = await sub.goMulti(p.fen, `nodes ${nodes}`);
      for (let s = 0; s < SAMPLES; s++) {
        const uci = sampleMove(lines, temp, win);
        if (!uci) { all.push(0); continue; }
        const after = await applyUci(p.fen, uci);
        let av;
        if (after.over) av = g.evalWhite;
        else if (evalCache.has(after.fen)) av = evalCache.get(after.fen);
        else { av = (await refEval(ref, after.fen)).evalWhite; evalCache.set(after.fen, av); }
        all.push(Math.max(0, moverIsWhite ? g.evalWhite - av : av - g.evalWhite));
      }
    }
    console.log(
      String(elo).padEnd(8) +
      String(nodes).padEnd(10) +
      String(temp).padStart(5) + '  ' +
      String(win).padStart(5) + '  ' +
      String(pv).padStart(2) + '   ' +
      String(Math.round(mean(all))).padStart(7) + '   ' +
      String(Math.round(Math.max(...all))).padStart(15),
    );
  }
  console.log('──────────────────────────────────────────────────────────────────\n');
  ref.quit(); sub.quit();
}
main().catch((e) => { console.error(e); process.exit(1); });
